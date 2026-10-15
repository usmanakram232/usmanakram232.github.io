---
title: "The case of the generic 'sh'"
date: 2026-08-16
description: "Every launchd agent on my Mac showed up as 'sh' in Activity Monitor. A small Rust wrapper built by Nix restored their names and kept the /nix/store wait."
image: "/assets/img/launchd-wait-then-exec-chain.jpg"
part: 12
permalink: /blog/part-12-launchd-sh-mystery/
---

For months, Activity Monitor on my Mac showed processes called `sh`. There was never just one, and the number depended on what had started at boot. Clicking one and opening "Open Files and Ports" gave no path back to `gpg-agent`, the CodeArtifact token refresher, or the Bedrock credential minter. Every background agent I had declared in home-manager reported itself under the same name. If one of them pegged a core or leaked file descriptors, Activity Monitor could not tell me which.

This post traces what `sh` was, why home-manager's own fix does not work for agents that run at login, and the short Nix file (`nix/pkgs/wait-then-exec.nix`, a small Rust program wrapped in a derivation) that closes the gap. The macOS migration in [Part 6](/blog/part-6-macos-migration/) hit an earlier case of a default shell getting in the way.

![Three-hop launchd chain: launchd, named launcher, wait-then-exec, real command](/assets/img/launchd-wait-then-exec-chain.jpg)

## What `launchctl print` actually showed

The first diagnostic step was to print the launchd entry for one agent instead of guessing from the name in Activity Monitor:

```
$ launchctl print gui/501/com.usman.mlx-server
program = /bin/sh
arguments = {
  /bin/sh
  -c
  /bin/wait4path /nix/store && exec /nix/store/…-mlx-server/bin/mlx-server
}
```

`program` was `/bin/sh`. The real binary, `mlx-server`, sat inside a shell command string, where nothing that reads `ProgramArguments[0]` can see it. As far as launchd is concerned, `sh` is what it started, so macOS shows `sh`.

I checked whether I had written this wrapper and forgotten it. I had not. It is home-manager's default: every `launchd.agents.<name>` block it generates gets wrapped this way by default, controlled by an option called `waitForNixStore` (default `true`). The doc comment on that option explains the wrapper's job. `/nix/store` is a separate mount, and right after boot at login nothing guarantees it is mounted yet. `wait4path` is Apple's helper for this case: it blocks until a path exists, then proceeds. Without it, an agent that starts too early can fail because its binary is not there yet.

So the wrapper solves a real timing problem, and the price is the process name.

## Two modes, and neither one is right

Reading `modules/launchd/default.nix` in home-manager's source (the module logic, not the docs) showed exactly two settings and nothing between them:

- `waitForNixStore = true` (default): `ProgramArguments = ["/bin/sh" "-c" "/bin/wait4path /nix/store && exec <cmd>"]`. Waits correctly. Shows as `sh`.
- `waitForNixStore = false`: home-manager writes a named launcher script and `exec`s straight into it. There is no `wait4path`, no shell wrapper, and the process name is correct. Nothing waits for the store to mount.

The home-manager docs say `false` risks the agent failing to start if launchd runs it before the store is mounted. That risk is real for anything with `RunAtLoad = true`, because that setting fires at exactly this moment.

My first pass, a day earlier, took the conservative route. I set `waitForNixStore = false` on the five agents that are safe by construction: `mlx-server`, `git-sync-repos`, `odysseus-vm-autostart`, `opencode-agent-watcher`, and `vpn-keepalive`. All five have `RunAtLoad = false`, so they start well after login and the store is already mounted. That left the agents with `RunAtLoad = true` on the `sh` wrapper, among them `gpg-agent`, `bedrock-token`, `codeartifact-token`, the SSM tunnel agents, `docker-vm-autostart`, `headroom-proxy`, and `notif-poller`. I could live with the wrong process name, but not with an agent that fails to start at login.

I then audited every remaining `sh`-wrapped agent. That made fifteen: thirteen I could fix, and two that I could not. `org.nixos.aerospace` comes from nix-darwin's own `launchd` module (`launchd.user.agents`, a different code path), which hardcodes the same `sh -c "wait4path && exec"` pattern with no toggle. I confirmed that in its source. `org.nix-community.home.sops-nix` does go through home-manager's mechanism, so the toggle exists, but overriding an external module's internal agent definition to inject a wrapper was not worth it for one process. Both stay wrapped, on purpose.

The thirteen were stuck between a correct name without the store wait and the store wait under the name `sh`.

## Building the missing mode

Since home-manager offers two settings, I added a third outside its control. The requirement was to wait for `/nix/store`, then exec into the real command, with `ProgramArguments[0]` being something other than `/bin/sh`.

A shell script fails this requirement, because `program` would still read as the shell that interprets it. It had to be a compiled binary, so I wrote one in Rust and built it with `pkgs.writers.writeRustBin`. It compiles as part of the flake and needs no separate toolchain step:

```rust
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: wait-then-exec <real-command> [args...]");
        std::process::exit(1);
    }

    // Block until /nix/store is mounted. This is the same helper
    // binary that home-manager's own wait4path wrapper calls.
    let _ = Command::new("/bin/wait4path").arg("/nix/store").status();

    // Replace our own process image with the real target.
    // On success this never returns.
    let err = Command::new(&args[1]).args(&args[2..]).exec();
    eprintln!("wait-then-exec: exec failed: {err}");
    std::process::exit(127);
}
```

The `exec()` call does the important work. `std::os::unix::process::CommandExt::exec` replaces the current process image instead of forking a child. No wrapper process lingers after the handoff, exactly as with the shell wrapper's `exec`, minus the shell.

To wire it in, I set `waitForNixStore = false` so home-manager stops inserting its wrapper, and prepended the binary to `ProgramArguments`. Here is `gpg-agent`, before and after:

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

One line added to `ProgramArguments`, one boolean flipped. The resulting chain has three hops and none is `sh`: launchd starts the `gpg-agent` launcher that home-manager writes when `waitForNixStore = false`, the launcher execs `wait-then-exec`, and that execs the real `gpg-agent`. I applied the same change to the other twelve entries in that batch. They are the `mkSsmAgent` generator (which produces every SSM tunnel agent), `gpg-key-import`, `code-artifact-token`, `portless-proxy`, `portless-aliases`, `codeartifact-token`, `bedrock-token`, `opencode-vm-autostart`, `headroom-proxy`, `notif-poller`, `meeting-notifier`, and `docker-vm-autostart` in both the Lima and Colima variants. The generator counts once however many tunnels it produces, and `docker-vm-autostart` counts once for its two variants, which is how the total reaches thirteen. The five `RunAtLoad = false` agents from the first pass did not need the wrapper.

## What it took

Two days went from root cause to shipped fix. Day one found the `waitForNixStore` option and did the five-agent split. Day two audited the remaining fifteen `sh`-wrapped units, set two aside as unfixable, and applied the wrapper to the other thirteen. "It builds" was not enough for verification. The full home-manager generation had to succeed for both `darwinConfigurations`, and I read the generated launcher scripts for `bedrock-token` and one SSM tunnel on disk to confirm each execs `wait-then-exec` before the real command.

The count: five fixed on day one, thirteen on day two, and two left alone on purpose. That is 20 agents in total, and only the two exceptions still show as `sh`.

The list has grown since. The agents added after this change include `hister` (a local browsing-history search server, `RunAtLoad = true`, so it goes through `wait-then-exec`), `pr-review-check` and `agent-session-backup` (both scheduled with `RunAtLoad = false`, so they use plain `waitForNixStore = false`). The rule I now follow for a new agent: if `RunAtLoad` is true, prepend `wait-then-exec`; otherwise set `waitForNixStore = false` and leave it. [Part 16](/blog/part-16-pr-review-automation-take-two/) covers `pr-review-check`.
