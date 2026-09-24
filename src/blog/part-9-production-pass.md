---
title: "The production pass: shared config, security scripts, and the next agent architecture"
date: 2026-06-27
description: "After getting macOS working in Parts 6-8, two more sessions to make it right: a single source of truth for work infrastructure, three security utility scripts, and the design for sandboxed multi-agent OpenCode."
part: 9
permalink: /blog/part-9-production-pass/
---

Parts 6-8 got macOS working. This post is about making it correct.

There's a predictable pattern with cross-platform configs: the first platform gets hand-crafted care, the second gets a port, and ports accumulate bugs you don't find until the feature is actually used.

Two sessions after the macOS bootstrap, I found a silent port-number bug in two of the seven on-demand SSM tunnels, a Touch ID failure inside tmux, and `https://name.localhost` silently falling back to HTTP. None of these would surface in a quick smoke test.

## The duplication trap: `nix/lib/work-data.nix`

The original macOS work config in `mac-extras.nix` was a faithful port of `work.nix` — same seven SSM tunnel names, same hosts, same AWS region, just driving `launchd.agents` on macOS instead of `systemd.user.services` on Linux.

The bug was invisible because the broken tunnels were all disabled by default. On the macOS side, `b2b-db-test` and `b2b-db-prod` had both been copy-pasted from `b2b-db-dev` without updating `localPort` — all three ended up on `15021`:

```
b2b-db-dev     → 15021  (correct)
b2b-db-test    → should be 25021, was 15021  (collision with b2b-db-dev)
b2b-db-prod    → should be 35021, was 15021  (collision with b2b-db-dev)
```

Linux had the correct ports; the duplicate data had only drifted on the macOS copy.

The fix is structural, not a patch. The tunnel list now lives in `nix/lib/work-data.nix`:

```nix
# nix/lib/work-data.nix — single source of truth
{
  ssm = {
    instance = "i-instance-id";
    region   = "eu-central-1";
  };

  ssmTunnels = [
    { name = "acme-db-dev";      host = "rds.acme-dev.internal";        localPort = 15001; enable = true;  }
    { name = "acme-db-test";     host = "rds.acme-test.internal";       localPort = 25001; enable = false; }
    { name = "acme-db-prod";     host = "readrds.acme.internal";        localPort = 35001; enable = true;  }
    { name = "billing-db-prod";  host = "readrds.acme.internal";        localPort = 35011; enable = false; }
    { name = "b2b-db-dev";         host = "b2b-rds.acme-dev.internal";    localPort = 15021; enable = false; }
    { name = "b2b-db-test";        host = "b2b-rds.acme-test.internal";   localPort = 25021; enable = false; }
    { name = "b2b-db-prod";        host = "readb2b-rds.acme.internal";    localPort = 35021; enable = false; }
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

# mac-extras.nix (macOS)
let workData = import ../lib/work-data.nix;
    mkLaunchdAgent = t: { name = t.name; value = { enable = t.enable; config = mkPlist t; }; };
    launchdAgents  = builtins.listToAttrs (map mkLaunchdAgent workData.ssmTunnels);
in {
  launchd.agents = launchdAgents // { code-artifact-token = ...; portless-proxy = ...; };
}
```

The `nix/lib/work-scripts.nix` module followed the same pattern for the two shared bash scripts: the CodeArtifact token refresh and the daily git repo sync. Both were previously duplicated between the two platform files. Now they're `pkgs.writeShellScript` derivations that both files reference.

Adding a new tunnel now means editing one file. The ports can't drift.

## Audit round 2: what daily use reveals

The security audit in Part 7 caught configuration bugs. These are the kind you only notice after using the setup for a few days.

**Touch ID inside tmux.** Touch ID for sudo worked at the terminal. It didn't work inside a tmux session. The reason: tmux creates a new process group detached from the user's login session, and macOS's PAM module for Touch ID requires the calling process to be part of the original login session. The module that reattaches the session is `pam_reattach`:

```nix
security.pam.services.sudo_local = {
  touchIdAuth = true;
  reattach    = true;   # pam_reattach — makes Touch ID work in tmux
};
```

Without `reattach = true`, you get a password prompt inside tmux even though Touch ID is enabled. With it, the usual fingerprint dialog appears. One boolean, and you stop wondering why sudo keeps asking for a password inside your IDE layout.

**`https://name.localhost` without root.** The portless proxy runs on port 8443 instead of 443 because macOS reserves 443 for processes running as root — on Linux, `CAP_NET_BIND_SERVICE` lets portless bind 443 without root, but that capability doesn't exist on macOS.

The fix is a `pf` packet filter anchor that redirects port 443 to 8443 on the loopback interface. The anchor is managed by nix-darwin:

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

Now `https://name.localhost` just works. No root, no port numbers.

**tealdeer auto-refresh.** The first `tldr <command>` after a fresh install used to print `no cache found`. The fix is a `home.activation` step that runs `tldr --update` if the cache is absent or older than 7 days:

```nix
home.activation.updateTldrCache = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
  if [ ! -d "$HOME/.cache/tealdeer" ] \
     || [ -z "$(find "$HOME/.cache/tealdeer" -mtime -7 2>/dev/null | head -1)" ]; then
    ${pkgs.tealdeer}/bin/tldr --update 2>&1 || true
  fi
'';
```

**Git HTTPS credentials on macOS.** `git credential.helper = osxkeychain` stores HTTPS credentials in the macOS Keychain. Applied via `lib.optionalAttrs pkgs.stdenv.isDarwin` in `git.nix`, so it only activates on macOS. SSH remains the default for GitHub; this covers the cases where HTTPS is forced (corporate proxies, tools that don't use the SSH agent).

## Security scripts

Three new scripts in `scripts/`.

### `create-bedrock-role.sh`

AI agents shouldn't hold long-lived AWS credentials — they should assume a minimal role, get a one-hour token, and let it expire. This script creates that role:

```bash
bash ~/dotfiles/scripts/create-bedrock-role.sh
# Creates: BedrockInvoke-eu-central-1
# Policy:  AWS-managed AmazonBedrockLimitedAccess (InvokeModel + streaming + Get/List)
# Denied:  everything else (no S3, EC2, Lambda, IAM, billing)

aws sts assume-role --role-arn <role-arn> \
  --role-session-name bedrock-session --duration-seconds 3600
# → short-lived STS credentials, valid 1 hour
```

The role uses `sts:AssumeRole` from the caller's identity. A `bedrock-token` launchd agent (declared in `mac-extras.nix`, not a standalone script) refreshes the credentials every 50 minutes and writes them to a `chmod 600` file the Lima VM reads at start. The pattern is identical to Part 5's Milestone 4 ("Bedrock token minter") from the autonomous agent runner design.

### `validate-ovpn-split-tunnel.sh`

After the VPN audit findings in Part 7 (the config relied on server-side split tunneling rather than enforcing it client-side), I added a validation script:

```bash
bash ~/dotfiles/scripts/validate-ovpn-split-tunnel.sh ~/Documents/secure/work-client-config.ovpn
  ✔  split-tunnel directive present
  ✔  pull-filter ignore redirect-gateway: server-pushed default route rejected
  ✔  No DNS servers pushed (uses system NextDNS resolver)
  ✔  Route: 10.0.0.0 (internal CIDR)
✔ All checks passed — only *.acme-internal.com traffic goes through VPN
```

It checks four things: the `split-tunnel` directive, a `pull-filter` that blocks any server-pushed `redirect-gateway`, DNS push (should use NextDNS, not VPN DNS), and that all explicit routes are internal CIDRs. Any VPN config update runs through this before being committed.

### `verify-age-key.sh`

The age key is the root secret. Everything in `secrets/` decrypts from it. Losing it means permanent loss of SSH key, GPG key, and all restic passwords. This script checks the key exists, has correct permissions (600), and that `age-keygen -y` can extract a valid public key from it:

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

The public key output lets you cross-check it against `.sops.yaml` without exposing the private material. Worth running after any new-machine setup.

## What's being designed: three-tier agent architecture

Session 1 produced a design document for the next stage of the autonomous agent system from Part 5. The core idea is compartmentalisation by responsibility, not by VM boundary.

Three agents with progressively increasing power:

| Agent | Can do | Cannot do |
|---|---|---|
| `@research` | Read-only git, filtered web fetch, Jira read | Edit files, run shell commands |
| `@plan` | Read research output, write plan/spec files | Web access, run builds |
| `@implement` | Write code, run builds, commit to feature branches | Push to main, read Jira, web fetch |

The threat model: prompt injection via web content can only affect `@research`, which has no write access. Even a fully compromised research agent can't write malicious code to the repo. `@implement` has no web access, so it can't be injected via web content at all.

The shared workspace is `~/dotfiles/.agent-work/`, with subdirectories for each handoff stage:

```
.agent-work/
├── research/   (written by @research, read by @plan)
├── plans/      (written by @plan, read by @implement)
└── specs/      (written by @plan, read by @implement)
```

This isn't implemented yet. The design document (`docs/handoff/opencode-multi-agent-setup.md`) covers the full architecture: the web-fetch sanitisation MCP proxy (domain whitelist, injection pattern scanning, content length limits), the git wrapper MCP (branch protection, no force push, no merge to main), and the Jira MCP scoping (read-only for `@research`, invisible to `@implement`).

The Lima VM from Part 8 already runs OpenCode with restricted filesystem mounts. The three-tier design is the next layer: restricting not just the filesystem, but the tool access per agent role.

## What's next

The next post will cover the implementation: a working three-tier OpenCode setup on macOS, the web-fetch proxy MCP, and the first autonomous agent run against a real Jira backlog.
