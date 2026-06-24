---
title: "The declarative NixOS stack"
date: 2026-01-15
description: "How a dotfiles repo evolved from shell scripts into a single flake that reproduces an entire Linux workstation."
part: 1
permalink: /blog/part-1-declarative-nixos-stack/
---

Every Linux developer has a `~/dotfiles` repo. For years, mine was a collection of shell scripts: `createlinks.sh` to symlink configs, `init.sh` to install packages, and a sprawling set of `.bashrc`/`.zshrc`/`.vimrc` files that accumulated entropy faster than I could clean it.

The problem wasn't the dotfiles themselves. It was the gap between intention and actual state. A package would upgrade and your carefully tuned `alacritty.yml` would stop working. You'd install a tool on one machine and forget on another. Your `~/.config/` looked different on every laptop, and "reproducible setup" meant re-reading your own README and hoping the `dnf install` commands hadn't rotted.

## Enter Nix

Nix is more than a package manager. It's a deployment system built on pure functions: every package, config file, service, and environment variable is declared in a Nix expression and built into an immutable store path. The machine is a derivation of your config, not the product of years of imperative drift.

This repo's config lives in `~/dotfiles/nix/`, organised as:

```
nix/
├── flake.nix              # Entry point: inputs + outputs
├── flake.lock             # Pinned revisions for reproducibility
├── hosts/default/         # NixOS system configuration
│   ├── configuration.nix  # Boot, networking, GPU, DNS, services
│   └── hardware-configuration.nix
├── home/                  # Home-manager user configuration
│   ├── default.nix        # Entry point, sops-nix, imports
│   ├── programs.nix       # CLI tools, GUI apps, systemd services
│   ├── shell.nix          # Fish + starship + zoxide + fzf
│   ├── terminal.nix       # Ghostty + tmux
│   ├── git.nix            # Git + jujutsu (jj)
│   ├── neovim.nix         # Nixvim (all 431 lines of nvim config)
│   ├── hyprland.nix       # Compositor + kanshi + waybar
│   ├── browser.nix        # Zen Browser with extensions
│   ├── vscode.nix         # VSCodium with extensions
│   ├── ai-tools.nix       # OpenCode, npm/uv tools, skills
│   ├── opencode-agents.nix
│   ├── work.nix           # SSM tunnels, CodeArtifact, VPN
│   ├── backup.nix         # Restic + rclone systemd timers
│   ├── walker.nix         # Walker launcher + Elephant Lua menus
│   └── hermes-host.nix    # Firecracker VM integration
└── devshells/             # Per-project development shells
    ├── java.nix
    ├── node.nix
    ├── rust.nix
    ├── go.nix
    ├── python.nix         # uv2nix-backed
    ├── cuda.nix
    ├── android.nix
    └── ai.nix
```

## The flake architecture

The `flake.nix` declares all inputs explicitly — no ambient system state:

- **nixpkgs-unstable** — rolling releases for the latest tools
- **home-manager** — user-level package and config management
- **hyprland** — the Wayland compositor (pinned to the same input as the portal)
- **zen-browser** — pre-built browser binaries
- **nixvim** — entire neovim config in Nix, with its own nixpkgs pin for plugin compatibility
- **uv2nix** — reproducible Python tool environments from `pyproject.toml` + `uv.lock`
- **sops-nix** — encrypted secrets at build time
- **walker + elephant** — Alfred-like launcher with custom Lua menus
- **krops** — deploy NixOS configs to VMs via SSH + rsync

The outputs cover everything:

| Output | Purpose |
|---|---|
| `nixosConfigurations.default` | The main machine: NixOS system + home-manager |
| `nixosConfigurations.iso` | Hardware-agnostic install ISO |
| `nixosConfigurations.hermes-vm` | Firecracker microVM config |
| `homeConfigurations.usman` | Standalone home-manager (testing on Fedora) |
| `packages.krops-hermes-deploy` | Deploy script for the VM |
| `devShells.java`, `devShells.node`, ... | 10 per-project development shells |

### Why standalone home-manager?

The `homeConfigurations.usman` output lets me run `home-manager switch --flake ~/dotfiles/nix#usman` on Fedora today. I can incrementally port configs without a full NixOS install. Every module in `nix/home/` works on both Fedora and NixOS. The Nix expressions are the same; only the system-level plumbing differs.

## The system layer

### Boot and kernel

```nix
boot.loader.systemd-boot.enable = true;
boot.loader.systemd-boot.configurationLimit = 10;
boot.kernelPackages = pkgs.linuxPackages_6_12;
```

Kernel 6.12 LTS is pinned because the `opensnitch` eBPF firewall doesn't build against 7.x yet. Under imperative management, this kind of detail breaks silently. In Nix, it's explicit and version-controlled.

### DNS: Unbound + NextDNS DNS-over-TLS

```nix
services.unbound = {
  enable = true;
  settings = {
    server = {
      interface = [ "127.0.0.1" "::1" ];
      access-control = [ "127.0.0.0/8 allow" "::1/128 allow" ];
      hide-identity = true;
      hide-version = true;
      harden-glue = true;
      harden-dnssec-stripped = true;
    };
    forward-zone = [{
      name = ".";
      forward-tls-upstream = "yes";
      forward-addr = [
        "45.90.28.0@853#usman-ca9fb1.dns.nextdns.io"
        "45.90.30.0@853#usman-ca9fb1.dns.nextdns.io"
      ];
    }];
  };
};
```

All DNS queries are encrypted via TLS to NextDNS, with DNSSEC hardening. The local resolver listens on `127.0.0.1:53`, and `systemd-resolved` is disabled to avoid port conflicts. This is a single block in `configuration.nix`. On a traditional system it would mean installing unbound, writing config files, setting up systemd overrides, and hoping nothing conflicts.

### GPU: PRIME offload

```nix
hardware.nvidia.prime = {
  offload = {
    enable = true;
    enableOffloadCmd = true;
  };
  intelBusId  = "PCI:0:2:0";
  nvidiaBusId = "PCI:1:0:0";
};
```

The Intel iGPU drives all displays (Hyprland runs on it). The NVIDIA Quadro P620 dGPU is available on demand via `nvidia-offload <cmd>`. Power management is fine-grained: the dGPU powers down when idle. On a traditional distro this requires manual `xrandr` configuration, driver blacklisting, and kernel parameter tweaking.

### Plymouth boot splash

```nix
boot.plymouth = {
  enable = true;
  theme  = "spinner";
  logo   = ../../resources/ginmon.png;
};
```

Because even your boot loader should be under version control. The logo PNG is committed to the repo, always available at build time.

## The user layer

### Fish shell with declarative config

The entire fish shell configuration is declared in `shell.nix`:

```nix
programs.fish = {
  enable = true;
  shellAbbrs = {
    cd     = "z";
    vim    = "nvim";
    ls     = "eza --icons --git --long --all --header --classify";
    ",gc"  = "git clone";
    ",prs" = "gh pr list";
    # ... 50+ abbreviations
  };
  functions = {
    y   = { body = ''yazi $argv --cwd-file="$tmp" ...''; };
    ide = { body = ''tmux new-session ...''; };
  };
  plugins = [{ name = "fzf-fish"; src = pkgs.fishPlugins.fzf-fish.src; }];
};
```

No `config.fish` file to maintain. The shell, prompt (starship), directory navigation (zoxide), and fuzzy finder (fzf) are all declared in Nix and rebuilt atomically.

### Full package set

The `programs.nix` file lists every CLI tool and GUI app the system needs. A few highlights:

```nix
home.packages = with pkgs; [
  # Modern CLI replacements
  eza bat fd ripgrep sd xcp dust duf procs
  # System monitoring
  bottom iotop iftop mtr bandwhich
  # Development
  corretto21                     # JDK
  pkgs.jetbrains.idea            # IntelliJ Ultimate
  ghostty                        # Terminal emulator
  # Desktop
  waybar dunst swaylock swayidle
  hyprpaper nwg-displays
  keepassxc
  # Custom derivations
  portless
  (pkgs.appimageTools.wrapType2 { ... })
];
```

Custom derivations are declared inline. `portless` — a tool that creates stable `https://name.localhost` URLs — is fetched from the npm registry as a tarball, extracted, and wrapped with Node.js, all in about 15 lines of Nix.

### nixvim: neovim in Nix

The 431-line `neovim.nix` declares the entire neovim configuration: keymaps, plugins, LSP servers, no Lua files. The `nixvim` flake input pins its own nixpkgs for plugin compatibility while the wrapper uses the system nixpkgs:

```nix
programs.nixvim = {
  enable = true;
  defaultEditor = true;
  # Keyboard-driven IDE with telescope, oil.nvim, trouble,
  # fugitive, gitsigns, vim-tmux-navigator, and more
};
```

## Per-project devshells

The Nix feature I reach for most is devshells: per-project development environments that eliminate "works on my machine":

```bash
nix develop ~/dotfiles/nix#java
# → fish shell with Maven, JDK 21, everything in PATH

nix develop ~/dotfiles/nix#python
# → fish shell with Python 3.12, uv, and all project tools
```

Each devshell wraps itself in fish (via `wrapFish`), so the shell experience is identical to the host:

```nix
wrapFish = shell: shell.overrideAttrs (old: {
  shellHook = (old.shellHook or "") + ''
    export SHELL=${pkgs.fish}/bin/fish
    exec ${pkgs.fish}/bin/fish
  '';
});
```

I have 10 devshells currently: `java`, `node`, `rust`, `go`, `python` (uv2nix-backed), `cuda`, `android`, `ai`, and `pageindex`. Each is a complete, reproducible environment entered with `nix develop`.

### direnv integration

With `direnv` + `nix-direnv`, entering a project directory automatically activates its devshell:

```bash
echo "use flake ~/dotfiles/nix#java" > .envrc && direnv allow
```

No more wondering why `mvn` works on one machine but not another.

## The terminal IDE

One function I use daily is the `ide` command, a tmux layout that creates a project-aligned development environment:

```
┌─────────┬──────────────────────┐
│         │                      │
│  yazi   │      nvim .          │
│  (25%)  │      (60%)           │
│         │                      │
│         ├──────────────────────┤
│         │                      │
│  file   │    shell / claude    │
│  tree   │      (40%)           │
│         │                      │
└─────────┴──────────────────────┘
```

It automatically re-attaches to existing sessions, starts each pane inside the `#java` devshell, and can be invoked with a single command from any project directory.

## What this enables

A NixOS config this complete means:

1. **Reproducibility.** A `git clone` + `nixos-rebuild switch` produces an identical machine.
2. **Rollback.** Every generation is a boot option. Broken upgrade? Boot the previous generation.
3. **Auditability.** Every installed package, every config change, every service is in version control.
4. **Incremental migration.** `home-manager switch --flake .#usman` works on Fedora today.
5. **Zero ambient state.** The machine is exactly what the config says. Nothing more, nothing less.

In [Part 2](/blog/part-2-agentic-development-stack/), I'll show how this declarative foundation enables something more ambitious: a fully agentic AI development environment with multi-model inference, 90+ skills, and a three-tier agent pipeline.
