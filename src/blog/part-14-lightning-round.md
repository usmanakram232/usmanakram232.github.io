---
title: "The Lightning Round: Five Small Fixes From the Same Six Weeks"
date: 2026-08-16
description: "A full-screen meeting overlay that survives multi-monitor coordinate math, herdr joining tmux in the terminal, an AeroSpace schema bump with a silent behavior change, the docker runtime split, and cutting the local MLX model set from 17 to 5."
part: 14
permalink: /blog/part-14-lightning-round/
---

Not everything from early July through mid-August turned into its own post. Some of it was one commit and done; some of it took three commits to actually work — this is the grab-bag: five small, unrelated changes from the same six weeks, none of them big enough to justify a post on their own, all of them worth writing down before I forget why I made the call I did.

## Full-screen meeting alerts that can't be ignored

macOS notification banners for calendar events are easy to miss: they appear in the corner, auto-dismiss, and get buried under whatever's on top. The fix was a `meeting-notifier` launchd agent that polls Calendar every 2 minutes via AppleScript, looking for events starting between 1 minute ago and 11 minutes from now:

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

The first version used a blocking `osascript display dialog`, better than a banner but still confined to whatever screen had focus. If you were looking at the external monitor and the dialog popped up on the laptop screen, you'd miss it just as easily.

The real fix was a compiled Swift/AppKit overlay (`meeting-overlay.swift`) that opens one borderless, blurred, `.screenSaver`-level window per connected display simultaneously — clicking any button on any screen resolves the alert for all of them. Swift/AppKit can't be built inside the nix sandbox (no Xcode SDK framework access there), so it's compiled imperatively via a `home.activation` step — the same pattern used for the OpenCode binary install.

Getting the overlay correct across displays took two more fixes. First: the staleness check for recompilation used `-nt` (mtime comparison) against the Swift source, but nix store files are all stamped with the same fixed epoch mtime, so after the first successful compile, every subsequent source edit silently never got recompiled. I only found this because a bug I thought I'd fixed was still showing up; checking `/nix/store` mtimes directly confirmed they were all January 1, 1970. Fixed by tracking the last-compiled store path in a marker file instead — the content-addressed path itself changes whenever the source changes, which is the actual signal that matters.

Second: a stray dark rectangle appeared on external displays but not the laptop screen. Root cause was a classic absolute-vs-local coordinate mixup: the dimming subview was initialized with `frame = screen.frame`, which carries the screen's absolute desktop position (e.g., `x = -1693` for a monitor to the left of the laptop). Window-local views start at `(0,0)` regardless of where the window itself sits on the desktop. The blur view happened to render correctly because assigning it as the window's `contentView` forces AppKit to auto-correct its frame; the dim view, being a subview of blur rather than the contentView directly, never got that correction. Invisible on the laptop purely because its origin happens to be `(0,0)`, visible on both externals. Fix was initializing both views with `NSRect(origin: .zero, size: frame.size)` instead of the raw screen frame. Verified clean across all three displays: laptop, plus two Dell U2518Ds at native and HiDPI scale.

## Herdr joins the terminal, doesn't replace it

I added `herdr`, an AI agent workspace manager, via a Homebrew tap, with a config at `~/.config/herdr/config.toml` deployed through `home.file`. The whole point of the config is explicit non-overlap with tmux — tmux keeps `ctrl+a` for general multiplexing, servers, and SSH sessions; herdr gets `ctrl+space` for agent workspaces and AI coding sessions. The concept mapping is deliberate muscle-memory transfer: workspace maps to session, tab maps to window, pane maps to pane, detach is still detach:

```toml
[keys]
prefix = "ctrl+space"

split_horizontal = "prefix+minus"   # top/bottom split
split_vertical   = "prefix+v"       # left/right split

detach           = "prefix+d"       # detach, agents keep running
goto             = "prefix+g"       # workspace switcher
focus_agent      = "prefix+alt+1..9"
```

That `split_vertical` binding went through one revision: it started as `prefix+pipe`, mirroring tmux's `prefix+%`/`prefix+"` conventions literally, but herdr doesn't accept pipe as a key name, so it silently didn't bind. Changed to `prefix+v`, which is herdr's own default anyway.

The more useful piece is the OpenCode integration: `herdr integration install opencode` wires a plugin that reports idle/working/blocked/done state to the herdr sidebar and persists the session id, so a detached and reattached herdr workspace resumes each pane with `opencode --session <id>` instead of a blank shell — the plugin install got folded into the existing OpenCode activation step in `ai-tools.nix`. It only runs if the herdr binary is present and the plugin isn't already installed, so it's a no-op on machines that don't have herdr. The sidebar layout was also customized to show state icon, workspace, and tab on one row and the agent name plus stripped terminal title on the next; OpenCode sets its terminal title to the current task, so the sidebar becomes a live status board across every running agent.

## AeroSpace's config-version bump has a silent default change

AeroSpace had been running on the deprecated `config-version = 1` fallback, which prints a warning on every launch and reload. Migrating to `config-version = 2` looked cosmetic until I actually read the migration guide: the only real behavior change between the two versions is how `persistent-workspaces` gets its default value. Under v1, AeroSpace infers persistent workspaces from the right-hand side of your keybindings; every `workspace N` binding implicitly marks that workspace as persistent. Under v2, the fallback is an empty array.

That's not a cosmetic difference. Relying on the new default silently could change how empty or invisible workspaces with `app-id` assignment rules behave — a workspace with no windows open might stop being treated as persistent, and window-placement rules that assume it exists could start failing quietly.

```nix
config-version = 2;
persistent-workspaces = [ "1" "2" "3" "4" "5" "6" "7" "8" "9" ];
```

That list matches the existing `alt-1` through `alt-9` keybindings exactly, which is what v1 was inferring anyway, so behavior is unchanged, but it's now unchanged on purpose instead of by coincidence. Since `nix/hosts/mac/default.nix` is a shared file between my darwinConfiguration and my wife's, this got verified against her keybindings too during the same fork audit — she also uses workspaces 1 through 9, so the same explicit list is correct for both builds.

## Docker runtime, split per person

This was one small piece of a much larger fork-sync commit (covered properly in Part 11), but it's worth calling out on its own: Docker runtime choice moved from a shared default to a per-person `dockerRuntime` specialArg (`lima | colima | none`). My side runs Lima with Testcontainers wiring, now extracted into its own `home/mac-docker-lima.nix`; my wife's fork runs Colima, mirrored into a parallel `home/mac-docker-colima.nix`. `home/mac-default.nix` picks which one to import based on the specialArg, so neither person carries the other's Docker stack. An unused `orbstack` cask also came out in the same pass, confirmed dead by checking that both `DOCKER_HOST` and the active `docker context` pointed at Lima the whole time, meaning OrbStack had never actually been the running daemon.

## Cutting the local model set from 17 to 5

`~/.cache/huggingface/hub` had grown to 230G across 17 or 18 cached MLX models, most of them ad-hoc downloads that were never referenced anywhere in the nix config — the kind of thing that accumulates from trying a model once and never cleaning up. I audited the full set against `mlx_lm.generate`, actually loading each one rather than trusting that a cached directory meant a working model. Three failed to load outright (`gemma4_unified` architecture unsupported by the installed `mlx-lm` version); several more turned out to be stalled or incomplete downloads that had just been sitting there.

Kept 5, verified working:

- `mlx-community/gemma-4-26B-A4B-it-OptiQ-4bit` — new default
- `Jiunsong/supergemma4-26b-uncensored-mlx-4bit-v2`
- `AtomicChat/qwen36-27b-MLX-4bit`
- `RadixArk/Muse-Glimmer-q4-MLX` (needs `--trust-remote-code`; tokenizer warns about `fix_mistral_regex`, flagged for more testing)
- `Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed`

That freed 147G, taking the cache from 230G down to 83G — the `mlx-server` launchd agent and the `mlx-start` fish function both switched their default from the now-removed `Qwen3-32B-4bit` to the new gemma-4-26B model, and `opencode-template.nix`'s `providerSkeletons.mlx.models` got trimmed from 8 stale entries down to exactly the 5 kept models. None of them are bound to an actual agent mode yet: `build`, `plan`, `explore`, `creative`, `research`, and `implement` are all still on Bedrock. The local models stay purely selectable pending manual performance testing on real Java coding tasks. This has no effect on my wife's build; she doesn't use the MLX provider at all.

None of these five are related to each other, which is exactly the point of writing them up together. A blur overlay that fights macOS coordinate systems, a terminal multiplexer that has to coexist with the one already there, a config schema bump with a default nobody warns you about, a runtime split that only matters because two people share one repo, and a disk-cleanup pass that happened to double as a model audit: the common thread is that they all got fixed in the same six weeks of actually using this setup daily, which is still the best way I've found to surface what's broken.
