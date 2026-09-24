---
title: "Agent security: running untrusted code safely"
date: 2026-02-05
description: "AI agents that write and execute code, inside gVisor sandboxes, holding zero secrets, mediated by an audited MCP broker on the host."
part: 4
permalink: /blog/part-4-agent-security/
---

In [Part 2](/blog/part-2-agentic-development-stack/), I described an interactive agentic environment: OpenCode with MCP servers and skills. But what happens when agents run unattended — scheduled maintenance agents, automated code review bots, ops agents that triage production issues on their own?

An unattended AI agent that writes code, runs terminal commands, and accesses external APIs is an autonomous remote code execution engine with network access. In security terms, it's the nightmare scenario. Put your cloud credentials inside that agent, and one prompt injection later your production infrastructure is compromised.

## Pattern 2: zero-secret architecture

The solution is a security model I call Pattern 2 (documented in `nix/autonomous-agents-design.md`):

> The agent process holds zero secrets. A control plane (MCP broker) on the host holds every credential and mediates every privileged action. The agent can only do what the broker exposes as a narrow, audited tool.

What follows describes a validated design and a written implementation plan, not a system that's running yet. As of this writing, none of the implementation milestones — broker, sandbox image, egress proxy, token minter, supervisor — exist on disk. The architecture, tool list, and lifecycle below are the target this design commits to, verified against the checklist further down before go-live.

```
┌───────────────────────── HOST (trusted) ─────────────────────────┐
│                                                                   │
│  MCP-tool BROKER (control plane) — holds ALL credentials          │
│    Tools: mysql_ro_query · cloudwatch_get_logs · sqs_peek_dlq     │
│           jira_read · jira_create_ticket · github_open_pr         │
│           write_handoff_doc                                       │
│    Audit log: every call logged (who/what/when/result)            │
│                                                                   │
│         ▲ Unix domain socket (bind-mounted into sandbox)          │
│         │                                                         │
│  Egress allowlist proxy — bedrock-runtime + registries/git only  │
│  Bedrock token minter — scoped AssumeRole → short-term API key   │
│  Supervisor (systemd --user) — spawn/scope/teardown per job      │
│                                                                   │
│   ┌──────────── gVisor sandbox (runsc, untrusted) ────────────┐  │
│   │  agent runtime + restricted tool manifest                 │  │
│   │  env: AWS_BEARER_TOKEN_BEDROCK (short-lived, scoped)      │  │
│   │  FS: one scoped bind-mount (code agent) / none (ops)      │  │
│   │  NET: closed except broker socket + allowlisted egress    │  │
│   └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Threat model and mitigations

| Vector | Mitigation |
|---|---|
| Prompt injection (from repo/Jira/Slack) | Manual-only triggers. Injected text is data, never a trigger. Restricted tool manifest limits blast radius. |
| Code-generation exploits | gVisor syscall isolation; ephemeral sandbox; no host FS beyond one scoped share. |
| Secret exfiltration | Zero secrets in sandbox. Only a short-lived, scoped Bedrock API key. |
| Context poisoning | Ephemeral per-job sandbox; no persistent agent memory across jobs. |
| Tool abuse | Broker enforces read-only + scope + per-action policy; high-risk actions hard-blocked. |
| Data exfil via network | Default-deny egress; allowlist = Bedrock runtime + package registries/git host. |

## The two agents

Two autonomous agents are planned, each with a distinct capability matrix.

### Code agent

| | |
|---|---|
| **Purpose** | Code work on local repos + GitHub |
| **Reads** | One repo's source tree (bind-mounted) |
| **Writes (allowed)** | Repo edits, auto-commit, feature branch, open PR |
| **Writes (forbidden)** | Merge, push to `main`, force-push |
| **Secrets held** | None (Bedrock token only, scoped to `bedrock:InvokeModel`) |
| **Network** | Broker socket + Bedrock + registries/git host |

### Ops agent

| | |
|---|---|
| **Purpose** | Triage: read Jira/Slack, query infra read-only, draft handoffs/tickets |
| **Reads** | Everything via broker (Jira, Slack, MySQL RDS RO, CloudWatch, SQS DLQs) |
| **Writes (allowed)** | Create Jira tickets + local handoff docs |
| **Writes (forbidden)** | Any Slack/email post, any DB write, any infra mutation |
| **Secrets held** | None (Bedrock token only) |
| **Network** | Broker socket + Bedrock only |

## The MCP broker: control plane

The broker is designed to expose exactly 7 tools. Each has per-action enforcement:

| Tool | Used by | Enforcement |
|---|---|---|
| `mysql_ro_query` | ops | Read-only DB user; statement allowlist (SELECT/SHOW/EXPLAIN); row/time caps |
| `cloudwatch_get_logs` | ops | Read-only IAM; scoped log groups |
| `sqs_peek_dlq` | ops | receive-without-delete (peek only); scoped DLQ ARNs |
| `jira_read` | ops | Read-only Jira token |
| `jira_create_ticket` | ops | Create-only; project allowlist; no transitions/comments to live channels |
| `github_open_pr` | code | Open-PR-only token; no merge, no push to `main` |
| `write_handoff_doc` | ops | Writes to a host review dir only |

Hard-blocked everywhere: Slack post, email send, DB write, infra mutation, git merge, force-push, push to protected branches.

The design requires every tool call to be appended to a structured audit log: agent ID, tool name + params, timestamp, result (success/failure + truncated response). The broker is specified to refuse serving calls that bypass the logger, though that's a design requirement right now, not a built and tested guarantee.

## LLM inference: session-scoped Bedrock API key

The most important design decision here is how the sandboxed agent calls the LLM.

Rejected option: pass a long-lived API key through the broker. This would require the broker to proxy every LLM request or trust the agent with a key.

Selected approach: at job start, the host mints a short-term Amazon Bedrock API key and injects it into the sandbox as `AWS_BEARER_TOKEN_BEDROCK`. The key is crafted via a scoped `AssumeRole` session:

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
        "arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-sonnet-4-*"
      ]
    }]
  },
  DurationSeconds: 43200  // 12 hours or job length, whichever shorter
});
```

Why it's safe: the key only authenticates Bedrock runtime. A leaked key cannot pivot to RDS, CloudWatch, SQS, or S3. The key lives for at most 12 hours, or however long the job runs, and the session policy restricts it to specific model ARNs, so the agent can't invoke arbitrary models. Token-cost DoS and prompt exfiltration are the remaining gaps — CloudWatch billing alarms and model-invocation logging are the planned mitigations, tracked as residual-risk hardening in the implementation plan, but neither is wired up yet.

## Isolation layer: gVisor

The sandboxing technology is gVisor: a user-space kernel that intercepts every syscall from the agent process. Unlike Docker containers (which share the host kernel), gVisor provides a second kernel boundary:

```bash
docker run --runtime=runsc \
  --rm \
  -v /path/to/repo:/workspace:ro \
  -e AWS_BEARER_TOKEN_BEDROCK=$TOKEN \
  agent-image \
  run-task.sh
```

By design, `~/.aws`, `~/.ssh`, `~/.work`, and the host `/home/` should not be reachable from inside the sandbox. Egress should be denied to everything except the allowlist. The Bedrock token should not be able to call a non-Bedrock AWS API (`s3 ls` should return denied). Forbidden tools should be absent or blocked. None of this is a claim about a running system yet — it's exactly what the checklist below exists to verify before go-live.

### Verification checklist (before go-live)

```
□ Confirm ~/.aws, ~/.ssh, ~/.work are NOT reachable from inside sandbox
□ Confirm only the scoped repo bind-mount is visible
□ Confirm egress to arbitrary hosts fails
□ Confirm Bedrock token cannot call S3/EC2/RDS
□ Confirm forbidden git commands are blocked
□ Confirm every broker call lands in the audit log
```

## Job lifecycle

This is the planned lifecycle — the sequence the supervisor is designed to enforce once built:

```
1. TRIGGER: Manual / scheduler only
   (No Jira/Slack polling — external text is data, never a trigger)

2. SPAWN: Supervisor mints scoped Bedrock token
   → starts fresh gVisor sandbox
   → bind-mounts scoped share
   → opens broker socket via bind-mounted Unix domain socket
   → closes all other egress

3. RUN: Agent works within restricted tool manifest
   → LLM calls go directly to Bedrock (no broker bottleneck)
   → All privileged actions go through broker (audited)

4. ARTIFACTS:
   Code agent: auto-commits to feature branch → opens PR (never merges)
   Ops agent:  auto-creates Jira tickets → writes handoff docs to review dir

5. TEARDOWN: Sandbox destroyed
   → Bedrock token expires
   → Outputs collected to audit log
   → Ephemeral: nothing to poison next run
```

The review boundary is the merge step (code) and ticket triage (ops), both human and out-of-band.

## Phase 2: Firecracker microVMs

gVisor is Phase 1. The design document already describes Phase 2: Firecracker microVMs.

Firecracker is AWS's open-source VM manager (the technology behind Lambda and Fargate). Each agent runs in its own microVM with hardware virtualisation via KVM — stronger isolation than gVisor's user-space kernel. No shared kernel surface at all. Virtio-fs handles shared filesystems; vsock replaces the Unix domain socket for host-guest communication.

The repo already has a declarative Firecracker VM configuration — but for a different, already-existing system: the Hermes agent (`nix/vms/hermes/`), not the autonomous-agent runner described above. That config defines the TAP networking, virtio-fs shares, and systemd lifecycle management a Firecracker microVM needs on this hardware, and it's a useful template for what Phase 2 of the autonomous-agent runner will need. It hasn't been switched to and run on real hardware yet, though — it lives inside `nixosConfigurations.default`, the full NixOS config for the Linux desktop, which (as covered in [Part 5](/blog/part-5-future-roadmap/)) that machine hasn't adopted; it's still running Fedora with home-manager layered on top. So "the transition from gVisor to Firecracker" isn't tested yet — what exists is a config that hasn't been booted.

## Deployment: NixOS systemd services

The plan is to declare the entire autonomous agent system in Nix:

```nix
# Planned in nix/home/autonomous-agents.nix
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

The supervisor is designed to run as a `systemd --user` service, with per-agent sandboxes spawned as transient systemd scopes for resource accounting.

## What Pattern 2 enables

This architecture is the result of years of layered infrastructure. Reproducing the sandbox image, broker, and systemd units across machines would be impractical without Nix. The broker's MCP protocol only makes sense because of the agentic stack from Part 2 — without it, the whole control-plane idea would be foreign. And the sops-nix integration and audit logging lean directly on the security posture from Part 3; building that separately would mean standing up infrastructure this repo already has.

In [Part 5](/blog/part-5-future-roadmap/), we'll look at what's next: the Hermes agent system, full NixOS switch, skill architecture improvements, and the longer-term vision.
