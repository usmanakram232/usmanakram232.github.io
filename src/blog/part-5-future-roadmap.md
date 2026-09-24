---
title: "Future roadmap: what's next"
date: 2026-02-12
description: "Heracles agents, Firecracker microVMs, full NixOS switch, flattened skill architecture, home server convergence, and a ten-year arc."
part: 5
permalink: /blog/part-5-future-roadmap/
---

The long-term vision behind all of this is a self-healing, autonomous development environment, built from a few concrete pieces:

1. A workstation that reproduces itself from source (`git clone` + `nixos-rebuild switch`)
2. Autonomous agents that handle ops triage, code review, and routine maintenance
3. Agent runners isolated in Firecracker microVMs with zero secrets
4. A home server that converges storage, backups, CI, and agent orchestration
5. All of it declared in Nix, with every change audited and version-controlled

Here's the concrete roadmap.

## Phase 1: complete the autonomous agent runner

The design's validated (`autonomous-agents-design.md`), the implementation plan's written, and I've broken execution into milestones:

### Milestone 0 — scaffolding and gVisor runtime
- [x] Design document written and reviewed
- [x] Implementation plan written, covering all milestones (8, numbered 0-7 in the plan doc — condensed to 7 phases below for readability)
- [ ] Install gVisor (`runsc`) and register as Docker runtime
- [ ] First tracer bullet: `docker run --runtime=runsc hello-world`

### Milestone 1 — isolation boundary
- [ ] Minimal sandbox image with scoped filesystem
- [ ] Verify `~/.aws`, `~/.ssh` are unreachable from inside sandbox
- [ ] Verify egress to arbitrary hosts fails

### Milestone 2 — MCP broker
- [ ] TypeScript MCP server with the 7 audited tools
- [ ] Read-only DB tool with statement allowlist
- [ ] Jira read + create-ticket (scoped project allowlist)
- [ ] GitHub open-PR (no merge, no push-to-main)
- [ ] Structured audit log (every call, every parameter)

### Milestone 3 — egress allowlist
- [ ] Host-side proxy (squid or nftables)
- [ ] Allowlist: bedrock-runtime + package registries + git hosts
- [ ] Default-deny for everything else

### Milestone 4 — Bedrock token minter
- [ ] Scoped `AssumeRole` session with bedrock-only policy
- [ ] Token injection into sandbox at job start
- [ ] Token expiry of 12 hours maximum

### Milestone 5 — supervisor and job lifecycle
- [ ] `systemd --user` supervisor that spawns/tears down per-job sandboxes
- [ ] Manual trigger interface (no auto-triggering from external sources)
- [ ] Audit log aggregation

### Milestone 6 — security audit
- [ ] External security review
- [ ] Penetration testing against the isolation boundary
- [ ] Go-live with daily ops agent

## Phase 2: Firecracker microVMs

gVisor is the starting point because it's simpler to integrate — Docker runtime, no kernel management required. The real target, though, is Firecracker microVMs, which give you hardware-level isolation.

The repo already has a declarative Firecracker configuration for this in `nix/vms/hermes/` — a different, already-existing system (the Hermes agent, not the autonomous-agent runner from Phase 1). It comes with TAP device + NAT networking, port forwarding (VM:3000 to host:3000 for Hermes Studio), systemd lifecycle management, and an SSH-based deploy script called `krops-hermes-deploy`. Despite the name, that script doesn't call the `krops` tool yet — it's just a plain `nix build` + `nix copy` + SSH activation. None of it has run on real hardware: it lives inside `nixosConfigurations.default`, the full NixOS config for the Linux desktop, and that machine — as Phase 4 covers below — hasn't adopted it. Call it a template to build Phase 2 from, not a proven deployment.

```
nixosConfigurations.hermes-vm  →  builds the VM rootfs
packages.krops-hermes-deploy   →  deploys via SSH
packages.hermes-vm-image       →  builds the raw ext4 image
services.firecracker-hermes    →  systemd unit for VM lifecycle
```

Moving from gVisor to Firecracker gets each agent a dedicated kernel instead of a user-space syscall interceptor, tighter resource isolation with a dedicated vCPU and pinned memory, and hardware-assisted security through KVM.

## Phase 3: Heracles — the Hermes agent evolution

The Hermes system — with a declarative Firecracker VM config already written per Phase 2, but not yet switched to and running — is set to evolve into a full agent platform called Heracles:

- **Studio**: Web UI for agent task management, audit log browsing, and manual review of agent outputs
- **Cron**: Scheduled agent runs (daily ops triage, weekly code health checks)
- **MCP catalog**: Agent-discoverable MCP tool registry
- **Insights**: Token usage tracking and cost attribution

The Hermes VM is configured for 2 vCPUs and 1 GB RAM, which should be plenty for the ops agent (I/O-bound, mostly reading Jira, CloudWatch, and databases) and the code agent (CPU-bound, but bottlenecked by LLM latency rather than sandbox compute) — once it's actually running.

## Phase 4: full NixOS switch

The new machine arrived, and it turned out to be a MacBook rather than a new Linux workstation — so the Phase 4 plan shifted.

The Linux desktop is still on Fedora with home-manager layered on top via `home-manager switch --flake .#usman`. That still works fine, the full NixOS switch for it stays on the list, and the NVMe encryption hardware limitation that's been blocking it still hasn't been resolved.

What actually changed was an assumption: I'd expected new machine to mean NixOS, but new machine really means whatever's the best tool for the job. For a work laptop running macOS-native apps — IntelliJ, AWS VPN, TestContainers via OrbStack — that's nix-darwin. [Parts 6-8](/blog/part-6-macos-migration/) of this series cover that migration.

The Linux machine will still eventually get a full NixOS switch, and the flake already supports it — `nixosConfigurations.default` is ready and waiting. The Fedora workaround delays that transition; it doesn't prevent it.

## Phase 5: skill architecture improvements

Skill deployment right now runs on three mechanisms at once — Nix store, live git clone, npm skills CLI — which works, but awkwardly. Here's the target:

- One mechanism. Either Nix-managed (read-only, reproducible) or a lightweight skills CLI that syncs from a manifest.
- Dependency graph. Skills that reference other skills should declare that dependency.
- Version pinning. Every skill should be pinned to a commit or semver range, with automatic hash verification.

The target state:

```bash
dotfilesctl skills add <org>/<repo>@<version>
dotfilesctl skills sync    # installs missing, updates pinned
dotfilesctl skills status  # shows drift from pinned versions
```

## Phase 6: home server convergence

A dedicated home server — the old laptop, currently running a handful of basic services — should eventually converge on:

- **Backup target**: restic repository, rclone cache, nightly rsync
- **Build worker**: offload Nix builds (faster on always-on server)
- **Agent runner**: Firecracker microVMs for long-running agents
- **Ollama server**: local LLM inference for privacy-sensitive agent tasks
- **Tailscale exit node**: route all mobile traffic through home for ad-blocking

The server runs the same flake (different hostname, different `hardware-configuration.nix`), sharing 90% of the config.

## Phase 7: devshell expansion

Current devshells cover the main languages I use, but some of them are undocumented:

| DevShell | Status | Notes |
|---|---|---|
| `java` | Active | Maven, JDK 21, daily use |
| `node` | Active | Frontend work |
| `rust` | Active | CLI tools, custom MCPs |
| `go` | Active | Tooling, daemons |
| `python` | Active | uv2nix-backed, AI tools |
| `cuda` | Occasional | ML model development |
| `android` | Occasional | Mobile builds |
| `ai` | Active | ML Python stack |
| `pageindex` | Active | Document indexing |

The goal: each devshell should have a `README.md` (or Nix doc comment) explaining what it's for and how to use it.

## Phase 8: dependency audit and reduction

The current `home.packages` list runs well past 100 entries — 125 on the Linux config, 88 on macOS, as of this writing — and some of them are redundant. I'm reviewing the list quarterly and cutting anything that hasn't been touched in 90 days.

## The ten-year arc

Beyond the concrete phases:

**Reproducible everything.** Every tool, config, service, and development environment is a Nix expression. The "works on my machine" problem is eliminated.

**Default-deny agent execution.** AI agents can only do what an audited, version-controlled policy allows. The Pattern 2 architecture (zero-secret, MCP-mediated) becomes the standard for agent deployment.

**Self-healing infrastructure.** The system detects drift, anomalies, and failures and fixes them via agent-driven remediation within the zero-secret constraint. A backup that failed? The agent retries with a different strategy. A Tailscale node dropped? The agent re-authenticates.

**Converged home infrastructure.** Laptop + home server + cloud VMs all share one config. The flake is the single source of truth for every machine.

**Skills as code.** AI agent skills are version-controlled, dependency-managed, and tested, just like software libraries. The line between code and prompt blurs, but reliability improves.

## When?

This is a hobby project, so there are no deadlines. The roadmap is ordered by priority:

- **Q3 2026**: Milestones 0-3 of the autonomous agent runner (gVisor + broker + egress)
- **Q4 2026**: Milestones 4-6 (Bedrock token minter + supervisor + audit) and Phase 2 Firecracker transition
- **2027**: Full NixOS switch, Heracles Studio, skill architecture overhaul
- **Longer term**: Home server convergence, devshell expansion, dependency reduction

The repo is at `~/dotfiles/`. Every step of this roadmap is in the git log. If you're building something similar, the `nix/` directory, `autonomous-agents-design.md`, and this series are the canonical references.
