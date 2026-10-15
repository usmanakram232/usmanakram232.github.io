---
title: "The agent VM I actually run, and the NixOS jail I designed"
date: 2026-09-30
description: "What the Lima agent VM mounts, how secrets reach it over stdin, why its no-sudo claim only holds for a NixOS image I never booted, and what it still does not isolate."
part: 20
permalink: /blog/a-nixos-vm-as-an-agent-jail/
---

Earlier posts in this series promised a sandbox for my coding agents. [Part 4](/blog/part-4-agent-security/) designed one around gVisor and Firecracker, and neither was ever built. What exists is smaller: a Lima virtual machine with a short list of mounted host directories. I also wrote a NixOS image for that VM with a locked-down user, and I need to be direct that the VM I have run does not use it. This post covers what exists, with the evidence I could collect today.

For the threat model, read [Part 3](/blog/part-3-security-posture/) and Part 4. In short, an agent runs commands with my permissions, so the question is what those permissions reach. The VM is meant to shrink that reach to a few directories. Credentials for the model API are covered in [the Bedrock post](/blog/short-lived-bedrock-credentials-for-agents/), and command screening in [the guards post](/blog/command-guards-for-coding-agents/). The VM first appears in [Part 15](/blog/part-15-tailnet-vm-roadmap-catches-up/) as a template for a second, disposable VM.

## Two VM definitions

The first definition is `nix/vms/opencode-lima/default.nix`, a NixOS configuration. Its header says it is a minimal NixOS for running OpenCode in isolation, built with `nix build ~/dotfiles/nix#opencode-lima-image` and copied to `lima/opencode-nixos.qcow2`. It claims a separate user with no sudo, no host SSH keys, GPG or AWS credentials, and a firewall that blocks everything inbound except SSH. The user block is short:

```nix
users.users.opencode = {
  isNormalUser = true;
  shell        = pkgs.fish;
```

It sets no `extraGroups`, so it never joins `wheel`. The flake exposes the image as `opencode-lima-image` and as the `nixosConfigurations.opencode-lima` output.

The second definition is `lima/opencode.yaml`, and it is the one Lima boots. It sets `vmType: vz`, so the VM uses Apple's Virtualization framework, with 4 CPUs, 4GiB of memory and a 20GiB disk. Its image is the official Ubuntu 24.04 server cloud image, pinned to a specific release by digest. No `qcow2` appears anywhere in it. [Part 10](/blog/part-10-post-publication-refinements/) records that I replaced the NixOS image with Ubuntu within hours of writing it, because the image needed a Linux builder and a copy step for every update. Ubuntu boots, the provision script installs the multi-user Nix daemon, and I get the same Nix configuration inside the VM that I use on the host.

I did not run `nix build` on the image for this post. There is no `opencode-nixos.qcow2` in `lima/` today, and the directory listing shows only YAML files. So the NixOS jail is a design that evaluates in the flake, not something I have ever run as my agent VM.

## What I could check on this machine

I tried to prove the no-sudo claim by running `id` and `sudo -n true` inside the VM. `limactl list` shows only two instances here, `docker` (running) and `odysseus` (stopped). There is no `opencode` instance:

```
$ limactl shell opencode -- sudo -n true
level=fatal msg="instance `opencode` does not exist, run `limactl create opencode` to create a new instance"
```

I did not create or start one, because that mutates state. So I cannot show a sudo denial, an `/etc/os-release` or a live mount table, and I make no claim about a running system. The rest of this post quotes configuration.

The configuration does cut against the no-sudo idea for the Ubuntu VM. Its provision script runs `sudo tee -a /etc/shells` and `sudo chsh` as the login user, which only works if that user has sudo. The `opencode` user with no sudo exists in the NixOS design alone. In the Ubuntu VM, the boundary is the hypervisor and the mount list, and I should not describe the agent as unprivileged inside it.

## The mounts are the boundary

`lima/opencode.yaml` uses `mountType: "virtiofs"` and no whole-home mount. A comment in the file lists `~/.ssh`, `~/.gnupg`, `~/.aws` and `~/.restic` as things the VM cannot see, which holds because none of them appears in the list. Here are the six mounts as configured:

| Host path | Writable | Purpose in the file |
|---|---|---|
| `~/dotfiles` | no | the VM only reads fish config and the tools file |
| `~/IdeaProjects` | yes | code to review and edit |
| `~/Dev/notes` | yes | agents update notes |
| `~/Dev/<site repo>` | yes | content updates to this site |
| `~/.config/opencode` | yes | OpenCode config and plugins |
| `~/.agents` | no | agent definitions |

Four are read-write, and `~/dotfiles` and `~/.agents` are read-only now. That wasn't true when I started writing this post. `~/dotfiles` was mounted writable, which meant a compromised agent could edit the exact Nix configuration, scripts and launchd definitions that later run on my host. I caught that while writing, and fixed it so the VM only reads the handful of config files it actually needs from that mount. I haven't verified the new mount on a running VM yet. It needs a restart to take effect.

The plugin directory that holds my command guard still sits inside the writable `~/.config/opencode` mount, so an agent can in principle edit its own guard. I have not tested that write path, and the claim follows from the mount list alone. The NixOS file also disagrees with the YAML on notes, listing them as read-only in one place and read-write in another.

<figure class="diagram">
<svg viewBox="0 0 880 400" role="img" aria-labelledby="jail-title jail-desc" xmlns="http://www.w3.org/2000/svg"><title id="jail-title">Host directories mounted into the agent VM</title><desc id="jail-desc">Six host directories are mounted into a Lima VM. Four are read-write, and the dotfiles and agents directories are read-only. A credentials file on the host reaches the VM by a dashed path, piped over stdin into a systemd drop-in when the VM starts.</desc><rect class="d-zone" x="0" y="0" width="880" height="400" rx="8"/><text class="d-tag" x="16" y="20">Host, macOS</text><rect class="d-zone" x="560" y="30" width="304" height="360" rx="8"/><text class="d-tag" x="576" y="50">Lima VM, Ubuntu 24.04</text><rect class="d-box" x="24" y="60" width="250" height="32" rx="6"/><text class="d-name" x="40" y="81">~/dotfiles</text><path class="d-arrow" d="M274 76 H584"/><text class="d-tag" x="420" y="70">ro</text><rect class="d-box" x="584" y="60" width="256" height="32" rx="6"/><text class="d-name" x="600" y="81">~/dotfiles</text><rect class="d-box" x="24" y="102" width="250" height="32" rx="6"/><text class="d-name" x="40" y="123">~/IdeaProjects</text><path class="d-arrow" d="M274 118 H584"/><text class="d-tag" x="420" y="112">rw</text><rect class="d-box" x="584" y="102" width="256" height="32" rx="6"/><text class="d-name" x="600" y="123">~/IdeaProjects</text><rect class="d-box" x="24" y="144" width="250" height="32" rx="6"/><text class="d-name" x="40" y="165">~/Dev/notes</text><path class="d-arrow" d="M274 160 H584"/><text class="d-tag" x="420" y="154">rw</text><rect class="d-box" x="584" y="144" width="256" height="32" rx="6"/><text class="d-name" x="600" y="165">~/Dev/notes</text><rect class="d-box" x="24" y="186" width="250" height="32" rx="6"/><text class="d-name" x="40" y="207">~/Dev/site repo</text><path class="d-arrow" d="M274 202 H584"/><text class="d-tag" x="420" y="196">rw</text><rect class="d-box" x="584" y="186" width="256" height="32" rx="6"/><text class="d-name" x="600" y="207">~/Dev/site repo</text><rect class="d-box" x="24" y="228" width="250" height="32" rx="6"/><text class="d-name" x="40" y="249">~/.config/opencode</text><path class="d-arrow" d="M274 244 H584"/><text class="d-tag" x="420" y="238">rw</text><rect class="d-box" x="584" y="228" width="256" height="32" rx="6"/><text class="d-name" x="600" y="249">~/.config/opencode</text><rect class="d-box" x="24" y="270" width="250" height="32" rx="6"/><text class="d-name" x="40" y="291">~/.agents</text><path class="d-arrow" d="M274 286 H584"/><text class="d-tag" x="420" y="280">ro</text><rect class="d-box" x="584" y="270" width="256" height="32" rx="6"/><text class="d-name" x="600" y="291">~/.agents</text><rect class="d-box" x="24" y="320" width="250" height="56" rx="6"/><text class="d-name" x="40" y="344">Credentials file</text><text class="d-sub" x="40" y="364">~/.bedrock-creds, mode 600</text><path class="d-arrow" d="M274 348 H584" style="stroke-dasharray:6 4"/><text class="d-tag" x="330" y="338">stdin, then drop-in</text><rect class="d-box" x="584" y="320" width="256" height="56" rx="6"/><rect class="d-focal" x="584" y="320" width="256" height="56" rx="6"/><text class="d-name" x="600" y="344">Service env override</text><text class="d-sub" x="600" y="364">systemd drop-in, at VM start</text></svg>
<figcaption>Four mounts are writable and two are read-only. The dashed line is the credential path, which is not a mount.</figcaption>
</figure>

## What crosses the boundary

Directories cross by mount, and everything I put in them is visible to the agent. Credentials cross by a separate route: a launchd agent starts the VM, collects secrets, and pipes them directly over the stdin of a shell command. It used to write them to an env file inside the writable dotfiles mount first, where any process in the VM could read them. I caught that while writing this post and fixed it. The env file is gone, and no secret sits on host disk or on any mount anymore. I haven't verified this on the running VM yet, since it needs a rebuild and a restart to actually apply.

What still crosses is the Bedrock triple from `~/.bedrock-creds`, a DeepSeek key, an OpenRouter key and the dev database username and password, which sops-nix decrypts on the host. The credentials for my live database no longer cross. The script sends the literal `disabled-in-vm` for both values, so the variable expansion in the tools file still works while authentication against that database fails. The Bedrock keys expire in an hour. I have not checked whether the DeepSeek, OpenRouter and dev database secrets expire at all.

Inside the VM, a script reads stdin and writes two systemd drop-in files under `~/.config/systemd/user/`, with `umask 077`. They are `headroom-proxy.service.d/creds.conf` and `opencode-serve.service.d/api-keys.conf`. Each holds every secret as `Environment=` lines, then the script restarts both services. Those files are readable by the VM user, which is the user the agent runs as. So a compromised agent can still read every secret that crosses, including the dev database credentials. The change removed a route to the host's files and the live-database credentials. It did not hide the rest from the agent.

The Bedrock post describes the staleness problem: the host file refreshes every 50 minutes, but the copy in the VM changes only when this start job runs. Git remotes cross too. Any repository under a writable mount carries its own remote configuration, and I did not inspect what credentials those use.

## What it does not isolate

Network egress is open. The YAML gives the VM Lima's `user-v2` network, which is NAT with internet access for model APIs, and I found no outbound filter in it. An agent can send anything it reads to any host. The firewall rule in the NixOS file only blocks inbound traffic, and it applies to the image I never ran.

Anything in a read-write mount is exposed to modification, including the project code and the notes. No snapshot protects those, and the VM adds no protection to a repository the agent is allowed to write. The one forward-published port, 8443 to the host, is an `opencode serve` endpoint, and I did not audit its authentication.

## Where this leaves the tradeoffs

I can compare VMs and containers only from what I ran. A VM gives a separate kernel and a clear mount list, and Lima on Apple Silicon starts one without a dedicated host. I did not benchmark start time or memory against a container, and I never ran gVisor or Firecracker, so I have no measurement to prefer either over what I have. My choice came down to effort: Lima and a YAML file worked in an afternoon, and the sandbox designs did not get built. What the VM does not do is limit what its mounts hold, and it does not limit the network.

## What I could not verify

- Whether a running `opencode` VM boots Ubuntu. No such instance exists on this machine, so I quoted the YAML.
- Any sudo behavior, `id` output or live mount table, for the same reason.
- That the NixOS image builds today. I did not run `nix build`.
- Whether the read-only dotfiles mount and the stdin pipe are live. Both are committed, and I have not applied them or restarted the VM.
- Whether the plugin directory can be modified from inside the VM.
- The authentication on port 8443.
- The expiry of the non-Bedrock keys and dev database credentials sent at start.
