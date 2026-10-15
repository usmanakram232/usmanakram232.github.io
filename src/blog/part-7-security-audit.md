---
title: "Auditing a declarative desktop: what to look for and what I found"
date: 2026-06-27
description: "A layer-by-layer security audit of my nix-darwin setup: what to check, the firewall and secrets gaps I found, and a ten-line checklist to reuse."
part: 7
permalink: /blog/part-7-security-audit/
---

Every dotfile repo accumulates entropy. Packages pile up, configs go stale, and security defaults get overridden for convenience and never revisited. I have iterated on this setup since January, first on NixOS and now on macOS, and I finally audited every layer.

Below are the method, the findings, and a checklist you can run against your own machine.

## Start with a threat model

I use the threat model from [Part 3](/blog/part-3-security-posture/): supply chain attacks, prompt injection, credential theft, network surveillance, physical theft, data exfiltration, and config drift with no audit trail. For this audit I walked through the same eight layers of that design and checked each against the real config.

## The audit checklist

### Layer 1: boot and physical security

What to check:
- Firmware password set, which prevents booting from external media
- Secure Boot or SIP enabled (macOS: `csrutil status`)
- Encryption at rest (FileVault or LUKS)
- Boot loader lock (systemd-boot password)

What I found: no problems. FileVault is the macOS default and SIP was enabled.

### Layer 2: secrets management

What to check:
- Plaintext secrets in the repo (grep for `password`, `secret`, `token`, `key`)
- Whether all secrets are encrypted at rest (sops-nix, age, GPG)
- Whether secrets decrypt at build time or runtime (build time is better)
- Age key location and backup strategy
- Whether backup passwords are encrypted too

What I found:
- API keys were sops-encrypted. Passed.
- Restic backup passwords were plaintext files with mode 600. Failed.
- The GPG key and SSH key were not in sops, so every new machine needed a manual `scp`. Failed.
- The age key lived in KeepassXC, which is good, but I copied it by hand to each machine. Partly passed.

Fix: I created `secrets/keys.yaml` in the same sops format, covering the SSH private key, the GPG secret key, and the restic passwords. On a new machine I now copy the age key and run `darwin-rebuild switch`, and everything decrypts. [Part 3](/blog/part-3-security-posture/) describes these keys as already encrypted, but they were not until this audit. This post has the correct history.

### Layer 3: DNS encryption

What to check:
- Which resolver is in use
- Whether DNS is encrypted (DoH or DoT, not plaintext)
- Whether the resolver blocks known malicious domains
- What happens when DNS is down

What I found: no problems. Linux uses Unbound with NextDNS over DoT, and macOS uses the `services.nextdns` DoH proxy. NextDNS blocks ads, trackers, and known command-and-control endpoints.

### Layer 4: application firewall

What to check:
- Whether a firewall is enabled
- Which inbound connections are allowed
- Whether all signed apps or only known ones are auto-allowed
- Which listeners you do not need (`lsof -i`)

What I found (critical):
- `blockAllIncoming = false`, so signed apps could accept internet connections.
- `allowSignedApp = true`, so any signed app was auto-allowed through the firewall.
- `LSQuarantine = false`, so downloaded apps ran without Gatekeeper verification.

With these three settings, a malicious signed npm binary could bind a port and accept connections from the internet without a prompt. Together they turned off macOS inbound protection.

Fix: `blockAllIncoming = true`, `allowSignedApp = false`, and `LSQuarantine = true` (the default).

### Layer 5: networking and VPN

What to check:
- Whether the VPN routes all traffic or only internal CIDRs
- Whether split tunneling is enforced on the client and not only the server
- Whether Tailscale advertises an exit node
- Which services listen on network interfaces instead of localhost

What I found:
- The VPN config had no `split-tunnel` directive and relied on the server.
- There was no `pull-filter ignore redirect-gateway`, so the server could push a default route.
- A Tailscale `tsexit` abbreviation existed, which is a possible exit node risk.

Fix: I added `split-tunnel` and `pull-filter ignore redirect-gateway` to the VPN config, and wrote a script that re-checks both after every VPN config update. [Part 9](/blog/part-9-production-pass/) covers that script.

### Layer 6: background services

What to check:
- Every launchd agent or systemd user service
- Whether each still needs to run and whether it keeps restarting or failing
- Login items in System Settings

What I found:
- Every SSM tunnel agent was enabled, and I use only one dev and one prod tunnel daily.
- Tailscale was installed but not needed daily.
- NextDNS was running, as intended.
- Launchd agent logs were in `/tmp/`, which is world-readable on macOS.

Fix: I disabled the tunnels I do not use daily (I enable them on demand), moved logs to `~/Library/Logs/`, and commented out the Tailscale cask until I need it.

### Layer 7: browser security

What to check:
- Extensions with excessive permissions
- Whether auto-update is on
- Proxy configuration
- Firefox policies (forced extensions, DNS-over-HTTPS)

What I found: no problems. Zen Browser force-installs uBlock Origin, ClearURLs, uMatrix, Decentraleyes, and Container extensions. A proxy PAC file sends only work traffic through the VPN.

### Layer 8: log exposure and info leaks

What to check:
- What the lock and login screen shows
- Who can read log files
- SSH key permissions
- Home directory permissions

What I found:
- The hostname appeared on the login screen, a minor leak for someone with physical access. Failed.
- Launchd agent logs were in world-readable `/tmp/`. Failed.
- SSH key permissions were correct (600). Passed.

Fix: I removed `AdminHostInfo` from the login screen defaults and moved all launchd agent logs from `/tmp/` to `~/Library/Logs/`.

## Findings I should have caught sooner

1. `LSQuarantine = false`. I set this long ago to speed up dev builds and forgot. The git timestamp on the nix config confirmed it.

2. Touch ID for sudo. macOS updates can reset `/etc/pam.d/sudo_local`, and I had been managing that file by hand, so an update could drop Touch ID with no warning. The fix is a nix-darwin option, `security.pam.services.sudo_local.touchIdAuth = true`. Now `darwin-rebuild switch` owns the file and it survives updates.

3. Launchd logs in `/tmp/`. A package registry token, a read-only one, was leaking into world-readable log files on every refresh.

## Audit automation

The audit produced two scripts: `validate-ovpn-split-tunnel.sh`, which checks that the VPN config enforces client-side split tunneling, and `create-bedrock-role.sh`, which creates an IAM role for short-lived Bedrock credentials. I describe both in [Part 9](/blog/part-9-production-pass/), where they got their final form.

## Run this audit yourself

Here is a minimal checklist for any declarative workstation:

```
1. Plaintext secrets in repo?         grep -r "password\|secret\|token\|key" --include="*.nix" nix/
2. Age key backed up non-repo?        (password manager or offline)
3. Gatekeeper/quarantine enabled?     defaults read com.apple.LaunchServices LSQuarantine
4. Inbound connections blocked?       (check firewall config)
5. VPN client-side split-tunnel?      grep split-tunnel <vpn-config>
6. Lock screen info leak?             (hostname visible?)
7. World-readable logs?               ls -la /tmp/*.log
8. Services you don't use?            launchctl list | grep -v com.apple
9. Packages you don't use?            (audit home.packages quarterly)
10. Unpinned flake inputs?            (flake.lock in git?)
```

[Part 8](/blog/part-8-macos-bootstrap/) covers the new-machine bootstrap flow, from a bare MacBook to the full setup in about 40 minutes.
