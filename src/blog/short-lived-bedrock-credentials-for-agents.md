---
title: "Giving an agent VM Bedrock access without long-lived keys"
date: 2026-09-30
description: "How an assumed AWS role and a 50 minute launchd job give an agent VM one-hour Bedrock credentials, and the gap where the VM copy goes stale."
part: 21
permalink: /blog/short-lived-bedrock-credentials-for-agents/
---

An agent VM needs model access, and the default way to give it that is a static key in an environment file. If the VM is compromised, that key works until someone notices and rotates it. This post covers what I built so the VM only ever sees credentials that expire in an hour, and one place where the design does not fully deliver that.

One correction first. [Part 4](/blog/part-4-agent-security/) originally planned a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`. I searched the dotfiles repository for that name and found no use of it, so I changed Part 4 to match. What runs is a standard STS credential triple: an access key ID, a secret access key and a session token. The per-job minting in Part 4 is still unbuilt. What exists is a host job that refreshes one shared file.

## The role

`scripts/create-bedrock-role.sh` creates one IAM role in a single AWS account, which I write as `<aws-account>` here. Its trust policy lets the principal that ran the script assume the role. It attaches the AWS managed policy `AmazonBedrockLimitedAccess` and sets the role's maximum session duration to `DURATION`, which defaults to 3600 seconds. I did not write a custom policy, so the role's scope is whatever that managed policy grants. I have not reviewed its contents for this post.

I only read the script. I didn't run it against an account while writing this. [Part 7](/blog/part-7-security-audit/) and [Part 9](/blog/part-9-production-pass/) cover why it exists and how it landed, so I won't repeat that here.

## The minter

The minter is a launchd agent called `bedrock-token`, defined in `nix/home/mac-extras/launchd-agents.nix`. It runs at login and then every 3000 seconds, which is 50 minutes. Each run does this:

1. Looks up the role with `aws iam get-role`. If the role is missing, it logs a message telling me to run the role script and exits.
2. Calls `aws sts assume-role` with a 3600 second duration and a session name that includes a timestamp. If that fails, it logs a message telling me to check my AWS session and exits.
3. Extracts the three credential values and the expiry time.
4. Writes them to `~/.bedrock-creds` along with the region and an expiry comment, then sets the file mode to 600.

The job uses my own signed-in AWS session to call STS, so no permanent key for this role exists on disk. The 10 minute overlap between the 50 minute timer and the 60 minute lifetime is there so a fresh file always exists before the old credentials lapse. The job logs to `~/Library/Logs/bedrock-token.log`, and the last lines there show successful refreshes with expiry times.

<figure class="diagram">
<svg viewBox="0 0 880 330" role="img" aria-labelledby="bedrock-flow-title bedrock-flow-desc" xmlns="http://www.w3.org/2000/svg"><title id="bedrock-flow-title">Bedrock credential mint and refresh flow</title><desc id="bedrock-flow-desc">A host launchd job assumes a scoped role through STS every 50 minutes and writes a mode 600 file. A separate login job pipes those values over stdin into systemd drop-ins inside the VM. The copy inside the VM is only rewritten when that second job runs.</desc><rect class="d-zone" x="0" y="0" width="880" height="330" rx="8"/><text class="d-tag" x="16" y="20">Host</text><rect class="d-box" x="24" y="50" width="220" height="80" rx="6"/><rect class="d-focal" x="24" y="50" width="220" height="80" rx="6"/><text class="d-num" x="40" y="74">1</text><text class="d-name" x="40" y="98">bedrock-token job</text><text class="d-sub" x="40" y="118">login, then every 50 min</text><path class="d-arrow" d="M244 90 H304"/><rect class="d-box" x="304" y="50" width="220" height="80" rx="6"/><text class="d-num" x="320" y="74">2</text><text class="d-name" x="320" y="98">STS assume-role</text><text class="d-sub" x="320" y="118">scoped role, 3600 s</text><path class="d-arrow" d="M524 90 H584"/><rect class="d-box" x="584" y="50" width="272" height="80" rx="6"/><text class="d-num" x="600" y="74">3</text><text class="d-name" x="600" y="98">Credentials file</text><text class="d-sub" x="600" y="118">host home, mode 600</text><path class="d-arrow" d="M720 130 V190"/><text class="d-tag" x="732" y="166">read at login only</text><rect class="d-box" x="584" y="190" width="272" height="80" rx="6"/><text class="d-num" x="600" y="214">4</text><text class="d-name" x="600" y="238">VM start job</text><text class="d-sub" x="600" y="258">pipes creds in, restarts services</text><path class="d-arrow" d="M584 230 H524"/><rect class="d-zone" x="24" y="190" width="500" height="120" rx="8" style="stroke:var(--accent)"/><text class="d-tag" x="40" y="212">Lima VM (untrusted)</text><text class="d-name" x="40" y="250">Service environment</text><text class="d-sub" x="40" y="270">systemd drop-ins hold the triple</text><text class="d-sub" x="40" y="290">stale after about one hour unless step 4 reruns</text></svg>
<figcaption>The host copy refreshes every 50 minutes. The VM copy refreshes only when the VM start job runs.</figcaption>
</figure>

## The handoff into the VM

A second launchd agent, `opencode-vm-autostart`, starts the Lima VM at login. It reads `~/.bedrock-creds`, drops the comment line, and pipes the values over the stdin of a `limactl shell` command. Inside the VM, a script writes systemd drop-in files, with `umask 077`, that set those variables as `Environment=` lines, and restarts two services: the OpenCode server and a local proxy that forwards to Bedrock. The same pipe carries a DeepSeek key, an OpenRouter key and dev database credentials, which come from sops-nix files on the host. I describe only the Bedrock part here.

Until recently the agent wrote an env file inside the dotfiles directory, which was mounted writable into the VM. I've since changed that: nothing is written to a host file now, and the dotfiles mount is read-only. I haven't verified this on the running VM yet.

So the processes that get the triple are those two services in the VM, plus anything that can read the drop-ins. On the host, any process running as my user can read `~/.bedrock-creds`. A security audit I ran on my own machine in July rated this file critical. The credentials are short-lived, but they sit in plaintext, so a compromised dependency such as a fish plugin, a Nix package or an npm postinstall script could read them with one command. The audit proposed three fixes: store them in the macOS Keychain, serve them on demand through an AWS `credential_process` helper, or delete the file as soon as it has been consumed. I have not applied any of them. The file mode does not protect against other processes under the same account.

## The gap

Reading the two agents together, I found a problem with my own claim. The minter refreshes the host file every 50 minutes. The VM start job has `RunAtLoad = true`, `KeepAlive = false`, and no `StartInterval`, and I found no other place in the repository that reads `~/.bedrock-creds`. As far as I can tell from the code, the VM receives credentials once per login. About an hour later those credentials expire inside the VM, until something reruns that job.

I did not test what OpenCode does at that point, so I cannot say whether it fails visibly or falls back to something else. The design shortens the lifetime of a leak, which is the goal. It also may leave the VM without model access until I rerun the job by hand. A fix would be a timer on the VM start job or a small watcher on the file, and I have not made either.

## Long-lived key against this setup

| | Static key in an env file | This setup |
|---|---|---|
| What is stored | A permanent access key | Three values that expire after 3600 seconds |
| What leaks if the VM is read | A key that works until rotated | Credentials that lapse within the hour |
| Scope | Whatever the key's user can do | The role's managed policy, `AmazonBedrockLimitedAccess` |
| Rotation | Manual | Each refresh replaces the file; no manual step |
| Where it is stored on the host | Wherever I put it | `~/.bedrock-creds`, mode 600, readable by my user |
| Still spendable while valid | Yes | Yes, for up to the credential lifetime |

The last row matters. Short credentials limit how long a leak is useful. They do not limit what an agent can invoke on Bedrock during that time, so spend is still possible for the whole hour.

## What I could not verify

- The exact permissions in `AmazonBedrockLimitedAccess`. I cite the policy name only.
- That the role script works against a live account today, since I did not run it.
- What the VM services do once the injected credentials expire.
- Whether anything besides the VM start job rewrites the VM environment during the day.
- That the stdin pipe is live. It is committed, and I have not applied it or restarted the VM.
- Per-job minting as described in Part 4. I found no code for it.
