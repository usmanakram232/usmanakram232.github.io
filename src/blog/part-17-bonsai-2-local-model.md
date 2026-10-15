---
title: "Bonsai 2: a 2-bit local model that fits in 10 GB of RAM"
date: 2026-09-21
description: "A 2-bit ternary model runs 2.5x faster than a 4-bit rival on my M5 and needs a custom FastAPI server. It now serves three agent roles and Perplexica."
part: 17
permalink: /blog/part-17-bonsai-2-local-model/
---

The local model I picked, Ternary-Bonsai-2-27B, runs at about 10.9 tokens per second in 9.6 GB of RAM on my M5. It replaced two larger models and needed a small custom server because the standard MLX servers cannot load it. It now serves three OpenCode roles and the synthesis step of Perplexica, the local search app I run.

## Update to Part 14

[Part 14](/blog/part-14-lightning-round/) ended in mid-August with five local models and none bound to an agent mode. That was accurate then. In September I added a sixth, `gemma-4-31b-4bit`, on a separate "large" port (8001), and bound it to three roles: `local-coder`, `local-thinker`, and `distill`. It was too heavy for daily use on a 32GB machine, which is why I went looking for something smaller.

## RavenX vs. Bonsai 2

`RavenX Chaos Agent 27B` is a standard 4-bit MLX quant at 14GB on disk. `Ternary-Bonsai-2-27B` is a 2-bit ternary quant at 8.6GB, a different quantization scheme and not just fewer bits of the same one. On the M5:

| | RavenX (4-bit) | Bonsai 2 (ternary 2-bit) |
|---|---|---|
| Disk | 14 GB | 8.6 GB |
| RAM at inference | 15.6 GB | 9.6 GB |
| Throughput | 4.4 tok/s | 10.9 tok/s |
| Benchmark vs FP16 (model card) | not reported | within 2% |

Bonsai 2 is 2.5 times faster and uses 40% less RAM. The accuracy figure comes from the model card's own benchmark, and I have not re-run it. On a 32GB machine that also runs Perplexica and OpenCode, the RAM gap decides whether the model coexists with a normal workday.

## The catch: standard MLX servers can't load it

Bonsai 2 uses a custom Hadamard-aware loader, `vision_artifact.py`, shipped in the model's own `runtime/` directory and absent from standard `mlx-lm`. Both upstream servers, `mlx_lm.server` and `mlx_vlm.server`, error out trying to load it, and no flag changes that. (These are the servers from the `mlx-lm` and `mlx-vlm` packages, separate from my own `mlx-server` launchd wrapper.)

I wrote a small FastAPI wrapper, `scripts/bonsai2_server.py`, that imports the model's loader directly. I registered it as an OpenCode provider on port 8003 and moved `local-coder`, `local-thinker`, and `distill` from the large Gemma model onto it.

One API detail will trip anyone reproducing this. `mlx_lm` 0.31 changed its generation API, and `temp`, `temperature`, and `repetition_penalty` are no longer keyword arguments to `generate()`. The 0.31 call takes `sampler=make_sampler(temp, top_p, ...)` and `logits_processors=make_logits_processors(repetition_penalty=...)`, both from `mlx_lm.sample_utils`. A script written against older examples fails with a `TypeError` that does not mention a version mismatch. The wrapper and its test scripts use the current API.

## Fixing Perplexica's hallucinations

Perplexica is a self-hosted search app that retrieves web pages and has a model write an answer from them. Its synthesis step ran on Qwen3-1.7B, which hallucinated regularly. A 1.7B model scores around 65% on IFEval, so it sometimes ignores the instruction to answer only from the retrieved context and answers from memory. A prompt tweak cannot fix a capability gap.

I replaced the dedicated Qwen3-1.7B server with the same Bonsai 2 instance, started with a `--grounding` flag. In that mode the server prepends a strict "answer only from the provided context" prefix to every message that Vane, Perplexica's web front end, sends to the model. Two model processes became one 9.6 GB instance that serves both OpenCode's local agents and Perplexica.

## Status as of 2026-09-30

The provider, agent reassignments, and Perplexica config were committed on 2026-09-23. The `com.usman.bonsai2-for-perplexica` launchd agent is loaded on my machine, and the old Qwen3-1.7B `perplexica-mlx` agent is gone from `launchctl list`. Two things remain open:

- `bonsai-start` (on demand, no `--grounding`) and `bonsai2-for-perplexica` (always on, `--grounding`) both bind port 8003. If I run `bonsai-start` while the launchd agent is up, the second process fails to bind. The fix is separate ports or a port check in `bonsai-start`.
- I have not run a real query through Perplexica to confirm that grounding mode fires. I verified the server and the config separately, but not the full path.

The next session starts with that end-to-end query. For the earlier steps in this local-model thread, see [Part 14](/blog/part-14-lightning-round/).
