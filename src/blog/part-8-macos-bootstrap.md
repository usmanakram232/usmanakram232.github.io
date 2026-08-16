---
title: "New Machine, One Hour: A Fully Automated macOS Bootstrap"
date: 2026-06-27
description: "From a bare MacBook to the full nix-darwin setup in a single script — and the tools that make it possible: OrbStack for Docker/TestContainers, Lima for OpenCode isolation, and the unified setup orchestrator."
part: 8
permalink: /blog/part-8-macos-bootstrap/
---

The test of any declarative setup is the first boot on a new machine. Can you go from bare metal to a fully configured, secure workstation in under an hour?

This post describes the macOS bootstrap pipeline: a single script that handles the entire flow from Nix installation through Homebrew casks to app permission grants. And the supporting tools for daily work: OrbStack for Docker, Lima for agent isolation, and the restore script that pulls data from encrypted backups.

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
5. Homebrew           → GUI applications (Raycast, Ghostty, IntelliJ, Zen Browser...)
6. Fish default shell → set via chsh
7. SSH Keychain       → ssh-add --apple-use-keychain
8. OpenCode           → AI agent binary
9. AWS SSO            → browser login for SSM tunnels
10. NextDNS profile   → installs the DoH/DoT mobileconfig
```

### Manual (crew-mandated, can't be automated)

```
11. App permissions    → Karabiner (Accessibility + Input Monitoring)
                       → AltTab (Accessibility)
                       → Raycast (set Alt+Space hotkey)
                       → Shottr (Screen Recording)
                       → OrbStack (virtualization permissions)
```

### Verification (18 checks)

After all stages, `mac-setup.sh` runs smoke tests against everything it just installed:

```bash
✔ nix flake        ✔ fish shell    ✔ starship       ✔ zoxide
✔ neovim           ✔ ripgrep       ✔ eza            ✔ gh CLI
✔ awscli           ✔ restic        ✔ uv             ✔ SSH → GitHub
✔ Ghostty config   ✔ fish abbrs    ✔ starship/fish   ✔ nextdns running
✔ nextdns mobileconfig  ✔ opencode binary
```

## Why idempotence matters

Every stage checks what's already done and skips it. Running `mac-setup.sh` ten times is the same as running it once. This means:

- **Rerun after a Homebrew cask reset**: skips Nix and re-runs the switch
- **Rerun after breaking fish**: detects the broken shell and re-sets it
- **First run on a new Mac**: every stage runs

The check pattern is simple and consistent:

```bash
if command -v tool &>/dev/null; then
  skip "Tool already installed"
else
  install_tool
fi
```

## Data restore

The setup script handles the machine. Data restoration is a separate script:

```bash
bash ~/dotfiles/scripts/mac-restore.sh
```

This restores from the Google Drive restic repository (encrypted) and optionally from an external Seagate drive:

1. AWS config (`~/.aws`) — SSM tunnels, CodeArtifact, SSO profiles
2. VPN configs (`~/Documents/secure`) — AWS VPN `.ovpn` files, `.mobileconfig` profiles
3. GPG keys — imported into keyring
4. Dev notes — synced from Google Drive via rclone
5. IdeaProjects — cloned from GitHub via `gh repo list`, or restored from Seagate restic
 6. Project work config — restored from Seagate
7. Mobileconfig profiles — installed via macOS System Settings

## The one critical manual step

One thing can never be automated: the age key.

```bash
# ~/.config/sops/age/keys.txt
# This decrypts EVERYTHING: SSH key, GPG key, restic passwords, API keys
```

The age key is the root secret. Everything else in the repo decrypts from it. You can't store the root secret in the repo it decrypts. By definition. So it lives in KeepassXC as a secure note. On a new machine: open KeepassXC, copy, paste, `chmod 600`. Then `darwin-rebuild switch` decrypts and places all secrets automatically.

## New tools: OrbStack for Docker

For Maven TestContainers (database integration tests that need Docker), I use **OrbStack** instead of Docker Desktop:

| | Docker Desktop | OrbStack |
|---|---|---|
| Memory | Static VM allocation | Dynamic (returns RAM when not in use) |
| Performance | Moderate | Near-native (Virtualization.framework) |
| Disk I/O | Slow (ext4 on macOS) | Fast (virtiofs) |
| Licensing | Business license needed | Free for personal use |
| Docker socket | `/var/run/docker.sock` | Same — testcontainers picks it up |

TestContainers finds it automatically via the Docker socket. No Maven project changes needed. `mvn test` with TestContainers works the same as on Linux.

## New tools: Lima + Ubuntu for agent isolation

For OpenCode and AI agents, I needed stronger isolation than a bare process. The solution is a **Lima VM** running Ubuntu 24.04 LTS with Nix installed on top:

```
Security boundaries:
  ✅ CAN access:  ~/IdeaProjects (read-write), ~/dotfiles (read-only),
                  ~/.config/opencode, internet (LLM APIs)
  ❌ CANNOT access: ~/.ssh, ~/.gnupg, ~/.aws, ~/.restic, ~/.work,
                    host home directory, host sockets
```

The VM runs inside Apple's Virtualization.framework (vmType: vz) for near-native performance. Mounts are scoped via virtiofs:

```yaml
# lima/opencode.yaml
mounts:
  - location: "~/IdeaProjects"    # writable — agents make edits
  - location: "~/dotfiles"         # read-only — skills reference
  - location: "~/.config/opencode" # writable — config updates
mountHome: false                   # DON'T mount host home
```

The base image is Ubuntu 24.04 LTS, downloaded by Lima on first start. A provision script installs Nix via the official multi-user daemon installer (not the Determinate installer used on the host — the VM's minimal cloud image just needs the vanilla Nix daemon), then makes OpenCode-specific tooling available through the shared Nix config:

```yaml
# lima/opencode.yaml (provision section)
provision:
  - mode: system
    script: |
      curl -L https://nixos.org/nix/install | sh -s -- --daemon --yes
```

No custom image build is required — Lima's built-in image download plus the provision script produce a ready-to-use VM on the first `limactl start`. The `opencode-vm` fish function handles the lifecycle:

```fish
opencode-vm start      # limactl start
opencode-vm shell      # SSH into running VM
opencode-vm stop       # graceful shutdown
opencode-vm status     # limactl list
opencode-vm logs       # journalctl -f
```

The original NixOS VM image (`nixosConfigurations.opencode-lima` in flake.nix) still exists in the repo as a reference, but the daily driver switched to Ubuntu + Nix provision for simpler maintenance — no cross-platform NixOS image build, no qcow2 image transfer between machines.

## Where I'm running out of things to automate

After this bootstrapping pipeline, only three things remain manual:

1. **Age key copy**: the decryption key for sops. Can't be in the repo.
2. **App permission grants**: macOS requires user click for Accessibility and Screen Recording.
3. **AWS SSO login**: browser-based, can't be scripted.

Everything else is a single command:

```bash
bash ~/dotfiles/scripts/mac-setup.sh    # Full setup → ~40 min
bash ~/dotfiles/scripts/mac-restore.sh  # Data restore → depends on how much
```

## What this enables

From a bare MacBook to a productive, secure developer workstation in a single session: terminal with fish abbreviations and Dracula theme, tiling window manager with hjkl workspaces, encrypted DNS, Docker for TestContainers, AI agents isolated in a Lima VM, and every secret decrypted from sops automatically. One `git clone`, two commands.

The flake at `~/dotfiles/nix/` is the single source of truth. Linux or macOS, it reproduces the same setup.
