---
title: "Reaching an agent session from anywhere, and not losing it afterward"
date: 2026-09-15
description: "Tailscale plus a disposable Lima VM for remote agent sessions, a nightly session backup gated by a secret scan, and the pipefail bug that nearly broke it."
part: 15
permalink: /blog/part-15-tailnet-vm-roadmap-catches-up/
---

I can now start an agent session on a disposable VM from any machine, and a nightly job backs up my session history with a secret scan in front of it. It is the first thing I shipped from the roadmap in [Part 5](/blog/part-5-future-roadmap/), though it is not the gVisor sandbox that roadmap led with.

The [Part 10](/blog/part-10-post-publication-refinements/) status table marked the gVisor sandbox, Bedrock token injection, the systemd supervisor, and Firecracker microVMs as "not started" or "partially done". I had planned to stop adding layers until the existing stack ran stably for a while. Eleven weeks later I needed to reach a session from another machine, so I built the smaller piece first. The design draws on [domenic.me's agentic coding setup](https://domenic.me/agentic-coding-setup/) and an Anthropic engineering interview, filtered through what fits this repo's existing patterns.

## What I changed

1. **Tailscale as a cask** in `nix/hosts/mac/default.nix`. It puts the Mac on a tailnet that I can reach over SSH from anywhere.
2. **`lima/agents-base.yaml`**, a disposable Lima VM modeled on the existing `lima/opencode.yaml`. It provisions Tailscale plus the Claude Code and OpenCode CLIs.
3. **A nightly `agent-session-backup` launchd agent** that exports sanitized OpenCode sessions and rsyncs Claude Code's `.jsonl` session files, with a secret scan in front of the commit.
4. **A written worktree policy** in `config/opencode/AGENTS.md`.

The two VM files differ in lifecycle. `opencode.yaml` is a long-running headless server. `agents-base.yaml` is meant to be started, used over SSH, and thrown away. Both use Lima, so I reused the existing pattern instead of building a new one.

## The backup and the bug that nearly broke it

Two decisions shape the backup. The export is sanitized, not raw. OpenCode's session store, `opencode.db`, is 6.3GB and the backup never touches it. The secret scan is a hard gate. If it does not come back clean, nothing gets committed.

The gate almost failed in the worst possible way. During testing, a pipefail bug made the pipeline treat "zero secrets found" as a failure. `grep` exits non-zero when it finds no matches, which is the correct signal, but it was piped into a step that read that exit code as "the scan failed". The job aborted before the commit step on every clean run. The backup would have looked healthy every night while committing nothing, and I would have found out weeks later when I went looking for a specific session. I caught it by testing the clean case on purpose, before it ran in production.

## Worktree policy and model rationale

The `wt-new`, `wt-cd`, and `wt-status` worktree tools already existed and I used them informally. I wrote them into `config/opencode/AGENTS.md` as the default for every agent session, so a session that starts cold reads the rule instead of relying on my habit. I also documented, next to `agentModels` in `nix/personal/usman-mac.nix`, why research runs on one model tier and planning on another. Writing that down means I do not have to re-derive the choice in six months.

## Where the roadmap stands

The gVisor sandbox, the broker, and Firecracker are still not started. What shipped is a way to work from another machine that keeps the security posture: Tailscale instead of open SSH, sanitized exports instead of raw session data, and a hard secret-scan gate instead of a soft one. I verified it with `darwin-rebuild build`, `nix flake check`, `limactl validate`, and a clean secret scan. The next post, [Part 16](/blog/part-16-pr-review-automation-take-two/), covers another script that behaved differently outside its usual environment.
