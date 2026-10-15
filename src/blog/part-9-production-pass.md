---
title: "The production pass: shared config, security scripts, and a three-tier agent design"
date: 2026-06-27
description: "Two sessions after the macOS bootstrap: one shared file for SSM tunnels that fixed a port collision, Touch ID in tmux, and a design for three OpenCode agents."
part: 9
permalink: /blog/part-9-production-pass/
---

[Parts 6 to 8](/blog/part-6-macos-migration/) got macOS working. This post covers the bugs that only showed up once I used it.

Cross-platform configs follow a pattern. The first platform gets careful hand-written config, the second gets a port, and the port collects bugs that appear only when someone uses the feature. Two sessions after the macOS bootstrap, I found a port-number bug in two of the on-demand SSM tunnels, a Touch ID failure inside tmux, and `https://name.localhost` falling back to HTTP. A quick smoke test would have caught none of them.

## The duplication trap: `nix/lib/work-data.nix`

The original macOS work config in `mac-extras` was a direct port of `work.nix`, with the same tunnel definitions, hosts, and AWS region. It drove `launchd.agents` on macOS instead of `systemd.user.services` on Linux.

The bug stayed hidden because the broken tunnels were disabled by default. On the macOS side, `app-db-test` and `app-db-prod` had both been copy-pasted from `app-db-dev` without updating `localPort`, so all three ended up on `15021`:

```
app-db-dev     → 15021  (correct)
app-db-test    → should be 25021, was 15021  (collision with app-db-dev)
app-db-prod    → should be 35021, was 15021  (collision with app-db-dev)
```

Linux had the correct ports. Only the macOS copy had drifted.

The fix is structural. The tunnel list now lives in `nix/lib/work-data.nix`:

```nix
# nix/lib/work-data.nix: single source of truth
{
  ssm = {
    instance = "i-instance-id";
    region   = "region-1";
  };

  ssmTunnels = [
    { name = "app-db-dev";   host = "rds.dev.example.internal";  localPort = 15001; enable = true;  }
    { name = "app-db-prod";  host = "rds.example.internal";      localPort = 35001; enable = false; }
  ];
}
```

Both platforms import it and map over the list:

```nix
# work.nix (Linux)
let workData = import ../lib/work-data.nix;
    mkSsmService = t: { name = t.name; value = { Service.ExecStart = mkSsmCmd t; ... }; };
    ssmServices  = builtins.listToAttrs (map mkSsmService workData.ssmTunnels);
in {
  systemd.user.services = lib.mkIf pkgs.stdenv.isLinux (ssmServices // { ... });
}

# mac-extras (macOS)
let workData = import ../../lib/work-data.nix;
    mkLaunchdAgent = t: { name = t.name; value = { enable = t.enable; config = mkPlist t; }; };
    launchdAgents  = builtins.listToAttrs (map mkLaunchdAgent workData.ssmTunnels);
in {
  launchd.agents = launchdAgents // { code-artifact-token = ...; portless-proxy = ...; };
}
```

The `nix/lib/work-scripts.nix` module does the same for the two shared bash scripts, the CodeArtifact token refresh and the daily git repo sync. Both platform files used to carry their own copy. Now they reference one `pkgs.writeShellScript` derivation each.

Adding a tunnel now means editing one file, so the ports cannot drift apart.

## Audit round 2: what daily use reveals

The security audit in [Part 7](/blog/part-7-security-audit/) caught configuration bugs. These bugs only appeared after a few days of use.

**Touch ID inside tmux.** Touch ID for sudo worked at the terminal but not inside a tmux session. tmux runs processes detached from the user's login session, and macOS's PAM module for Touch ID requires the calling process to belong to that session. The `pam_reattach` module reattaches it:

```nix
security.pam.services.sudo_local = {
  touchIdAuth = true;
  reattach    = true;   # pam_reattach: makes Touch ID work in tmux
};
```

Without `reattach = true`, sudo asks for a password inside tmux even though Touch ID is enabled. With it, the fingerprint dialog appears.

> Update, 2026-09-30: this fix still applies to tmux, but my agent sessions now run in herdr. See [Running agents in herdr](/blog/herdr-agent-workspace/).

**`https://name.localhost` without root.** The portless proxy runs on port 8443 instead of 443 because macOS reserves 443 for root. On Linux, `CAP_NET_BIND_SERVICE` lets portless bind 443 without root, but macOS has no such capability.

The fix is a `pf` packet filter anchor that redirects port 443 to 8443 on the loopback interface. nix-darwin manages the anchor:

```nix
# Anchor file, placed at /etc/pf.anchors/portless
environment.etc."pf.anchors/portless".text = ''
  rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443
'';

# Activation script loads it on every darwin-rebuild switch
system.activationScripts.postActivation.text = ''
  ...
  if [ -f /etc/pf.anchors/portless ]; then
    pfctl -e 2>/dev/null || true
    pfctl -a portless -f /etc/pf.anchors/portless 2>/dev/null || true
  fi
'';
```

Now `https://name.localhost` works without root and without a port number.

**tealdeer auto-refresh.** The first `tldr <command>` after a fresh install printed `no cache found`. A `home.activation` step now runs `tldr --update` if the cache is absent or older than 7 days:

```nix
home.activation.updateTldrCache = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
  if [ ! -d "$HOME/.cache/tealdeer" ] \
     || [ -z "$(find "$HOME/.cache/tealdeer" -mtime -7 2>/dev/null | head -1)" ]; then
    ${pkgs.tealdeer}/bin/tldr --update 2>&1 || true
  fi
'';
```

The cache path in that snippet turned out to be wrong on macOS. [Part 11](/blog/part-11-fork-sync-architecture/) covers how a second user's fork exposed it.

**Git HTTPS credentials on macOS.** `credential.helper = "osxkeychain"` stores HTTPS credentials in the macOS Keychain. `git.nix` applies it only on Darwin. SSH stays the default for GitHub, and this covers forced HTTPS, such as corporate proxies and tools that ignore the SSH agent.

## Security scripts

Three scripts landed in `scripts/` during this pass. Two of them are covered in [Part 7](/blog/part-7-security-audit/), where the audit findings that motivated them live: `create-bedrock-role.sh` creates a minimal AWS role that issues one-hour STS credentials for Bedrock, and `validate-ovpn-split-tunnel.sh` checks that a VPN config enforces split tunneling on the client.

One detail belongs here. A `bedrock-token` launchd agent in `nix/home/mac-extras/launchd-agents.nix` refreshes the role's credentials every 50 minutes and writes them to a `chmod 600` file that the Lima VM reads at start. That is the "Bedrock token minter" from the [Part 5](/blog/part-5-future-roadmap/) roadmap.

The third script is new in this post.

### `verify-age-key.sh`

The age key is the root secret, and everything in `secrets/` decrypts from it. Losing it permanently loses the SSH key, the GPG key, and the restic passwords. This script checks that the key exists, has permissions 600, and that `age-keygen -y` can extract a valid public key from it:

```bash
bash ~/dotfiles/scripts/verify-age-key.sh
  ✔  Age key exists at ~/.config/sops/age/keys.txt
  ✔  Permissions correct (600)
  ✔  Key is valid
     Public key: age1...

     Verify this matches .sops.yaml:
       .sops.yaml: age1...

Backup checklist:
  [ ] The key is saved in KeepassXC as a secure note
  [ ] You have at least one other copy on a different physical device
  [ ] The backup is reachable without this machine
```

The script prints the public key so you can compare it with `.sops.yaml` without exposing private material. I run it after every new-machine setup.

## The three-tier agent design

The first session produced a design document for the next stage of the agent system from [Part 5](/blog/part-5-future-roadmap/). The idea is to split agents by responsibility instead of by VM boundary.

Three agents get progressively more power:

| Agent | Can do | Cannot do |
|---|---|---|
| `@research` | Read-only git, filtered web fetch, ticket read | Edit files, run shell commands |
| `@plan` | Read research output, write plan and spec files | Web access, run builds |
| `@implement` | Write code, run builds, commit to feature branches | Push to main, read tickets, web fetch |

In the threat model, prompt injection through web content can only reach `@research`, which cannot write. A fully compromised research agent cannot put malicious code in the repo. `@implement` has no web access, so web content cannot inject it at all.

The agents share `~/dotfiles/.agent-work/`, with one subdirectory per handoff stage:

```
.agent-work/
├── research/   (written by @research, read by @plan)
├── plans/      (written by @plan, read by @implement)
└── specs/      (written by @plan, read by @implement)
```

None of this is implemented. The design document (`docs/handoff/opencode-multi-agent-setup.md`) describes a web-fetch sanitisation MCP proxy (domain whitelist, injection pattern scanning, content length limits), a git wrapper MCP (branch protection, no force push, no merge to main), and a ticket tracker MCP scoping (read-only for `@research`, invisible to `@implement`).

The Lima VM from [Part 8](/blog/part-8-macos-bootstrap/) already runs OpenCode with restricted filesystem mounts. The three-tier design would add per-role tool access on top of that.

## Where this leaves the roadmap

I planned to write the implementation next. [Part 10](/blog/part-10-post-publication-refinements/) explains why I did not, and lists what breaks when you move to a new machine.
