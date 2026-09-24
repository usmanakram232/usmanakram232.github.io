---
title: "Bonsai 2 and the Local Model That Finally Earns Its RAM"
date: 2026-09-21
description: "Evaluating two MLX models on an M5, why the winner needed a custom FastAPI server because it doesn't fit mlx_lm.server or mlx_vlm.server, and using it to fix a structural hallucination problem in Perplexica."
part: 17
permalink: /blog/part-17-bonsai-2-local-model/
---

Part 14 left the local MLX model set at five candidates, none of them bound to an actual OpenCode agent mode — kept purely as options pending "manual performance testing on real Java coding tasks." In the gap between that post and this one, a sixth model quietly got added on its own provider slot and actually put to work: `gemma-4-31b-4bit`, run on a separate "large" port (8001) from the five kept in the cut, bound to three agent roles — `local-coder`, `local-thinker`, and `distill` — that Part 14 never mentions. That bridging step never got its own post; this is the state it left behind. Then two new models showed up worth evaluating against it, and the loser wasn't a coding-quality problem — it was a hardware-fit problem visible before a single line of generated code got read.

## RavenX vs. Bonsai 2: the numbers that decided it

`RavenX Chaos Agent 27B` is a standard 4-bit MLX quant, 14GB on disk. `Ternary-Bonsai-2-27B` is a 2-bit ternary quant, 8.6GB — a fundamentally different quantization scheme, not just a smaller bit-width of the same approach. On the M5:

| | RavenX (4-bit) | Bonsai 2 (ternary 2-bit) |
|---|---|---|
| Disk | 14 GB | 8.6 GB |
| RAM at inference | 15.6 GB | 9.6 GB |
| Throughput | 4.4 tok/s | 10.9 tok/s |
| Benchmark vs FP16 (per the model's own eval suite) | — | within 2% |

2.5× faster, 40% less RAM, and — per the model card's own benchmark, not independently re-run here — close enough to full precision that the ternary compression isn't costing accuracy on paper. On a 32GB machine already running Perplexica, OpenCode, and whatever else is open, that RAM difference is the difference between a model that coexists with a normal workday and one that doesn't.

## The catch: it doesn't fit the server you already have

Bonsai 2 uses a custom Hadamard-aware loader — `vision_artifact.py`, shipped in the model's own `runtime/` directory, not part of standard `mlx-lm`. Both `mlx_lm.server` and `mlx_vlm.server` — the two upstream server modules from the `mlx-lm`/`mlx-vlm` Python packages, distinct from this repo's own custom `mlx-server` launchd wrapper covered in earlier posts — hard-error trying to load it, and there's no config flag to work around it. The loading path itself is different from what they expect.

The fix was a small FastAPI wrapper (`scripts/bonsai2_server.py`) that imports the model's own loader directly instead of going through either upstream server. Wired in as a new OpenCode provider on port 8003, and `local-coder`, `local-thinker`, and `distill` — all previously sitting on `gemma-4-31b-4bit` on the "large" port, too RAM-hungry for daily use on a 32GB machine — moved onto Bonsai 2.

There's a real API trap here for anyone reproducing this: `mlx_lm.server` 0.31 changed its generation API. `temp`, `temperature`, and `repetition_penalty` are no longer direct kwargs to `generate()` — the correct 0.31 call is `sampler=make_sampler(temp, top_p, ...)` and `logits_processors=make_logits_processors(repetition_penalty=...)`, both from `mlx_lm.sample_utils`. Any test script written against older examples will silently take the wrong arguments or throw a `TypeError` that doesn't obviously point at a version mismatch. The wrapper and its test scripts are written against the current API.

## Fixing Perplexica's hallucination problem, structurally

Perplexica's synthesis step was running on Qwen3-1.7B, and it hallucinated — not occasionally, structurally. A 1.7B model scores around 65% on IFEval, and instruction-following at that level means it will sometimes ignore the RAG grounding instructions entirely and answer from parametric memory instead of the retrieved context. No prompt tweak fixes a capability gap; the model needs to be bigger or the instruction-following needs to be enforced some other way.

The fix was replacing the dedicated Qwen3-1.7B synthesis server with the same Bonsai 2 instance, run in a `--grounding` mode that prepends a strict RAG-only system prefix to every Vane message before it reaches the model. Two separate model processes collapsed into one 9.6GB Bonsai 2 instance, serving both OpenCode's local agents and Perplexica's synthesis step.

## What's still open

- `bonsai-start` (on-demand, no `--grounding`) and `bonsai2-for-perplexica` (always-on, `--grounding`) both bind port 8003. If the always-on launchd agent is up and someone runs `bonsai-start` by hand, the second process fails to bind — and the reverse ordering problem exists at boot too. Not fixed yet; low urgency since the launchd agent is normally always running, but the fix is either separate ports or making `bonsai-start` port-aware.
- The actual `home-manager switch` to activate the new provider, agent reassignments, and Perplexica config rewrite hadn't happened yet as of this writing — `nix/lib/opencode-template.nix`, `nix/personal/usman-mac.nix`, `nix/home/mac-extras.nix`, and `nix/home/perplexica.nix` were still sitting as uncommitted changes. The old `perplexica-mlx` launchd agent (Qwen3-1.7B, port 8002) needs a manual `launchctl bootout` after the switch, since it won't be in the new generation for launchd to unload automatically.
- Grounded search through Perplexica hadn't been run end-to-end against Bonsai 2 yet — the server and config plumbing were verified independently, but a real query through Vane confirming grounding mode actually fires is still outstanding.

This is the direct sequel to Part 14's "five models, none bound to a mode yet." Bonsai 2 is now bound to three modes, but the honest status is the same shape as always: the infrastructure works, the switch to make it live hasn't happened, and the next session starts by running it.
