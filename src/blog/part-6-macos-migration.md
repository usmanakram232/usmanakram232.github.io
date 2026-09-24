---
title: "From NixOS to macOS: Porting a Declarative Workstation Across Platforms"
date: 2026-06-27
description: "When a lifetime Linux user buys a MacBook, the dotfiles follow. How the NixOS/Hyprland config from Part 1 survived the platform switch with 90% of home modules intact — and what had to change."
part: 6
permalink: /blog/part-6-macos-migration/
---

In Parts 1-5, I described a fully NixOS workstation: Hyprland compositor, systemd for every service, Wayland-native tools, a security posture built on Linux kernel primitives. Then I bought a MacBook.

This post covers what the migration actually looked like: how the single `flake.nix` grew a `darwinConfigurations` output, the patterns that kept 90% of the home-manager config cross-platform, the services that needed platform-specific replacements, and the bugs that ate my evenings.

## Architecture: one flake, two platforms

The original `flake.nix` produced a single output: `nixosConfigurations.default` for the NixOS machine. Adding macOS support meant adding:

```nix
# nix/flake.nix
nix-darwin = {
  url = "github:LnL7/nix-darwin/master";
  inputs.nixpkgs.follows = "nixpkgs";
};

darwinConfigurations.macbook = nix-darwin.lib.darwinSystem {
  system = "aarch64-darwin";
  modules = [
    ./hosts/mac/default.nix
    home-manager.darwinModules.home-manager
    { home-manager.users.usman = import ./home/mac-default.nix; }
  ];
};
```

nix-darwin is the macOS equivalent of NixOS's system-level config: it manages fonts, system defaults, Homebrew casks, launchd daemons. home-manager handles the user layer on both platforms, and the `home/` directory is 90% shared code. That separation is what makes the whole cross-platform approach viable.

## The cross-platform pattern: `lib.optionals`

Every Linux-only package in `programs.nix` wraps itself in a guard:

```nix
home.packages = (with pkgs; [
  # Cross-platform: shell tools, monitoring, media, docs — ~50 packages here
  eza bat fd ripgrep sd jq yq-go tealdeer bottom hyperfine tokei yt-dlp mpv ...
]) ++ lib.optionals pkgs.stdenv.isLinux (with pkgs; [
  # Linux-only: Wayland desktop components
  wl-clipboard grim slurp waybar dunst swaylock hyprpaper ...
  iotop traceroute
  pkgs.jetbrains.idea
]);
```

(fish, neovim, git, starship, and tmux aren't in this list — they're configured via their own `programs.*` modules in `shell.nix`, `neovim.nix`, `git.nix`, and `terminal.nix`, which apply the same cross-platform pattern at the module level instead of the package level.)

The nixpkgs curation turns out to be more Linux-centric than you'd expect. Plenty of popular tools have no macOS build in nixpkgs even though the upstream project fully supports macOS:

| Package | Nixpkgs platforms | macOS fix |
|---|---|---|
| `ghostty` | `linux` only | Homebrew cask |
| `chromium` | `linux` only | Homebrew cask |
| `jetbrains.idea` | `linux` only | Homebrew cask |
| `corretto21` | `linux` only | `temurin-bin-21` (cross-platform) |
| `traceroute` | `linux` only | Built-in macOS `/usr/sbin/traceroute` |

Every one of these caused a build failure on the first `darwin-rebuild switch`. The rule that saves you: check `meta.platforms` before adding anything to the shared list, and reach for a cross-platform alternative when one exists.

## Service translation: systemd → launchd

The Linux config has `systemd.user.services` for SSM tunnels, portless proxy, and backup timers. macOS wants `launchd.agents` instead:

```nix
# Linux (work.nix)
systemd.user.services = {
  project-db-dev = {
    Unit.Description = "...";
    Service.ExecStart = "aws ssm start-session ...";
    Service.Restart = "always";
  };
};

# macOS (mac-extras.nix)  
launchd.agents = {
  project-db-dev = {
    enable = true;
    config = {
      Label = "com.internal.project.ssm.db.dev";
      ProgramArguments = [ "aws" "ssm" "start-session" ... ];
      KeepAlive = true;
      RunAtLoad = true;
    };
  };
};
```

The mapping is one-to-one:

| Linux systemd | macOS launchd |
|---|---|
| `WantedBy = default.target` | `RunAtLoad = true + KeepAlive = true` |
| `Type = oneshot` | `StartInterval = N` or no KeepAlive |
| `journalctl -u name -f` | `tail -f ~/Library/Logs/name.log` |
| `systemctl --user status` | `launchctl list \| grep name` |

## Fish shell cross-platform

Nix's module system has a priority mechanism: `lib.mkDefault` sets a value at below-normal priority, and `lib.mkForce` overrides it at above-normal priority. That's what lets `shell.nix` declare sensible Linux defaults while `mac-extras.nix` silently wins over them:

```nix
# shell.nix (shared)
programs.fish.shellAbbrs = {
  open = lib.mkDefault "xdg-open";   # Linux fallback
  sc   = lib.mkDefault "grim -g \"$(slurp)\" ~/Pictures/S...";  # Linux
};

# mac-extras.nix (macOS override)
programs.fish.shellAbbrs = {
  open = lib.mkForce "open";
  sc   = lib.mkForce "open -a Shottr";
};
```

The result: `shell.nix` stays pure convention. Everything macOS-specific lives in `mac-extras.nix`, which you can read as a complete diff of how the platforms diverge.

## The bugs I hit

Here's what bit me:

1. **`command = fish` is mandatory.** Ghostty's `.app` bundle on macOS ignores your login shell and defaults to `/bin/bash`. Skip `command = fish` in the Ghostty config and fish abbreviations, the starship prompt, and zoxide all go silently missing. For days I had a fish-looking prompt that was actually bash. It's in `terminal.nix` now, with a comment explaining why.

2. **Aerospace's key name for the Return key is `enter`, not `return`.** `alt-enter` is the binding AeroSpace's own docs use for "open a new terminal window." Type `alt-return` instead — which I did, while debugging something unrelated — and it fails silently: no error, no fallback, the terminal-launch binding just does nothing.

3. **`system.primaryUser` requirement.** A mid-2025 breaking change in nix-darwin requires explicitly declaring `system.primaryUser = "usman"` for user-scoped options. Skip it and `darwin-rebuild` fails with a cryptic error about the very user you've been using the whole time.

4. **`if` is a reserved keyword.** In Nix, `if` can't be an unquoted attribute. The Aerospace window rules (`on-window-detected = [{ if.app-id = "com.apple.finder"; ... }]`) need quoting: `"if".app-id`. Nix won't tell you this clearly — it just fails to parse.

5. **sops temp file paths.** sops finds `.sops.yaml` by walking up from the encrypted file. The `sops-create-keys.sh` script wrote temp files to `/tmp/`, so sops never found `~/dotfiles/.sops.yaml`. Fix: write temp files inside the `secrets/` directory instead.

6. **Ghostty on macOS uses the system shell by default.** Worth repeating — this one cost the most debugging time.

## What transferred cleanly

- **Neovim** (nixvim module): identical on both platforms
- **Git config**: identical (SSH key management differs only via `UseKeychain`)
- **Tmux**: identical
- **Starship prompt**: identical
- **Fish config**: 95% shared (5% overridden in mac-extras.nix)
- **GTK/Qt theming**: doesn't apply on macOS (auto-skips via `lib.mkIf isLinux`)
- **SSM SSH tunnels**: identical logic, different service manager

## What's next

In [Part 7](/blog/part-7-security-audit/), I walk through a full security audit of the resulting setup: the methodology, the 10-point checklist, and the surprising things I found once I actually checked my own config. [Part 8](/blog/part-8-macos-bootstrap/) covers the complete new-machine bootstrap pipeline: from bare MacBook to productive workstation in a single script.
