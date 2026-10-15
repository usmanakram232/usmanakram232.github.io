---
title: "Future roadmap: what's next"
date: 2026-02-12
description: "The February 2026 plan for the dotfiles: a gVisor agent runner, Firecracker microVMs, skill cleanup, and a home server, with a September status update."
part: 5
permalink: /blog/part-5-future-roadmap/
---

> **Update, 2026-09-30.** I wrote this roadmap in February. Since then the new machine turned out to be a MacBook ([Parts 6 to 8](/blog/part-6-macos-migration/)), and most of the agent runner below is still unbuilt. The status notes in each phase say what happened. The short version: the design documents exist, the Bedrock credential role and a Lima VM for agents exist ([Part 15](/blog/part-15-tailnet-vm-roadmap-catches-up/)), and the gVisor sandbox, the MCP broker, and Firecracker are not started. I left the original plan below so the comparison is visible.

The goal is a development environment that rebuilds itself from source and runs unattended agents safely. It has five pieces:

1. A workstation that reproduces itself with `git clone` and `nixos-rebuild switch`.
2. Autonomous agents for ops triage, code review, and routine maintenance.
3. Agent runners isolated in Firecracker microVMs with no secrets.
4. A home server for storage, backups, CI, and agent orchestration.
5. Everything declared in Nix, with each change version-controlled.

## Phase 1: the autonomous agent runner

[Part 4](/blog/part-4-agent-security/) explains the design: the agent holds no secrets, and a host-side broker exposes a few audited tools. This phase turns that design into milestones. The design (`autonomous-agents-design.md`) and an implementation plan covering eight milestones (0 to 7) are written. I condensed them to seven below.

| Milestone | Scope | Status on 2026-09-30 |
|---|---|---|
| 0. gVisor runtime | Install `runsc`, register it as a Docker runtime, run `hello-world` under it | Not started |
| 1. Isolation boundary | Minimal sandbox image; confirm `~/.aws` and `~/.ssh` are unreachable and arbitrary egress fails | Not started |
| 2. MCP broker | TypeScript MCP server with 7 audited tools (read-only DB, ticket tracker, open-PR) and a full audit log | Not started |
| 3. Egress allowlist | Host-side proxy that allows Bedrock, package registries, and git hosts and denies the rest | Not started |
| 4. Bedrock credential minter | Scoped `AssumeRole` session, injected at job start, 12 hours maximum | Partly done: `create-bedrock-role.sh` and a launchd agent that refreshes credentials exist, but nothing injects them into a sandbox |
| 5. Supervisor | `systemd --user` unit that starts and tears down per-job sandboxes, manual trigger only | Dropped. The machine is now macOS, so a launchd-based equivalent would replace it |
| 6. Security audit | External review and penetration test of the isolation boundary | Not started |

## Phase 2: Firecracker microVMs

gVisor comes first because it needs no kernel management. The eventual target is Firecracker, which gives each agent its own guest kernel, a dedicated vCPU, pinned memory, and KVM hardware isolation.

In February I described a Firecracker configuration for the Hermes agent under `nix/vms/hermes/`, with a TAP network, a systemd unit, and a deploy script. It never ran on real hardware. **Status:** that directory no longer exists in the repo, and Firecracker needs KVM, which macOS does not have. The repo now holds a handoff document (`nix/autonomous-agents-firecracker-handoff.md`) that marks Firecracker as future work, and the agents that do run today live in Lima VMs. I consider this phase dropped for the Mac and open for the Linux desktop.

## Phase 3: Heracles

Update, 2026-10-15: I now do ticket and queue triage through a retro command instead of an ops agent, so this agent was not built.

Hermes is the agent I planned to use for ops triage. Heracles was the name for a larger platform built around it, with four parts: a web UI for task management and audit logs (Studio), scheduled runs (Cron), a registry of MCP tools, and token usage tracking. **Status:** none of it is built. The repo has a Hermes VM definition in `lima/hermes.yaml` but nothing named Heracles.

## Phase 4: full NixOS switch

The Linux desktop runs Fedora with home-manager on top (`home-manager switch --flake .#usman`). A full NixOS switch is blocked by an NVMe encryption hardware limitation. `nixosConfigurations.default` is ready in the flake and waits for that to change.

**Status:** the new machine I expected to be NixOS was a MacBook, so the macOS port took priority. The Linux switch stays on the list.

## Phase 5: skill architecture

Skills were deployed three ways at once: the Nix store, a live git clone, and the npm skills CLI. The target was one mechanism, declared dependencies between skills, and every skill pinned to a commit with hash verification, driven by a CLI:

```bash
dotfilesctl skills add <org>/<repo>@<version>
dotfilesctl skills sync
dotfilesctl skills status
```

**Status:** partly done, without `dotfilesctl`. [Part 13](/blog/part-13-skills-consolidation/) covers the consolidation, and the repo now has `skills/catalog.yaml` and `scripts/pin-skill-hashes.sh` for pinning.

## Phase 6: home server

The old laptop, which runs a few basic services, should become a restic and rclone backup target, a Nix build worker, an agent runner, an Ollama server for local inference, and a Tailscale exit node. It would run the same flake with its own hostname and `hardware-configuration.nix`. **Status:** not started. Tailscale now runs on the Mac instead ([Part 15](/blog/part-15-tailnet-vm-roadmap-catches-up/)).

## Phase 7: devshell documentation

The repo had nine devshells, and some were undocumented. The goal was a short README or doc comment on each. **Status:** there are now ten (`browser-use.nix` was added), and the READMEs are not written.

## Phase 8: dependency audit

The `home.packages` list was 125 entries on Linux and 88 on macOS in February. I planned to review it quarterly and cut anything untouched for 90 days. **Status:** I have not counted since. [Part 7](/blog/part-7-security-audit/) includes the audit checklist that covers this.

## The schedule as I wrote it

This is a hobby project without deadlines. In February I ordered the work like this:

- Q3 2026: milestones 0 to 3 of the agent runner.
- Q4 2026: milestones 4 to 6 and the move to Firecracker.
- 2027: the full NixOS switch, Heracles Studio, and the skill overhaul.
- Later: the home server, devshell docs, and dependency reduction.

Q3 is over and milestones 0 to 3 have not started. I no longer commit to these dates.
