---
title: "Security posture: defence in depth on a declarative desktop"
date: 2026-01-29
description: "Eight security layers on a NixOS desktop, from sops-nix secrets and DNS-over-TLS to opensnitch and encrypted restic backups, with gaps marked."
part: 3
permalink: /blog/part-3-security-posture/
---

This post lists what I defend against, then walks through eight layers on the NixOS desktop from [Part 1](/blog/part-1-declarative-nixos-stack/). Some layers are in place and some are plans, and I mark which. [Part 7](/blog/part-7-security-audit/) later checks these claims against the real machine.

The threats:

1. Supply chain attacks: malicious packages, dependency confusion
2. Prompt injection: an AI agent reading poisoned code, web pages, or documents
3. Credential theft: API keys, SSH keys, cloud credentials
4. Network surveillance: DNS hijacking, ISP logging, MITM on public Wi-Fi
5. Physical theft: a stolen laptop with secrets unlocked
6. Data exfiltration: a compromised process sending data outbound

The defence is several independent layers, so a failure in one is caught by another.

<figure class="diagram">
<svg viewBox="0 0 880 440" role="img" aria-labelledby="sec-layers-title sec-layers-desc" xmlns="http://www.w3.org/2000/svg"><title id="sec-layers-title">Eight security layers</title><desc id="sec-layers-desc">Eight stacked defence layers from boot to backup, each independent of the others.</desc><rect class="d-box" x="0" y="0" width="880" height="48" rx="6"/><text class="d-num" x="16" y="28">L1</text><text class="d-name" x="64" y="28">Boot</text><text class="d-sub" x="864" y="28" text-anchor="end">systemd-boot, Secure Boot planned</text><rect class="d-box" x="0" y="56" width="880" height="48" rx="6"/><text class="d-num" x="16" y="84">L2</text><text class="d-name" x="64" y="84">Encrypted secrets</text><text class="d-sub" x="864" y="84" text-anchor="end">sops-nix + age</text><rect class="d-box" x="0" y="112" width="880" height="48" rx="6"/><text class="d-num" x="16" y="140">L3</text><text class="d-name" x="64" y="140">Encrypted DNS</text><text class="d-sub" x="864" y="140" text-anchor="end">Unbound + NextDNS over DoT</text><rect class="d-box" x="0" y="168" width="880" height="48" rx="6"/><text class="d-num" x="16" y="196">L4</text><text class="d-name" x="64" y="196">Application firewall</text><text class="d-sub" x="864" y="196" text-anchor="end">opensnitch</text><rect class="d-box" x="0" y="224" width="880" height="48" rx="6"/><text class="d-num" x="16" y="252">L5</text><text class="d-name" x="64" y="252">Zero-trust networking</text><text class="d-sub" x="864" y="252" text-anchor="end">Tailscale</text><rect class="d-box" x="0" y="280" width="880" height="48" rx="6"/><text class="d-num" x="16" y="308">L6</text><text class="d-name" x="64" y="308">Browser security</text><text class="d-sub" x="864" y="308" text-anchor="end">extensions + policies</text><rect class="d-box" x="0" y="336" width="880" height="48" rx="6"/><text class="d-num" x="16" y="364">L7</text><text class="d-name" x="64" y="364">Credential hygiene</text><text class="d-sub" x="864" y="364" text-anchor="end">KeePassXC + GPG</text><rect class="d-box" x="0" y="392" width="880" height="48" rx="6"/><text class="d-num" x="16" y="420">L8</text><text class="d-name" x="64" y="420">Backup</text><text class="d-sub" x="864" y="420" text-anchor="end">encrypted restic + rclone</text></svg>
<figcaption>Eight independent layers. Secure Boot is planned, the rest are in the config.</figcaption>
</figure>

## Layer 1: Boot

The NixOS config uses `systemd-boot`. Kernel and initrd are managed, version-controlled derivations, and boot generations are capped at 10 to avoid partition exhaustion. UEFI Secure Boot signing is missing. There is no `lanzaboote` or `sbctl` yet, so this layer only gives rollback, not tamper protection:

```nix
boot.loader.systemd-boot.enable = true;
boot.loader.systemd-boot.configurationLimit = 10;
boot.loader.efi.canTouchEfiVariables = true;
```

## Layer 2: Encrypted secrets with sops-nix

The weakest link in most dotfile repos is plaintext secrets. API keys, cloud credentials, and backup passwords inevitably end up in a `secrets/` directory, or worse, in a config file that gets committed.

The fix is sops-nix, which encrypts secrets with age (a modern GPG alternative). Secrets are encrypted at rest in the repo and decrypted at build time.

```nix
# nix/home/default.nix
sops = {
  defaultSopsFile = ../../secrets/opencode.yaml;
  age.keyFile = "${config.home.homeDirectory}/.config/sops/age/keys.txt";

  secrets = {
    context7_api_key = { };
    deepseek_api_key = { };
    openrouter_api_key = { };
  };
};
```

### The workflow

```bash
# One-time: generate an age key
age-keygen -o ~/.config/sops/age/keys.txt

# Edit secrets (opens $EDITOR with decrypted content)
sops ~/dotfiles/secrets/opencode.yaml

# The encrypted file is committed to git:
#    age:enc:...  (unreadable without the key)
```

At `home-manager switch`, sops-nix decrypts the secrets and places them at `$SOPS_PATH/<secret-name>`: files that only the user can read. A fish `conf.d` snippet loads them as environment variables:

```fish
# Generated by sops-nix, do not edit
if test -f /run/secrets/context7_api_key
  set -gx CONTEXT7_API_KEY (string trim < /run/secrets/context7_api_key)
end
```

The result: secrets live in the repo encrypted, decrypt on activation, reach a process only when the shell loads them, and rotate by re-encrypting one file.

### Keys and backup passwords (planned)

At the time of writing, only the API keys go through sops-nix. The plan is to move the SSH key and GPG key into `secrets/keys.yaml` as well. That file did not exist yet; [Part 7](/blog/part-7-security-audit/) records that I created it during the audit. The restic backup passwords are also still plaintext, `chmod 600` files at `~/.restic/p.txt` and `~/.restic/gdrive-p.txt`. Moving them into the same flow (`config.sops.secrets."restic-password".path`) is a next step.

## Layer 3: Encrypted DNS with Unbound + NextDNS

Every DNS query is encrypted via DNS-over-TLS to NextDNS. The local resolver runs as a hardened Unbound instance:

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
      ];
    }];
  };
};
```

When AI agents fetch web content or API documentation, their DNS queries are encrypted and filtered by NextDNS. Malicious domains, known C2 endpoints, and tracking domains are blocked at the DNS layer before any agent code touches them.

NextDNS provides per-device analytics, blocklists (OISD, Threat Intelligence Feeds), and native ad/tracker blocking, no browser extension needed at the network level.

## Layer 4: Application firewall with opensnitch

`opensnitch` is an interactive application firewall (the spiritual successor to Little Snitch on macOS). Every new outbound connection triggers a dialog:

```nix
services.opensnitch.enable = true;
```

The rules accumulate in `~/.config/opensnitch/` and persist across reboots. If `curl` suddenly tries to connect to a new IP, you see it, same story for a compromised npm package phoning home, or an agent process reaching out to somewhere it has no business reaching.

On macOS, opensnitch doesn't exist. The equivalent is the macOS Application Firewall, configured via `networking.applicationFirewall` in nix-darwin. It provides block-all-incoming and signed-app filtering: less granular than opensnitch, but operating on the same principle of default-deny inbound. The audit in [Part 7](/blog/part-7-security-audit/) covers what I found when I checked those settings.

## Layer 5: Zero-trust networking with Tailscale

Tailscale is a WireGuard-based mesh VPN with built-in SSO:

```nix
services.tailscale = {
  enable = true;
  openFirewall = true;
  useRoutingFeatures = "both";
};
```

All inter-machine traffic goes through Tailscale, encrypted, authenticated, and authorised by its ACLs. This replaces OpenVPN configs, port forwarding, and SSH bastion hosts. Machines reach each other by Tailscale IP or hostname, and SSH is direct.

## Layer 6: Browser security

The browser is the largest attack surface on any desktop. The Zen Browser config in `browser.nix` enforces:

### Privacy extensions (force-installed via Firefox policies)

```
ublock-origin              # Comprehensive ad/tracker/malware blocking
clearurls                  # Strips tracking parameters from URLs
decentraleyes              # Local CDN replacement
dont-track-me-google       # Removes Google's tracking redirects
facebook-container         # Isolates Facebook in a container tab
cookie-autodelete          # Auto-deletes cookies when tab closes
umatrix                    # Per-site request control
netcraft                   # Anti-phishing
terms-of-service-didnt-read
```

### Security policies

```nix
extraPolicies = {
  DisableAppUpdate = true;
  Proxy = {
    ConnectionType = "pac";
    AutoConfigURL  = "file://${HOME}/.config/work/proxy.pac";
  };
};
```

A PAC file routes internal hostnames through a proxy while everything else goes direct.

## Layer 7: Credential hygiene

### KeePassXC

The password manager runs as a Wayland-native app with a Hyprland window rule:

```nix
hl.window_rule({ match = { class = "keepassxc" }, float = true });
hl.window_rule({ match = { class = "keepassxc" }, size  = "900 600" });
```

KeePassXC auto-type, browser integration via the KeePassXC-Browser extension, and the CLI (`keepassxc-cli`) all provide credential access without passwords in plaintext.

### GPG with paper backup

```nix
home.packages = with pkgs; [
  paperkey     # Print GPG key as paper backup
];
```

The `paperkey` tool exports the secret key material as a paper backup. Together with the GPG key backup in encrypted restic, that gives two independent recovery paths.

### SSH key management

SSH keys are managed via `programs.ssh.matchBlocks` in home-manager:

```nix
programs.ssh.matchBlocks."agent-vm" = {
  hostname = "<vm-ip>";
  user = "agent";
  identityFile = "~/.ssh/id_ed25519";
};
```

No SSH config file to manage. Match blocks for each host (GitHub, an agent VM, a VPN VM, Tailscale nodes) are declared once and apply everywhere. The example uses a placeholder address.

## Layer 8: Encrypted backups

The backup strategy has three tiers.

### 1. Local (Seagate external drive: daily config backup, weekly bulk)

```nix
systemd.user.services.restic-backup-configs = {
  description = "Restic: back up configs + secrets to Seagate";
  # ~/.aws ~/.gnupg ~/.ssh ~/dotfiles ~/gpg-backup
};

systemd.user.services.restic-backup-bulk = {
  description = "Restic: back up media + projects to Seagate";
  # ~/Dev ~/Documents ~/Downloads ~/IdeaProjects ~/Pictures ~/Videos
};
```

### 2. Google Drive, encrypted (sensitive docs)

```nix
systemd.user.services.restic-backup-gdrive-sensitive = {
  # ~/.ssh ~/.gnupg ~/.aws ~/dotfiles ~/gpg-backup
  # ~/Documents/personal ~/Documents/secure
  # → encrypted restic blobs → Google Drive
};
```

### 3. Google Drive, plain (for accessibility)

```nix
systemd.user.services.rclone-sync-gdrive = {
  # ~/Documents/personal ~/Dev/notes
  # → real files, browsable in Google Drive
};
```

The split matters. Sensitive documents (IDs, payslips, keys) are encrypted into restic blobs, unreadable by Google. Non-sensitive content (reading notes, guides) syncs as real files that I can browse in Google Drive.

All backup services run as systemd `--user` timers with `Nice=15` and `IOSchedulingClass=idle`. They don't compete with foreground work.

## How sops-nix integrates with agent secrets

The intersection of security and agentic AI is secrets management. The agent config references API keys as `${VARIABLE}` placeholders, and the fish environment loads them at login:

```
sops-nix decrypts       →  /run/secrets/deepseek_api_key
fish conf.d snippet     →  set -gx DEEPSEEK_API_KEY (... read from path)
opencode.jsonc          →  "${DEEPSEEK_API_KEY}"  →  runtime interpolation
```

The agent process sees only an environment variable. Compromising it does not expose the encrypted file or the age key, because file permissions prevent it. Rotating a key takes one `sops` edit and one `home-manager switch`.

[Part 4](/blog/part-4-agent-security/) goes further with a design for running unattended agents in sandboxes with no secrets.
