---
title: "Agent security: a design for running untrusted code"
date: 2026-02-05
description: "A design, not yet built, for unattended coding agents: a gVisor sandbox with no secrets and a host broker that holds credentials and logs every call."
part: 4
permalink: /blog/part-4-agent-security/
---

This post is a design. None of it is built: the broker, sandbox image, egress proxy, token minter, and supervisor do not exist on disk. [Part 5](/blog/part-5-future-roadmap/) tracks the milestones and [Part 15](/blog/part-15-tailnet-vm-roadmap-catches-up/) records what shipped first.

[Part 2](/blog/part-2-agentic-development-stack/) described an interactive agent environment. This post covers agents that run unattended: scheduled maintenance agents, code review bots, and ops agents that triage production issues. Such an agent writes code, runs terminal commands, and calls external APIs, so it is a remote code execution engine with network access. If it holds cloud credentials, one prompt injection compromises production. The general threats and the desktop-level defences are in [Part 3](/blog/part-3-security-posture/); this post covers only the agent-specific ones.

## Zero-secret architecture

The design is documented in `nix/autonomous-agents-design.md` (I called it Pattern 2 there, against an earlier design where the agent held its own credentials):

> The agent process holds zero secrets. A control plane (MCP broker) on the host holds every credential and mediates every privileged action. The agent can only do what the broker exposes as a narrow, audited tool.

<figure class="diagram">
<svg viewBox="0 0 880 472" role="img" aria-labelledby="agent-sandbox-title agent-sandbox-desc" xmlns="http://www.w3.org/2000/svg"><title id="agent-sandbox-title">Planned agent sandbox architecture</title><desc id="agent-sandbox-desc">A trusted host runs the credential-holding broker, an egress proxy, a token minter and a supervisor. An untrusted gVisor sandbox reaches the broker only through a Unix socket.</desc><rect class="d-zone" x="0" y="0" width="880" height="472" rx="8"/><text class="d-tag" x="16" y="20">Host (trusted)</text><rect class="d-box" x="24" y="40" width="832" height="136" rx="6"/><rect class="d-focal" x="24" y="40" width="832" height="136" rx="6"/><text class="d-name" x="40" y="68">MCP-tool broker (control plane)</text><text class="d-sub" x="40" y="88">Holds all credentials. Every call is audit-logged: who, what, when, result.</text><text class="d-sub" x="40" y="112">db_ro_query · get_logs · peek_queue</text><text class="d-sub" x="40" y="132">ticket_read · ticket_create · open_pr</text><text class="d-sub" x="40" y="152">write_handoff_doc</text><path class="d-arrow" d="M592 176 V216"/><text class="d-tag" x="604" y="200">Unix socket, bind-mounted</text><rect class="d-box" x="24" y="216" width="280" height="64" rx="6"/><text class="d-name" x="40" y="244">Egress allowlist proxy</text><text class="d-sub" x="40" y="264">Bedrock, registries, git only</text><rect class="d-box" x="24" y="296" width="280" height="64" rx="6"/><text class="d-name" x="40" y="324">Bedrock credential minter</text><text class="d-sub" x="40" y="344">scoped AssumeRole, STS creds</text><rect class="d-box" x="24" y="376" width="280" height="64" rx="6"/><text class="d-name" x="40" y="404">Supervisor</text><text class="d-sub" x="40" y="424">systemd --user, per job</text><rect class="d-zone" x="328" y="216" width="528" height="224" rx="8" style="stroke:var(--accent)"/><text class="d-tag" x="352" y="240">gVisor sandbox (runsc, untrusted)</text><text class="d-name" x="352" y="280">Agent runtime</text><text class="d-sub" x="476" y="280">restricted tool manifest</text><text class="d-name" x="352" y="316">Env</text><text class="d-sub" x="476" y="316">STS key, secret, session token, scoped</text><text class="d-name" x="352" y="352">FS</text><text class="d-sub" x="476" y="352">one scoped bind-mount (code agent), none (ops)</text><text class="d-name" x="352" y="388">Net</text><text class="d-sub" x="476" y="388">closed except broker socket and allowlisted egress</text></svg>
<figcaption>Planned design, not built. The sandbox holds no credentials except short-lived Bedrock STS credentials.</figcaption>
</figure>

## Threat model and mitigations

| Vector | Mitigation |
|---|---|
| Prompt injection (from repo, tickets, chat) | Manual-only triggers. Injected text is data, never a trigger. Restricted tool manifest limits blast radius. |
| Code-generation exploits | gVisor syscall isolation; ephemeral sandbox; no host FS beyond one scoped share. |
| Secret exfiltration | Zero secrets in sandbox. Only short-lived, scoped STS credentials for Bedrock. |
| Context poisoning | Ephemeral per-job sandbox; no persistent agent memory across jobs. |
| Tool abuse | Broker enforces read-only + scope + per-action policy; high-risk actions hard-blocked. |
| Data exfil via network | Default-deny egress; allowlist = Bedrock runtime + package registries/git host. |

## The two agents

Two agents are planned, each with its own capabilities.

### Code agent

| Property | Setting |
|---|---|
| **Purpose** | Code work on local repos + GitHub |
| **Reads** | One repo's source tree (bind-mounted) |
| **Writes (allowed)** | Repo edits, auto-commit, feature branch, open PR |
| **Writes (forbidden)** | Merge, push to `main`, force-push |
| **Secrets held** | None (Bedrock STS credentials only, scoped to `bedrock:InvokeModel`) |
| **Network** | Broker socket + Bedrock + registries/git host |

### Ops agent

Update, 2026-10-15: I now do ticket and queue triage through a retro command instead of an ops agent, so this agent was not built.

| Property | Setting |
|---|---|
| **Purpose** | Triage: read tickets and chat, query infra read-only, draft handoffs and tickets |
| **Reads** | Everything via broker (a ticket tracker, chat, a read-only database, logs, a queue) |
| **Writes (allowed)** | Create tickets + local handoff docs |
| **Writes (forbidden)** | Any chat or email post, any DB write, any infra mutation |
| **Secrets held** | None (Bedrock STS credentials only) |
| **Network** | Broker socket + Bedrock only |

## The MCP broker: control plane

The broker is designed to expose exactly 7 tools. Each has per-action enforcement:

| Tool | Used by | Enforcement |
|---|---|---|
| `db_ro_query` | ops | Read-only DB user; statement allowlist (SELECT/SHOW/EXPLAIN); row/time caps |
| `get_logs` | ops | Read-only IAM; scoped log groups |
| `peek_queue` | ops | receive-without-delete (peek only); scoped queue ARNs |
| `ticket_read` | ops | Read-only tracker token |
| `ticket_create` | ops | Create-only; project allowlist; no transitions/comments to live channels |
| `github_open_pr` | code | Open-PR-only token; no merge, no push to `main` |
| `write_handoff_doc` | ops | Writes to a host review dir only |

Hard-blocked everywhere: chat post, email send, DB write, infra mutation, git merge, force-push, push to protected branches.

The design requires every tool call to be appended to a structured audit log: agent ID, tool name + params, timestamp, result (success/failure + truncated response). The broker should refuse any call that bypasses the logger.

## LLM inference: session-scoped Bedrock credentials

The most important design decision here is how the sandboxed agent calls the LLM.

Rejected option: pass a long-lived API key through the broker. This would require the broker to proxy every LLM request or trust the agent with a key.

Selected approach: at job start, the host mints short-lived credentials with a scoped `AssumeRole` session and injects them into the sandbox as the standard `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` variables. I first designed this around a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`, but the code I actually run uses STS credentials, so the design now matches it:

```typescript
const { Credentials } = await sts.assumeRole({
  RoleArn: "arn:aws:iam::...:role/agent-bedrock-minter",
  RoleSessionName: `agent-${jobId}`,
  Policy: {
    "Version": "2012-10-17",
    "Statement": [{
      Effect: "Allow",
      Action: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      Resource: [
        "arn:aws:bedrock:region-1::foundation-model/anthropic.claude-sonnet-4-*"
      ]
    }]
  },
  DurationSeconds: 43200  // 12 hours or job length, whichever shorter
});
```

Why it is safe: the credentials only authorise the Bedrock runtime. Leaked credentials cannot pivot to the database, logs, queues, or S3. They live for at most 12 hours, or however long the job runs, and the session policy restricts it to specific model ARNs, so the agent can't invoke arbitrary models. Token-cost DoS and prompt exfiltration remain open. CloudWatch billing alarms and model-invocation logging are the planned mitigations.

## Isolation layer: gVisor

The sandboxing technology is gVisor: a user-space kernel that intercepts every syscall from the agent process. Unlike Docker containers (which share the host kernel), gVisor provides a second kernel boundary:

```bash
docker run --runtime=runsc \
  --rm \
  -v /path/to/repo:/workspace:ro \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  agent-image \
  run-task.sh
```

`~/.aws`, `~/.ssh`, `~/.work`, and the host `/home/` must not be reachable from inside the sandbox. Egress is denied except to the allowlist. The Bedrock credentials must fail on any non-Bedrock AWS API (`s3 ls` returns denied). Forbidden tools must be absent or blocked. The checklist below verifies this before go-live.

### Verification checklist (before go-live)

```
□ Confirm ~/.aws, ~/.ssh, ~/.work are NOT reachable from inside sandbox
□ Confirm only the scoped repo bind-mount is visible
□ Confirm egress to arbitrary hosts fails
□ Confirm Bedrock credentials cannot call S3/EC2/RDS
□ Confirm forbidden git commands are blocked
□ Confirm every broker call lands in the audit log
```

## Job lifecycle

The supervisor should enforce this sequence:

```
1. TRIGGER: Manual / scheduler only
   (No ticket or chat polling, external text is data, never a trigger)

2. SPAWN: Supervisor mints scoped Bedrock credentials
   → starts fresh gVisor sandbox
   → bind-mounts scoped share
   → opens broker socket via bind-mounted Unix domain socket
   → closes all other egress

3. RUN: Agent works within restricted tool manifest
   → LLM calls go directly to Bedrock (no broker bottleneck)
   → All privileged actions go through broker (audited)

4. ARTIFACTS:
   Code agent: auto-commits to feature branch → opens PR (never merges)
   Ops agent:  auto-creates tickets → writes handoff docs to review dir

5. TEARDOWN: Sandbox destroyed
   → Bedrock credentials expire
   → Outputs collected to audit log
   → Ephemeral: nothing to poison next run
```

The review boundary is the merge step (code) and ticket triage (ops), both human and out-of-band.

## Phase 2: Firecracker microVMs

gVisor is Phase 1. The design document describes Phase 2: Firecracker microVMs.

Firecracker is AWS's open-source VM manager (the technology behind Lambda and Fargate). Each agent runs in its own microVM with hardware virtualisation via KVM, stronger isolation than gVisor's user-space kernel. No shared kernel surface at all. Virtio-fs handles shared filesystems; vsock replaces the Unix domain socket for host-guest communication.

When I wrote this, the repo had a Firecracker VM configuration for the Hermes agent (`nix/vms/hermes/`). It never booted on real hardware, and it has since been removed. The repo now keeps only design notes, including `nix/autonomous-agents-firecracker-handoff.md`. Phase 2 is untested.

## Deployment: NixOS systemd services

The plan is to declare the whole system in Nix. The file below does not exist:

```nix
# Planned in nix/home/autonomous-agents.nix (not created)
services.agent-supervisor = {
  enable = true;
  agents = {
    code = {
      sandbox = "runsc";          # or "firecracker" in Phase 2
      repo-bind = "/home/developer/repos/work-project";
      schedule = "daily 06:00";
    };
    ops = {
      sandbox = "runsc";
      schedule = "daily 07:00";
    };
  };
};
```

The supervisor would run as a `systemd --user` service, with each sandbox spawned as a transient systemd scope for resource accounting.

## What the design depends on

Nix would make the sandbox image, broker, and systemd units reproducible across machines. The broker speaks MCP, which the agent stack from [Part 2](/blog/part-2-agentic-development-stack/) already uses. Secrets handling and audit logging would reuse the sops-nix setup from [Part 3](/blog/part-3-security-posture/).

[Part 5](/blog/part-5-future-roadmap/) turns this design into a roadmap.
