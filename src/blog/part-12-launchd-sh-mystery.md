---
title: "The Case of the Generic 'sh'"
date: 2026-08-16
description: "Thirteen background agents on my Mac all showed up as a process named 'sh' in Activity Monitor. The root cause was a two-mode home-manager option with no correctly-named option for RunAtLoad agents, and the fix was a 56-line Nix derivation wrapping a compiled Rust binary."
image: "/assets/img/launchd-wait-then-exec-chain.jpg"
part: 12
permalink: /blog/part-12-launchd-sh-mystery/
---

Open Activity Monitor on my Mac and, for months, you'd have seen a process called `sh` sitting there consuming a slot in the login-items list. Not one `sh`. Several, at different times, depending on what had started at boot. Click on any of them and the "Open Files and Ports" pane told you nothing useful: no path back to `gpg-agent`, no hint that this was actually the CodeArtifact token refresher or the Bedrock credential minter. Every background agent I'd declared in home-manager reported itself under the same meaningless name. If one of those thirteen processes ever misbehaved (pegged a core, leaked file descriptors, refused to die) Activity Monitor would be useless for figuring out which one it was.

This post is about tracking that down: what `sh` actually was, why home-manager's own documented fix for it doesn't work for agents that run at login, and the 56-line Nix file (`nix/pkgs/wait-then-exec.nix`) I ended up writing — a small Rust program wrapped in a Nix derivation — to close the gap.

![Three-hop launchd chain: launchd, named launcher, wait-then-exec, real command](/assets/img/launchd-wait-then-exec-chain.jpg)

## What `launchctl print` actually showed

The first real diagnostic step was pulling the plist for one specific agent — rather than guessing from the name in Activity Monitor:

```
$ launchctl print gui/501/com.usman.mlx-server
program = /bin/sh
arguments = {
  /bin/sh
  -c
  /bin/wait4path /nix/store && exec /nix/store/…-mlx-server/bin/mlx-server
}
```

There it was. `program` was `/bin/sh`, full stop. The real binary, `mlx-server`, was buried three tokens deep inside a shell command string, invisible to anything that reads `ProgramArguments[0]` to decide what to display. macOS shows `sh`, because as far as launchd is concerned, `sh` is what got exec'd.

I went looking for where this wrapper came from rather than assuming it was something I'd hand-written and forgotten about. It wasn't. It's home-manager's own behavior: every `launchd.agents.<name>` block it generates gets wrapped this way by default, controlled by an option called `waitForNixStore` (default `true`). The doc comment on that option explains the wrapper's actual job, and it's not decorative. `/nix/store` is a separate mount, and at raw login, right after boot, there's no guarantee it's mounted yet. `wait4path` is Apple's own helper for exactly this: block until a path exists, then proceed. Without it, an agent that starts too early can fail outright, because the binary it's trying to exec literally isn't there yet.

So the wrapper solves a real timing problem. It's just that solving it costs you the process name.

## Two modes, and neither one is right

Reading `modules/launchd/default.nix` in home-manager's own source (not the docs, the actual module logic) confirmed the mechanism has exactly two settings and no third option in between:

- `waitForNixStore = true` (default): `ProgramArguments = ["/bin/sh" "-c" "/bin/wait4path /nix/store && exec <cmd>"]`. Waits correctly. Shows as `sh`.
- `waitForNixStore = false`: home-manager writes a named launcher script and `exec`s straight into it — no `wait4path`, no shell wrapper, correct process name. But nothing waits for the store to mount first.

The home-manager docs are explicit that `false` is a compromise, not a bugfix: disabling the wait "risks the agent silently failing to start if launchd runs it before the store is mounted." That's a real risk, not boilerplate caution — for anything with `RunAtLoad = true`, this is precisely the moment it fires.

My first pass at fixing this, a day earlier, took the conservative route. I flipped `waitForNixStore = false` on the five agents that were safe by construction: `mlx-server`, `git-sync-repos`, `odysseus-vm-autostart`, `opencode-agent-watcher`, `vpn-keepalive` — because all five have `RunAtLoad = false`. They only start on demand, well after login, so the store is guaranteed to be mounted already. Fine. But that left thirteen other agents (`gpg-agent`, `bedrock-token`, `codeartifact-token`, the SSM tunnel agents, `docker-vm-autostart`, `headroom-proxy`, `notif-poller`, and more) all with `RunAtLoad = true`, all still stuck on the `sh` wrapper, because the safety trade-off wasn't acceptable for them. Losing the process name felt like a cosmetic problem I could live with; an agent silently failing to start at login was not.

Before treating that as the end of it, I audited every remaining `sh`-wrapped agent and found two more that weren't home-manager's problem at all: `org.nixos.aerospace` is generated by nix-darwin's own `launchd` module (`launchd.user.agents`, a different code path), which hardcodes the same `sh -c "wait4path && exec"` pattern with zero toggle — reading its source directly confirmed there's nothing to flip. `org.nix-community.home.sops-nix` does route through home-manager's mechanism internally, so the toggle exists, but overriding an external module's internal agent definition to inject a wrapper cleanly wasn't something I wanted to do for one process. Both stayed wrapped, and both remain unfixed today — they're accepted exceptions, not oversights.

That left thirteen agents stuck — correctly-named-but-unsafe on one side, safe-but-named-`sh` on the other, no built-in third option.

## Building the missing mode

If home-manager's mechanism only has two settings, the fix isn't to pick the less-bad one. It's to add a third setting myself, outside home-manager's control entirely. The requirement was simple to state: wait for `/nix/store`, then exec into the real command, with `ProgramArguments[0]` being something other than `/bin/sh`.

A shell script satisfies that requirement on paper but not in practice: `program` would still read `/bin/sh` (or whatever shell interprets it), just with a different label. The actual fix needed a compiled binary, so I wrote one in Rust, built via `pkgs.writers.writeRustBin` so it compiles as part of the flake instead of needing a separate toolchain step:

```rust
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: wait-then-exec <real-command> [args...]");
        std::process::exit(1);
    }

    // Block until /nix/store is mounted — same helper binary
    // home-manager's own wait4path wrapper calls.
    let _ = Command::new("/bin/wait4path").arg("/nix/store").status();

    // Replace our own process image with the real target — on success
    // this never returns.
    let err = Command::new(&args[1]).args(&args[2..]).exec();
    eprintln!("wait-then-exec: exec failed: {err}");
    std::process::exit(127);
}
```

The `exec()` call there is doing the important work. It's `std::os::unix::process::CommandExt::exec`, which replaces the current process image in place rather than forking a child. There's no wrapper process left lingering after the handoff; `wait-then-exec` disappears into whatever it exec'd, exactly like the shell wrapper's `exec` does, just without the shell.

Wiring it in meant setting `waitForNixStore = false` (to stop home-manager inserting its own wrapper) and prepending the binary to `ProgramArguments`. Here's `gpg-agent`, before and after:

```nix
# before
gpg-agent = {
  enable = true;
  waitForNixStore = true;
  config = {
    Label = "org.gnupg.gpg-agent";
    ProgramArguments = [
      "${pkgs.gnupg}/bin/gpg-agent"
      "--homedir" "${home}/.gnupg"
      "--use-standard-socket"
      "--daemon"
    ];
    RunAtLoad = true;
    # ...
  };
};

# after
gpg-agent = {
  enable = true;
  waitForNixStore = false;  # wait-then-exec handles the wait instead
  config = {
    Label = "org.gnupg.gpg-agent";
    ProgramArguments = [
      "${waitThenExec}/bin/wait-then-exec"
      "${pkgs.gnupg}/bin/gpg-agent"
      "--homedir" "${home}/.gnupg"
      "--use-standard-socket"
      "--daemon"
    ];
    RunAtLoad = true;
    # ...
  };
};
```

One line added to `ProgramArguments`, one boolean flipped. The resulting chain is three hops, all named, none of them `sh`: `launchd → gpg-agent` (home-manager's own named launcher, since `waitForNixStore = false` makes it write one) `→ wait-then-exec → gpg-agent` (the real binary). I applied the same pattern to the other twelve: the `mkSsmAgent` generator that produces all the SSM tunnel agents, `gpg-key-import`, `code-artifact-token`, `portless-proxy`, `portless-aliases`, `codeartifact-token`, `bedrock-token`, `opencode-vm-autostart`, `headroom-proxy`, `notif-poller`, `meeting-notifier`, and `docker-vm-autostart` in both the Lima and Colima variants, plus the five that were already `false` for other reasons, giving `wait-then-exec` a use case there too even though it wasn't strictly required.

## What it actually took

Root cause to shipped fix was two days — the first day found the `waitForNixStore` option and did the conservative five-agent split; the second day audited the remaining sixteen `sh`-wrapped units, confirmed two were structurally unfixable, and wrote the wrapper for the other thirteen. Verification wasn't "it builds" — the full home-manager generation had to succeed for both `darwinConfigurations` (`macbook` and `macbook-bushra`), and I checked the generated launcher scripts for individual agents (`bedrock-token`, `work-db-dev`) directly on disk to confirm each one really does exec into `wait-then-exec` before the real command, not straight through.

Thirteen agents fixed, two left alone on purpose, zero regressions in the boot-time safety the original wrapper existed to provide.

When a tool you depend on gives you exactly two configuration modes and neither one is what you actually need, the instinct is to pick the less-bad option and move on. Sometimes that's right; most gaps aren't worth the maintenance cost of closing yourself. This one was worth it: the missing mode was small, well-specified, and cheap to build once I'd actually read the source instead of guessing at it. A dedicated tool that does one narrow thing correctly is a legitimate third option, not a hack. You just have to be sure you're solving the real problem, not decorating around the two you were handed.
