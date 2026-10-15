---
title: "The declarative NixOS stack"
date: 2026-01-15
description: "How my dotfiles went from symlink scripts to one Nix flake that rebuilds a Linux workstation: system, shell, editor, devshells and secrets."
part: 1
permalink: /blog/part-1-declarative-nixos-stack/
---

This series follows one dotfiles repo as it grows from a Linux workstation config into an agent environment, a security model, and a macOS port. Parts 1 to 5 cover the NixOS design: the flake (this post), the agent stack ([Part 2](/blog/part-2-agentic-development-stack/)), the security layers ([Part 3](/blog/part-3-security-posture/)), agent isolation ([Part 4](/blog/part-4-agent-security/)) and a roadmap ([Part 5](/blog/part-5-future-roadmap/)). Later parts cover what broke and changed after I moved to macOS. It is written for developers who already keep a dotfiles repo and want to see what Nix changes about it. Some parts describe working systems and some describe designs, and each post says which.

For years my dotfiles were a pile of shell scripts: `createlinks.sh` to symlink configs, `init.sh` to install packages, and a growing mess of `.bashrc`/`.zshrc`/`.vimrc` files that got messier every time I touched them.

The dotfiles themselves weren't the problem. The gap between what I intended and what was actually on the machine was. A package would upgrade and my carefully tuned `alacritty.yml` would stop working. I'd install a tool on one laptop and forget it existed on another. `~/.config/` looked different on every machine, and "reproducible setup" really meant re-reading my own README and hoping the `dnf install` commands still worked.

## Enter Nix

Nix is more than a package manager. It is a deployment system built on pure functions: every package, config file, service, and environment variable is declared in a Nix expression and built into an immutable store path. The machine is a derivation of your config, not the product of years of imperative drift.

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
│   ├── ai-tools/          # OpenCode, npm/uv tools, skills (a directory now)
│   ├── opencode-agents.nix
│   ├── work.nix           # a private work module
│   ├── backup.nix         # Restic + rclone systemd timers
│   └── walker.nix         # Walker launcher + Elephant Lua menus
└── devshells/             # Per-project development shells
    ├── java.nix
    ├── node.nix
    ├── rust.nix
    ├── go.nix
    ├── python.nix         # uv2nix-backed
    ├── cuda.nix
    ├── android.nix
    ├── ai.nix
    ├── browser-use.nix
    └── pageindex.nix
```

## The flake architecture

The `flake.nix` declares all inputs explicitly, so there is no ambient system state. The list below is the original set. Since then I added nix-darwin and nixos-generators for the macOS port and the VM images.

- **nixpkgs-unstable** rolling releases for the latest tools
- **home-manager** user-level package and config management
- **hyprland** the Wayland compositor (pinned to the same input as the portal)
- **zen-browser** pre-built browser binaries
- **nixvim** entire neovim config in Nix, with its own nixpkgs pin for plugin compatibility
- **uv2nix** reproducible Python tool environments from `pyproject.toml` + `uv.lock`
- **sops-nix** encrypted secrets at build time
- **walker + elephant** Alfred-like launcher with custom Lua menus

The outputs cover everything:

| Output | Purpose |
|---|---|
| `nixosConfigurations.default` | The main machine: NixOS system + home-manager |
| `nixosConfigurations.iso` | Hardware-agnostic install ISO |
| `homeConfigurations.usman` | Standalone home-manager (testing on Fedora) |
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

Kernel 6.12 LTS is pinned because the `opensnitch` eBPF firewall doesn't build against 7.x yet. Under imperative management, this kind of detail breaks without warning. In Nix, it is explicit and version-controlled.

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
        "45.90.28.0@853#profile-a1b2c3.dns.nextdns.io"
        "45.90.30.0@853#profile-a1b2c3.dns.nextdns.io"
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
  logo   = ../../../resources/logo.png;   # path relative to hosts/default/
};
```

The logo PNG is committed to the repo, so it is always available at build time.

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

Custom derivations are declared inline. `portless` a tool that creates stable `https://name.localhost` URLs is fetched from the npm registry as a tarball, extracted, and wrapped with Node.js, all in about 15 lines of Nix.

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

I have 10 devshells: `java`, `node`, `rust`, `go`, `python` (uv2nix-backed), `cuda`, `android`, `ai`, `browser-use`, and `pageindex`. Each is a complete, reproducible environment entered with `nix develop`.

### direnv integration

With `direnv` + `nix-direnv`, entering a project directory automatically activates its devshell:

```bash
echo "use flake ~/dotfiles/nix#java" > .envrc && direnv allow
```

No more wondering why `mvn` works on one machine but not another.

## The terminal IDE

One function I use daily is the `ide` command, a tmux layout that creates a project-aligned development environment:

<figure class="diagram">
<svg viewBox="0 0 640 256" role="img" aria-labelledby="ide-layout-title ide-layout-desc" xmlns="http://www.w3.org/2000/svg"><title id="ide-layout-title">The ide tmux layout</title><desc id="ide-layout-desc">A tmux layout with a yazi file tree on the left, nvim on the top right and a shell or claude pane below it.</desc><rect class="d-box" x="0" y="0" width="160" height="256" rx="6"/><text class="d-name" x="16" y="132">yazi</text><text class="d-sub" x="16" y="152">file tree, 25%</text><rect class="d-box" x="176" y="0" width="464" height="152" rx="6"/><rect class="d-focal" x="176" y="0" width="464" height="152" rx="6"/><text class="d-name" x="192" y="80">nvim .</text><text class="d-sub" x="192" y="100">editor, 60%</text><rect class="d-box" x="176" y="160" width="464" height="96" rx="6"/><text class="d-name" x="192" y="204">shell / claude</text><text class="d-sub" x="192" y="224">40%</text></svg>
<figcaption>The ide layout. Every pane starts inside the #java devshell.</figcaption>
</figure>

> Update, 2026-09-30: I now run agent sessions in herdr instead of this layout. The `ide` function is still defined in `shell.nix` and still builds the tmux layout above, so it works as described. See [Running agents in herdr](/blog/herdr-agent-workspace/).

It automatically re-attaches to existing sessions, starts each pane inside the `#java` devshell, and can be invoked with a single command from any project directory.

## What the flake reproduces

A NixOS config this complete pays off in a few concrete ways. `git clone` plus `nixos-rebuild switch` gets me an identical machine, no manual steps in between. Every generation is a boot option, so a broken upgrade is a reboot away from being undone, not a debugging session. Every installed package and every config change lives in version control, which means the history of the machine is just `git log`. The same modules run on Fedora through `home-manager switch --flake .#usman`, so I can migrate incrementally instead of committing to a full reinstall. And because there's no ambient state, the machine is exactly what the config says nothing accumulated.

In [Part 2](/blog/part-2-agentic-development-stack/), I show how this foundation supports an agentic AI development environment with multiple models, MCP servers, a large skill library, and a three-tier agent pipeline.
