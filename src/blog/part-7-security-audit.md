---
title: "Auditing a Declarative Desktop: What to Look For and What I Found"
date: 2026-06-27
description: "After two years of incremental config changes, I audited my own setup for security, hygiene, and correctness. Starting from a threat model, working through each layer — and the surprising things I discovered."
part: 7
permalink: /blog/part-7-security-audit/
---

Every dotfile repo accumulates entropy. Packages pile up, configs go stale, and security defaults get quietly overridden for convenience and never revisited. Two years into iterating the NixOS desktop — and now that it's ported to macOS too — I sat down and audited every layer of the setup properly.

What follows is the methodology, the threat model behind it, and the findings, structured so you can run the same audit against your own machine.

## Start with a threat model

Before auditing, define what you're defending against. My threat model for a company-owned developer laptop:

1. **Supply chain attacks** — malicious npm/Python/Maven packages
2. **Prompt injection** — AI agents reading poisoned context
3. **Credential theft** — API keys, SSH keys, cloud credentials
4. **Network surveillance** — DNS hijacking, ISP logging, MITM on public Wi-Fi
5. **Physical theft** — laptop stolen with unlocked secrets
6. **Data exfiltration** — compromised processes sending data outbound
7. **Drift and entropy** — config changes without an audit trail

This maps onto an eight-layer defence-in-depth stack, and I went through each layer on its own.

## The audit checklist

### Layer 1: Boot and physical security

**What to check:**
- [ ] Firmware password set (prevents booting from external media)
- [ ] Secure Boot / SIP enabled (macOS: `csrutil status`)
- [ ] Encryption at rest (FileVault / LUKS)
- [ ] Boot loader lock (systemd-boot password)

**What I found:** Good. FileVault is macOS default. SIP was enabled.

### Layer 2: Secrets management

**What to check:**
- [ ] Any plaintext secrets in the repo (grep for `password`, `secret`, `token`, `key`)
- [ ] Are all secrets encrypted at rest? (sops-nix, age, GPG)
- [ ] Are secrets decrypted at build time or runtime? (build time preferred)
- [ ] Age key location and backup strategy
- [ ] Backup passwords — are they also encrypted?

**What I found:**
- API keys were sops-encrypted ✓
- Restic backup passwords were **plaintext** `chmod 600` files ✗
- GPG key and SSH key weren't in sops (required manual scp per machine) ✗
- Age key was stored in KeepassXC (good) but needed manual copy per machine ✓/✗

**Fix:** I created `secrets/keys.yaml` with the same sops format, covering SSH private key, GPG secret key, and restic passwords. Now on a new machine: copy the age key → `darwin-rebuild switch` → everything decrypts automatically.

### Layer 3: DNS encryption

**What to check:**
- [ ] DNS in use (check the resolver config)
- [ ] Is it encrypted? (DoH/DoT, not plaintext)
- [ ] Does the resolver block known malicious domains?
- [ ] What happens when DNS is down? (fallback details)

**What I found:** Good on Linux (Unbound → NextDNS DoT), now also good on macOS (services.nextdns DoH proxy). NextDNS blocks ads, trackers, and known C2 endpoints at the network level.

### Layer 4: Application firewall

**What to check:**
- [ ] Is a firewall enabled?
- [ ] What inbound connections are allowed?
- [ ] Are all or only signed/known apps auto-allowed?
- [ ] Are there listeners you don't need? (check with `lsof -i`)

**What I found (CRITICAL):**
- `blockAllIncoming = false` — signed apps could accept internet connections
- `allowSignedApp = true` — any signed app was auto-allowed through the firewall
- `LSQuarantine = false` — downloaded apps ran without Gatekeeper verification

This means a malicious signed npm binary could bind a port and accept connections from the internet, and the user wouldn't be prompted or blocked. The combination of all three settings effectively disabled macOS's inbound protection.

**Fix:** `blockAllIncoming = true`, `allowSignedApp = false`, `LSQuarantine = true` (default).

### Layer 5: Networking and VPN

**What to check:**
- [ ] Does VPN route all traffic or only internal CIDRs?
- [ ] Verify split-tunnel is enforced client-side (not just server-side)
- [ ] Any Tailscale exit node being advertised?
- [ ] Services that listen on network interfaces (not just localhost)

**What I found:**
- VPN config had no `split-tunnel` directive — it relied on server-side configuration
- No `pull-filter ignore redirect-gateway` — the server could push a default route
- Tailscale `tsexit` abbreviation existed (potential exit node risk)

**Fix:** Added `split-tunnel` + `pull-filter ignore redirect-gateway` to the `.ovpn` file. Created a validation script (`validate-ovpn-split-tunnel.sh`) to re-verify after every VPN config update.

### Layer 6: Background services

**What to check:**
- [ ] List all launchd agents / systemd user services
- [ ] For each: does it still need to run? is it constantly restarting/failing?
- [ ] Startup programs (System Settings → Login Items)
- [ ] Any unnecessary background services

**What I found:**
- 7 SSM tunnel agents were all enabled — I only use project-dev and project-prod daily
- Tailscale was installed but not needed daily (disabled on this machine)
- NextDNS was running (good, wanted)
- Launchd agent logs were in `/tmp/` (world-readable on macOS)

**Fix:** Disabled 5 of 7 SSM tunnels (enable on demand). Moved logs to `~/Library/Logs/`. Commented out Tailscale cask (install manually when needed).

### Layer 7: Browser security

**What to check:**
- [ ] Extensions: any with excessive permissions?
- [ ] Update policy (auto-update enabled?)
- [ ] Proxy configuration
- [ ] Firefox policies (extension force-install, DNS-over-HTTPS)

**What I found:** Good. Zen Browser has uBlock Origin, ClearURLs, uMatrix, Decentraleyes, and Container extensions force-installed. Proxy PAC file routes only work traffic through VPN.

### Layer 8: Log exposure and info leaks

**What to check:**
- [ ] Lock/login screen — what does it show?
- [ ] Log files — who can read them?
- [ ] SSH key permissions
- [ ] Home directory permissions

**What I found:**
- Hostname was shown on the login screen (minor info leak for physical access) ✗
- Launchd agent logs were in world-readable `/tmp/` ✗
- SSH key permissions were correct (600) ✓

**Fix:** Removed `AdminHostInfo` from login screen defaults. Moved all launchd agent logs (7 SSM tunnels + 3 named services, 10 total) from `/tmp/` to `~/Library/Logs/` (user-only).

## The surprises

Some of these I should have caught sooner:

1. **`LSQuarantine = false`**: I set this two years ago to speed up dev builds and forgot. The git timestamp on the nix config confirmed it.

2. **Touch ID for sudo**: macOS updates can silently reset `/etc/pam.d/sudo_local`. I had been managing it manually, which meant any OS update could drop it without any notification. The fix is a nix-darwin option: `security.pam.services.sudo_local.touchIdAuth = true`. Now `darwin-rebuild switch` owns that file and it survives every update.

3. **Launchd logs in `/tmp/`**: the CodeArtifact token (a read-only Maven token, but still) was leaking into world-readable log files on every refresh.

## Audit automation

I built two tools from this experience:

**`validate-ovpn-split-tunnel.sh`** — checks that the .ovpn file enforces client-side split tunneling:
```bash
bash ~/dotfiles/scripts/validate-ovpn-split-tunnel.sh
```
Checks: split-tunnel directive, pull-filter for redirect-gateway, DNS overrides, routes.

**Bedrock credential role** — `create-bedrock-role.sh` creates an IAM role that mints short-lived, scoped Bedrock API credentials:
```bash
bash ~/dotfiles/scripts/create-bedrock-role.sh
# Role: BedrockInvoke-eu-central-1
# Policy: AWS-managed AmazonBedrockLimitedAccess (InvokeModel + streaming + Get/List)
# Denied: everything else (no S3, EC2, Lambda, IAM)
aws sts assume-role --role-arn <role-arn> \
  --role-session-name bedrock-session --duration-seconds 3600
# → short-lived STS credentials, valid 1 hour
# (a launchd agent refreshes these automatically every 50 min)
```

## Run this audit yourself

Here's the minimal checklist for any declarative workstation:

```
□ 1. Plaintext secrets in repo?         grep -r "password\|secret\|token\|key" --include="*.nix" nix/
□ 2. Age key backed up non-repo?        (password manager or offline)
□ 3. Gatekeeper/quarantine enabled?     defaults read com.apple.LaunchServices LSQuarantine
□ 4. Inbound connections blocked?        (check firewall config)
□ 5. VPN client-side split-tunnel?      grep split-tunnel ~/**/*.ovpn
□ 6. Lock screen info leak?             (hostname visible?)
□ 7. World-readable logs?               ls -la /tmp/*.log
□ 8. Services you don't use?            launchctl list | grep -v com.apple
□ 9. Packages you don't use?            (audit home.packages quarterly)
□10. Unpinned flake inputs?             (flake.lock in git?)
```

In Part 8, I'll cover the complete new-machine bootstrap flow: from a bare MacBook to the full setup in under an hour.
