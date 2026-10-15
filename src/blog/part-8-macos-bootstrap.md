---
title: "New machine, one hour: a fully automated macOS bootstrap"
date: 2026-06-27
description: "One script takes a bare MacBook to the full nix-darwin setup: ten idempotent stages, a data restore script, and a Lima VM that isolates the OpenCode agent."
part: 8
permalink: /blog/part-8-macos-bootstrap/
---

The test of any declarative setup is the first boot on a new machine. Can you go from bare metal to a configured, secure workstation in under an hour?

This post describes the macOS bootstrap pipeline that follows the port in [Part 6](/blog/part-6-macos-migration/). One script handles the flow from Nix installation through Homebrew casks to app permission grants. Supporting pieces are a Docker runtime for TestContainers, a Lima VM for agent isolation, and a restore script that pulls data from encrypted backups.

## The bootstrap pipeline

The entry point is a single command:

```bash
bash ~/dotfiles/scripts/mac-setup.sh
```

This runs the following stages, each idempotent:

### Automated (10 stages, no interaction needed)

```
1. Xcode CLT          → git, compilers, SDK headers
2. Determinate Nix    → Nix package manager
3. Age key check      → gate for sops-nix decryption
4. nix-darwin switch  → packages, configs, services, defaults
5. Homebrew           → GUI applications (Raycast, Ghostty, IntelliJ, Zen Browser, and others)
6. Fish default shell → set via chsh
7. SSH Keychain       → ssh-add --apple-use-keychain
8. OpenCode           → AI agent binary
9. Cloud login        → browser login for cloud credentials
10. NextDNS profile   → installs the DoH/DoT mobileconfig
```

### Manual (macOS requires a click)

```
11. App permissions    → Karabiner (Accessibility + Input Monitoring)
                       → AltTab (Accessibility)
                       → Raycast (set Alt+Space hotkey)
                       → Shottr (Screen Recording)
```

### Verification (18 smoke tests)

After all stages, `mac-setup.sh` runs smoke tests against everything it just installed:

```bash
✔ nix flake        ✔ fish shell    ✔ starship       ✔ zoxide
✔ neovim           ✔ ripgrep       ✔ eza            ✔ gh CLI
✔ awscli           ✔ restic        ✔ uv             ✔ SSH → GitHub
✔ Ghostty config   ✔ fish abbrs    ✔ starship/fish   ✔ nextdns running
✔ nextdns mobileconfig  ✔ opencode binary
```

## Why idempotence matters

Every stage checks what's already done and skips it, so running `mac-setup.sh` ten times is the same as running it once. Reset your Homebrew casks and rerun the script, and it skips Nix entirely, going straight to re-running the switch. Break fish somehow and rerun it, and it notices the shell is broken and resets it. On a brand-new Mac there's nothing to skip yet, so every stage just runs.

The check pattern is simple and consistent:

```bash
if command -v tool &>/dev/null; then
  skip "Tool already installed"
else
  install_tool
fi
```

## Data restore

The setup script handles the machine, but data restoration is a separate script:

```bash
bash ~/dotfiles/scripts/mac-restore.sh
```

This restores from the Google Drive restic repository (encrypted) and optionally from an external Seagate drive:

1. Cloud credentials (`~/.aws`)
2. VPN configs (`~/Documents/secure`) and `.mobileconfig` profiles
3. GPG keys; imported into keyring
4. Dev notes; synced from Google Drive via rclone
5. IdeaProjects; cloned from GitHub via `gh repo list`, or restored from Seagate restic
 6. Project work config; restored from Seagate
7. Mobileconfig profiles; installed via macOS System Settings

## The one critical manual step

One thing can never be automated: the age key.

```bash
# ~/.config/sops/age/keys.txt
# This decrypts EVERYTHING: SSH key, GPG key, restic passwords, API keys
```

The age key is the root secret; everything else in the repo decrypts from it, and you can't store the root secret inside the repo it decrypts. So it lives in KeepassXC as a secure note. On a new machine: open KeepassXC, copy, paste, `chmod 600`. Then `darwin-rebuild switch` decrypts and places all secrets automatically. [Part 7](/blog/part-7-security-audit/) explains why the SSH and GPG keys are in that set.

## Docker for TestContainers: Lima, not OrbStack

> **Correction, 2026-09-30.** The first version of this post recommended OrbStack as the Docker runtime. That did not hold up. OrbStack was in the cask list, but I never started it, and no `docker.sock` ever came from it. I removed the cask from `nix/hosts/mac/default.nix`, where a comment says it was never used. Docker actually runs in a Lima VM (`lima/docker.yaml`), and `nix/home/mac-docker-lima.nix` points `DOCKER_HOST` and the TestContainers settings at that VM's socket. The bootstrap script's OrbStack permission check is left over from the original plan.

For Maven TestContainers (database integration tests that need Docker), the runtime is a rootless Docker daemon inside a Lima VM, and the socket is forwarded to the host. TestContainers reads `~/.docker-java.properties`, which home-manager writes, so no Maven project changes are needed. `mvn test` behaves the same as on Linux. [Part 14](/blog/part-14-lightning-round/) covers the Docker changes since.

## Lima and Ubuntu for agent isolation

For OpenCode and AI agents, I needed stronger isolation than a bare process. The solution is a Lima VM running Ubuntu 24.04 LTS with Nix installed on top:

```
Security boundaries:
  CAN access:  ~/IdeaProjects (read-write), ~/dotfiles (read-only),
                  ~/.config/opencode, internet (LLM APIs)
  CANNOT access: ~/.ssh, ~/.gnupg, ~/.aws, ~/.restic, ~/.work,
                    host home directory, host sockets
```

The VM runs inside Apple's Virtualization.framework (vmType: vz) for near-native performance. Mounts are scoped via virtiofs:

```yaml
# lima/opencode.yaml
mounts:
  - location: "~/IdeaProjects"    # writable; agents make edits
  - location: "~/dotfiles"         # read-only; skills reference
  - location: "~/.config/opencode" # writable; config updates
mountHome: false                   # DON'T mount host home
```

The base image is Ubuntu 24.04 LTS, downloaded by Lima on first start. A provision script installs Nix via the official multi-user daemon installer (not the Determinate installer used on the host; the VM's minimal cloud image just needs the vanilla Nix daemon), then makes OpenCode-specific tooling available through the shared Nix config:

```yaml
# lima/opencode.yaml (provision section)
provision:
  - mode: system
    script: |
      curl -L https://nixos.org/nix/install | sh -s -- --daemon --yes
```

No custom image build is required; Lima's built-in image download plus the provision script produce a ready-to-use VM on the first `limactl start`. The `opencode-vm` fish function handles the lifecycle:

```fish
opencode-vm start      # limactl start
opencode-vm shell      # SSH into running VM
opencode-vm stop       # graceful shutdown
opencode-vm status     # limactl list
opencode-vm logs       # journalctl -f
```

The original NixOS VM image (`nixosConfigurations.opencode-lima` in flake.nix) still exists in the repo as a reference, but the daily driver switched to Ubuntu + Nix provision for simpler maintenance; no cross-platform NixOS image build, no qcow2 image transfer between machines.

## What stays manual

After the pipeline, three kinds of step remain manual:

1. Copying the age key, the sops decryption key, which cannot live in the repo.
2. Granting app permissions for Karabiner, AltTab, and Shottr, plus setting the Raycast hotkey. macOS requires a click for Accessibility and Screen Recording.
3. Logging in to cloud accounts, which happens in a browser.

Everything else is a single command:

```bash
bash ~/dotfiles/scripts/mac-setup.sh    # Full setup, about 40 min
bash ~/dotfiles/scripts/mac-restore.sh  # Data restore → depends on how much
```

## What the flake reproduces

After one `git clone` and two commands I have a terminal with fish abbreviations and the Dracula theme, a tiling window manager with hjkl workspaces, encrypted DNS, Docker for TestContainers, AI agents isolated in a Lima VM, and every secret decrypted from sops.

The flake at `~/dotfiles/nix/` is the source of truth for both Linux and macOS.
