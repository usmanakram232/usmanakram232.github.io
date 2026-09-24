---
title: "Post-publication refinements, corrections, and the migration gap"
date: 2026-06-28
description: "Three weeks of daily use after Parts 6-9: what changed, what I got wrong about the Lima VM, the manual migration steps no script can automate, and the honest status of the three-tier agent architecture."
part: 10
permalink: /blog/part-10-post-publication-refinements/
---

Part 9 ended with "The next post will cover the implementation: a working three-tier OpenCode setup." That post doesn't exist yet because that architecture isn't implemented yet. This post covers what happened instead: three weeks of daily use that revealed bugs, refinements, and a category of problem that no bootstrap script can solve.

This is a corrections-and-follow-up post, starting with the most important factual error.

## Correction: the Lima VM does not run NixOS

Part 8 described the OpenCode isolation VM as a custom NixOS qcow2 image built with `nixos-generators`. That was accurate at publication time. It was superseded within hours.

The daily-driver Lima VM now runs **Ubuntu 24.04 LTS** with the multi-user Nix daemon installed from the official NixOS installer during provisioning:

```yaml
# lima/opencode.yaml — provision section
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -euo pipefail
      if ! command -v nix &>/dev/null; then
        curl -L https://nixos.org/nix/install | sh -s -- --daemon --yes
      fi
```

Why the switch? The NixOS qcow2 approach required building the image on an aarch64-linux builder and transferring the resulting image to macOS. Every image update meant a cross-platform build pipeline. Ubuntu + Nix provision is simpler: Lima downloads the official Ubuntu cloud image, the provision script installs Nix, and the same Nix config that runs on the host runs inside the VM. No image transfers, no cross-compilation.

The `opencode-vm` fish wrapper still works exactly as described — `limactl start`, `limactl shell`, graceful shutdown, status, and journalctl. The NixOS config (`nixosConfigurations.opencode-lima` in flake.nix) still exists as a reference design. But the machine you get when you run `opencode-vm start` is Ubuntu.

I've updated the Part 8 source to reflect this. The rest of that post — the mounts, the security boundaries, the `opencode-vm` lifecycle wrapper — still holds.

## What daily use revealed

Parts 6-9 shipped a complete macOS bootstrap. Then I used it every day. Here's what broke.

### Aerospace window manager config

A couple of small config bugs in the tiling window manager setup surfaced during daily use: a keybinding conflict (`Alt+Return` collided with a different terminal shortcut, renamed to `Alt+Enter`) and a stale comment describing it. Small stuff, but the kind of thing you only notice once you've used the keybindings for a week.

### Sketchybar bar integration

The macOS menu bar replacement (Sketchybar) had a workspace-highlighting bug: it was subscribing all 9 workspace items individually to the `aerospace_workspace_change` event, so every switch fired the highlight script nine times instead of once. The fix replaced the per-item subscriptions with a single dedicated `ws_monitor` item that owns the event handler, plus a startup query (`aerospace list-workspaces --focused`) so the current workspace is highlighted correctly even before the first switch fires the event.

### Ghostty fish shell detection

Ghostty's `.app` bundle on macOS defaults to launching the system shell (`/bin/bash` or `/bin/zsh`) rather than the login shell, so fish abbreviations and starship weren't loading — the terminal was silently running the wrong shell. The Nix module had a `command = fish` override forcing Ghostty to launch fish directly. A subsequent Ghostty release fixed shell detection natively, so the override was removed. Cleaner config, one less workaround to track.

### Python tools version management

One tool in the `ai-tools.nix` module — `code-review-graph` — was pinned to a specific `uv`-managed CPython (3.14) to get matching C headers for a native extension (`watchdog`). It turned out the actual fix for the underlying build failure was unrelated to the Python version: it was the `SDKROOT`/`CPATH` environment variables set earlier in the same module for Xcode SDK headers. Once that was clear, the `--python 3.14` pin was dropped and the tool now just uses uv's default interpreter. The real fix — the SDK env vars — had been sitting there the whole time; the pin was just extra weight nobody needed.

### Font system overhaul

Nerd Font packages (FiraCode, JetBrains Mono, Hack) were originally declared via nix-darwin's `fonts.packages`, but that doesn't reliably register fonts with macOS Core Text on every macOS version. The fix moved them to Homebrew casks (`font-fira-code-nerd-font` etc.), which install directly into `~/Library/Fonts/` — a location macOS always scans. Same fonts, better registration, and no more guessing whether a fresh install actually picked them up.

### Locale and env variable fixes

Two smaller fixes that only surface on a fresh macOS install:

1. **Locale string format.** `LANG`/`LC_ALL` were declared as `en_US.UTF-8` in `.env` and `.profile`, but fish (and some tools that read the locale env vars directly) expect the lowercase/no-hyphen form `en_US.utf8`. Cosmetic-looking, but it was silently causing locale-dependent tools to fall back to the C locale.
2. **Homebrew PATH bootstrapping.** The fish config called `brew shellenv` to set up Homebrew's PATH, but on a fresh shell `brew` itself isn't in PATH yet until that command runs — a chicken-and-egg problem. The fix calls the full path (`/opt/homebrew/bin/brew shellenv`) instead of relying on `brew` already being resolvable.

### Bootstrap script refinements

The `mac-setup.sh` and `mac-restore.sh` scripts went through several rounds of cleanup after Part 8 went live:

- **mac-setup.sh** gained an `AnythingLLM.app` bundle-name fix and a switch from `fish -c` to `fish -ic` for abbreviation/starship verification checks (abbreviations only load in interactive shells, so the old check could silently pass or fail for the wrong reason).
- **mac-restore.sh** was generalized from a Google-Drive-and-rclone-specific restore flow to a generic restic-repository prompt (any path or URL — local drive, NAS, rclone remote, SFTP), with the Seagate external backup drive as one example path a user can type in. This dropped the file from roughly 787 lines to 359 as the Google Drive/rclone-specific code paths were removed.

## The migration gap: what no script can automate

The bootstrap scripts handle everything that can be declared in Nix: packages, config files, services, environment variables. Three things live outside that model.

### OpenCode config and skills

OpenCode's configuration uses a **mutable symlink** pattern:

```
~/.opencode/
├── opencode.json   → ~/dotfiles/.opencode/opencode.json  (symlinked, tracked)
├── bin/             binary, reinstalled by mac-setup.sh
├── node_modules/    generated by npm install
├── plugins/         installed at runtime
└── config.json      created by OpenCode itself
```

The `opencode.json` file is symlinked into the dotfiles repo and re-linked by `creatlinks.sh` on every `home-manager switch`. That part is automated.

Everything else in `~/.opencode/` is **not** backed up and **not** restored by any script. On a new machine:

1. Install the OpenCode binary: `curl -fsSL https://opencode.ai/install | bash`
2. Run `creatlinks.sh` to recreate the config symlink
3. Re-install skills: `npx skills install` (lockfile-tracked skills) and `npx skills add <repo>` for anything added ad hoc
4. OpenCode self-updates the binary and plugin packages

Three of those four steps are manual. The binaries and plugin packages are ephemeral — they get replaced on first run. But someone migrating machines needs to know to do this.

### Agent session history

The agent workspace at `~/.agent-work/` with its `research/`, `plans/`, `specs/`, and `status/` subdirectories is explicitly **ephemeral**. The `.gitignore` contains `*` — nothing is tracked. The workspace is excluded by design: agent outputs are intermediate artifacts, not committed knowledge.

Any agent session history from the last three weeks is gone on migration unless you copy it by hand — there's no backup script and no restore step. `creatlinks.sh` just recreates the directories empty.

If you're building something similar, decide upfront whether agent outputs are:
- **Ephemeral scratch space** (not backed up, versioned, or restored — current design)
- **Knowledge store** (committed, indexed, searchable — requires a different architecture)

I chose the former because it's simpler and agent outputs are regenerated on demand. But it's a choice, not an oversight.

### Zen Browser profile

The Zen Browser binary and its extensions are managed by Nix (`browser.nix`). The browser profile — bookmarks, history, sessions, extension settings — lives at `~/.zen/` and is **not** touched by any script.

A fresh macOS bootstrap gives you a pristine Zen install with extensions (uBlock Origin, ClearURLs, etc.) but a blank browser profile. Bookmarks are recovered via Firefox Sync. Session history is not. Extension settings are not.

The browser integration that makes Walker search your browser bookmarks (native-messaging-host bridge) is managed by Nix and redeployed automatically. But the profile data is entirely manual.

### The pattern

What these three have in common is that they're **runtime state**, not configuration. Nix is good at configuration — it has no opinion at all on runtime state, and expecting it to cover that ground was the actual mistake.

A `~/.opencode/` directory isn't a config file, a `~/.agent-work/` tree isn't a package, and a `~/.zen/` profile isn't a dotfile. Once you see that boundary, it's obvious which tool applies where, and you stop wasting time reaching for Nix on problems it was never built to solve.

## Status: three-tier agent architecture

Part 9 introduced the three-tier agent design: `@research` (read-only web/Jira), `@plan` (synthesis and spec writing), and `@implement` (code, builds, branches). The design document exists, the threat model holds up, and the agent prompts are drafted.

What does not exist:

- The web-fetch sanitisation MCP proxy (domain whitelist, injection scanning)
- The git wrapper MCP (branch protection, no push-to-main)
- The Jira MCP scoping (read-only for `@research`)
- The shared workspace handoff protocol
- Role-based agent definitions in OpenCode config

The work that replaced it is this post — fixing bugs, writing up the migration gaps, correcting Part 8. None of it's glamorous, but it makes the existing system actually reliable before I add more complexity on top of it.

The design doc is at `~/dotfiles/docs/handoff/opencode-multi-agent-setup.md` if you're following along. The milestones have shifted from "Q3 2026" to "when the daily setup stops needing fixes."

## Revised: what's next

The Phase 1 milestones from Part 5 have been re-evaluated after three months:

| Milestone | Original target | Current status |
|-----------|----------------|----------------|
| gVisor sandbox + MCP broker | Q3 2026 | Not started |
| Bedrock token minter | Q4 2026 | Partially done (scripts exist, token injection into sandbox doesn't) |
| Systemd supervisor | Q4 2026 | Not started |
| Firecracker microVMs | Q4 2026 | Not started |

The Bedrock token minter (`create-bedrock-role.sh` plus a `bedrock-token` launchd agent that assumes the role and refreshes short-lived credentials every 50 minutes, from Part 9) exists and works. The gap is injecting the token into a sandbox that doesn't exist yet.

The honest timeline: the three-tier agent architecture and the gVisor sandbox will arrive when the existing stack has been stable and bug-free for a sustained period. I'm not going to build a second layer on top of a foundation I'm still patching.

For anyone reading this series to build their own setup, the most useful parts are:

1. **Parts 1-3**: Declarative NixOS + agentic tools + security posture — stable, tested, daily-driver quality
2. **Parts 6-8**: macOS migration and bootstrap — functional but with the corrections noted here
3. **Part 9**: Production patterns (shared config, security scripts) — these hold up well
4. **This post**: The migration gap and honest status — the stuff that isn't documented anywhere else
