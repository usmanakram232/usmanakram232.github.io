---
title: "Four small fixes from July and August"
date: 2026-08-16
description: "A meeting overlay that fixes multi-monitor coordinate math, herdr next to tmux, an AeroSpace config bump that changes a default, and a local model cull."
part: 14
permalink: /blog/part-14-lightning-round/
---

Four small changes from early July through mid-August did not get their own posts: a full-screen meeting alert, a terminal workspace manager for agents, a window manager config bump, and a cleanup of my local models. Each one hid a detail that cost me time, so here they are with the reasoning I would otherwise forget.

## Full-screen meeting alerts that I can't ignore

macOS notification banners for calendar events are easy to miss. They appear in a corner, auto-dismiss, and get buried under whatever is on top. The fix was a `meeting-notifier` launchd agent that polls Calendar every 2 minutes through AppleScript, looking for events that started up to 1 minute ago or start within 11 minutes:

```nix
meeting-notifier = {
  enable = true;
  config = {
    Label            = "com.${config.home.username}.meeting-notifier";
    ProgramArguments = [ "/bin/bash" "${meetingNotifier}" ];
    StartInterval    = 120;   # every 2 minutes
    RunAtLoad        = true;
  };
};
```

The first version used a blocking `osascript display dialog`. That beat a banner, but it appeared only on the screen with focus. If I was looking at the external monitor and the dialog opened on the laptop, I missed it just as easily.

The real fix was a compiled Swift/AppKit overlay (`meeting-overlay.swift`) that opens one borderless, blurred, `.screenSaver`-level window on every connected display at once. Clicking any button on any screen resolves the alert everywhere. The Nix sandbox cannot build Swift/AppKit because it has no access to the Xcode SDK frameworks, so a `home.activation` step compiles the overlay imperatively. The OpenCode binary install uses the same pattern.

Two more fixes made the overlay correct across displays.

The first was a stale-build bug. The recompile check compared mtimes with `-nt` against the Swift source, but every file in the Nix store carries the same fixed epoch mtime. After the first successful compile, no later source edit ever triggered a recompile. I found it because a bug I thought I had fixed kept showing up, and checking `/nix/store` mtimes showed they were all January 1, 1970. I replaced the check with a marker file that records the last-compiled store path. That path changes whenever the source changes, so it is the signal that matters.

The second was a stray dark rectangle on external displays that never appeared on the laptop screen. It was an absolute-versus-local coordinate mixup. I had initialized the dimming subview with `frame = screen.frame`, which carries the screen's absolute desktop position (for example `x = -1693` for a monitor left of the laptop). Views inside a window start at `(0,0)` no matter where the window sits. The blur view rendered correctly because setting it as the window's `contentView` makes AppKit correct its frame. The dim view is a subview of the blur view, so it never got that correction. It looked fine on the laptop only because that screen's origin is already `(0,0)`. I initialized both views with `NSRect(origin: .zero, size: frame.size)`, and the overlay rendered cleanly on the laptop and on two Dell U2518D monitors at native and HiDPI scale.

## Adding herdr next to tmux

I added `herdr`, an AI agent workspace manager, through a Homebrew tap, with a config at `~/.config/herdr/config.toml` deployed through `home.file`. The config keeps herdr and tmux from overlapping. tmux keeps `ctrl+a` for general multiplexing, servers, and SSH sessions. herdr gets `ctrl+b` for agent workspaces and AI coding sessions. The concepts map onto tmux ones so my muscle memory carries over: workspace to session, tab to window, pane to pane, and detach stays detach.

```toml
[keys]
prefix = "ctrl+b"

split_horizontal = "prefix+minus"   # top/bottom split
split_vertical   = "prefix+v"       # left/right split

detach           = "prefix+d"       # detach, agents keep running
goto             = "prefix+g"       # workspace switcher
focus_agent      = "prefix+alt+1..9"
```

> Update, 2026-09-30: herdr is now where my agent sessions live, not a side tool next to tmux. I first used `ctrl+space` as the prefix, but it collided with the macOS input-source shortcut, so the deployed config in `platform-tools.nix` now sets `ctrl+b`. tmux keeps `ctrl+a`. See [Running agents in herdr](/blog/herdr-agent-workspace/) and the [September 2026 update](/blog/september-2026-update/).

The `split_vertical` binding went through one revision. It started as `prefix+pipe`, mirroring tmux's split keys, but herdr does not accept `pipe` as a key name, so the binding did nothing and gave no error. I changed it to `prefix+v`, which is herdr's own default.

The more useful piece is the OpenCode integration. `herdr integration install opencode` installs a plugin that reports idle, working, blocked, and done state to the herdr sidebar and saves the session id. When I reattach a detached workspace, each pane resumes with `opencode --session <id>` instead of a blank shell. I folded the plugin install into the OpenCode activation step, and it only runs when the herdr binary exists and the plugin is missing. I also set the sidebar to show state icon, workspace, and tab on one row, and the agent name plus the trimmed terminal title on the next. OpenCode sets its terminal title to the current task, so the sidebar works as a live status board for every running agent.

## AeroSpace's config-version bump changes a default

AeroSpace was running on the deprecated `config-version = 1` fallback, which prints a warning on every launch and reload. Moving to `config-version = 2` looked cosmetic until I read the migration guide. The only behavior change is the default for `persistent-workspaces`. Under v1, AeroSpace infers persistent workspaces from the right-hand side of your keybindings, so every `workspace N` binding marks that workspace as persistent. Under v2, the default is an empty array.

That matters. With the new default, an empty workspace that has `app-id` assignment rules could stop counting as persistent, and window-placement rules that assume it exists could start failing without any error.

```nix
config-version = 2;
persistent-workspaces = [ "1" "2" "3" "4" "5" "6" "7" "8" "9" ];
```

The list matches the existing `alt-1` through `alt-9` keybindings, which is what v1 was inferring anyway. Behavior stays the same, but now it stays the same on purpose. The file `nix/hosts/mac/default.nix` is shared with the second person who uses this repo as a fork, so I checked their keybindings during the same audit. They also use workspaces 1 through 9, so the explicit list is correct for both builds.

The same commit split the Docker runtime into a per-person `dockerRuntime` setting (`lima`, `colima`, or `none`) and removed an unused `orbstack` cask. Both `DOCKER_HOST` and the active `docker context` had pointed at Lima the whole time. [Part 11](/blog/part-11-fork-sync-architecture/) covers the fork-sync design, so I won't repeat it here.

## Cutting the local model set from 17 to 5

`~/.cache/huggingface/hub` had grown to 230G across 17 or 18 cached MLX models. Most were downloads from trying a model once and never cleaning up, and none were referenced in the Nix config. I checked every model by loading it with `mlx_lm.generate`, because a cached directory does not prove the model works. Three failed to load (`gemma4_unified` architecture unsupported by the installed `mlx-lm`), and several more were stalled or incomplete downloads.

I kept 5 that load and generate:

- `mlx-community/gemma-4-26B-A4B-it-OptiQ-4bit` (new default)
- `Jiunsong/supergemma4-26b-uncensored-mlx-4bit-v2`
- `AtomicChat/qwen36-27b-MLX-4bit`
- `RadixArk/Muse-Glimmer-q4-MLX` (needs `--trust-remote-code`, and its tokenizer warns about `fix_mistral_regex`, which I still need to test)
- `Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed`

That freed 147G and took the cache from 230G to 83G. The `mlx-server` launchd agent and the `mlx-start` fish function both moved their default from the removed `Qwen3-32B-4bit` to the gemma-4-26B model. In `opencode-template.nix`, `providerSkeletons.mlx.models` went from 8 stale entries to exactly the 5 kept models.

As of this post (mid-August), none of the five was bound to an agent mode. `build`, `plan`, `explore`, `creative`, `research`, and `implement` all still ran on Bedrock, and the local models were only selectable while I waited to test them on real Java coding tasks. That changed in September. [Part 17](/blog/part-17-bonsai-2-local-model/) covers the sixth model I added and the three local roles it now serves. The second fork user does not use the MLX provider at all, so none of this touches their build.
