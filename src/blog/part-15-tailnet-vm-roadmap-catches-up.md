---
title: "A Remote VM on the Tailnet, and the Roadmap Finally Catches Up"
date: 2026-09-15
description: "Tailscale plus a disposable Lima VM for remote agent sessions, nightly sanitized session backup with a secret-scan quarantine gate, and the first concrete delivery against the Part 5 autonomous-agent roadmap."
part: 15
permalink: /blog/part-15-tailnet-vm-roadmap-catches-up/
---

Part 10's revised status table on the Part 5 roadmap read, honestly: gVisor sandbox, Bedrock token injection, systemd supervisor, Firecracker microVMs — all "not started" or "partially done." The stated plan was to stop building a second layer until the existing stack had been stable for a sustained stretch. Eleven weeks later, the first real infrastructure delivery against that roadmap landed — not the gVisor sandbox, but a simpler, more immediately useful piece: a way to reach an agent session from anywhere, and a way to not lose it afterward.

The commit is a synthesis of two external sources — [domenic.me's agentic coding setup](https://domenic.me/agentic-coding-setup/) and an Anthropic engineering interview — filtered through what actually fits this repo's existing patterns rather than adopted wholesale.

## Reaching a session from anywhere: Tailscale + a disposable VM

Two pieces:

1. **Tailscale**, enabled as a cask in `nix/hosts/mac/default.nix`, puts the Mac on a tailnet reachable over SSH from anywhere.
2. **`lima/agents-base.yaml`**, a disposable Lima VM modeled directly on the existing `lima/opencode.yaml` (the headless-server pattern from earlier in the series), but provisioning Tailscale plus both Claude Code and OpenCode CLIs instead of a single headless server process.

The distinction that matters: `opencode.yaml` is a long-running headless server VM; `agents-base.yaml` is meant to be spun up, used interactively over SSH from wherever I am, and thrown away. Same Lima substrate, different lifecycle — reusing the pattern rather than inventing a new one.

## Session backup, and the bug that almost shipped broken

A nightly `agent-session-backup` launchd agent now exports sanitized OpenCode sessions and rsyncs Claude Code's `.jsonl` session files, gated by a secret-scan quarantine step before anything gets committed. Two design decisions worth calling out:

- **The export is sanitized, not raw.** OpenCode's actual session store, `opencode.db`, is 6.3GB and never gets touched by the backup — it exports a filtered, sanitized version instead.
- **The secret scan is a hard gate, not a warning.** Nothing gets committed if the scan doesn't come back clean first.

That gate almost didn't work. During testing, a pipefail bug meant that when `grep` found *zero* secrets — the good outcome — the pipeline treated that as a failure and silently aborted before the commit step ever ran. `grep` exits non-zero when it finds no matches, which is normally the correct behavior signal, but here it was being piped into something that propagated that exit code as "the scan failed" rather than "the scan found nothing to flag." The backup would have appeared to run successfully every single night while never actually committing anything. That kind of failure stays invisible until you go looking for a specific session weeks later and it isn't there. Caught during deliberate testing, not in production — which is the whole reason the "verified: darwin-rebuild build, nix flake check, limactl validate, and a secret scan all pass clean" line exists at the bottom of this kind of commit message.

## Documenting the worktree pattern as policy, not habit

The `wt-new` / `wt-cd` / `wt-status` worktree tooling already existed in the repo — used informally, session to session. This commit formalizes it as the default for *all* agent sessions, written into `config/opencode/AGENTS.md` where every agent invocation reads it. The difference between a pattern you happen to use and a pattern that's documented as the default is that the second one survives you forgetting why you started doing it.

Same treatment for the per-agent model-tier rationale already living in `nix/personal/usman-mac.nix`'s `agentModels` — documented in place, not changed. Writing down *why* research runs on one tier and plan runs on another is cheap insurance against re-litigating the same choice from scratch six months later.

## Where this leaves the roadmap

This isn't the gVisor sandbox or the Firecracker transition — it's smaller and more immediately useful: a way to work from a different machine without losing the security posture (Tailscale over open SSH, sanitized exports over raw session data, a hard secret-scan gate over a soft one), plus the AGENTS.md and rationale documentation that makes the existing setup legible to a session that starts cold. Part 10's honest-status approach holds: this is what actually shipped, not what the original Q3/Q4 2026 milestones projected. The gVisor sandbox and the broker are still not started. This is the piece that turned out to matter first.
