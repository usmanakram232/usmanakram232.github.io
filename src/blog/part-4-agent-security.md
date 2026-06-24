---
title: "Agent security: running untrusted code safely"
date: 2026-02-05
description: "AI agents that write and execute code, inside gVisor sandboxes, holding zero secrets, mediated by an audited MCP broker on the host."
part: 4
permalink: /blog/part-4-agent-security/
---

In [Part 2](/blog/part-2-agentic-development-stack/), I described an interactive agentic environment: OpenCode with MCP servers and skills. But what happens when agents run unattended? What about scheduled maintenance agents, automated code review bots, or ops agents that triage production issues?

An unattended AI agent that writes code, runs terminal commands, and accesses external APIs is an autonomous remote code execution engine with network access. In security terms, it's the nightmare scenario. Put your cloud credentials inside that agent, and one prompt injection later your production infrastructure is compromised.

## Pattern 2: zero-secret architecture

The solution is a security model I call Pattern 2 (documented in `nix/autonomous-agents-design.md`):

> The agent process holds zero secrets. A control plane (MCP broker) on the host holds every credential and mediates every privileged action. The agent can only do what the broker exposes as a narrow, audited tool.

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

Two autonomous agents, each with a distinct capability matrix.

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

The broker exposes exactly 7 tools. Each has per-action enforcement:

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

Every tool call is appended to a structured audit log: agent ID, tool name + params, timestamp, result (success/failure + truncated response). The broker refuses to serve calls that bypass the logger.

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

Why it's safe: the key only authenticates Bedrock runtime. A leaked key cannot pivot to RDS, CloudWatch, SQS, or S3. The key lives for at most 12 hours, or however long the job runs. The session policy restricts to specific model ARNs, so the agent can't invoke arbitrary models. CloudWatch billing alarms and model-invocation logging cap token-cost DoS and prompt exfiltration.

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

From inside the sandbox, `~/.aws`, `~/.ssh`, `~/.ginmon`, and the host `/home/` are not reachable. Egress is denied to everything except the allowlist. The Bedrock token cannot call a non-Bedrock AWS API (`s3 ls` returns denied). Forbidden tools are absent or blocked.

### Verification checklist (before go-live)

```
□ Confirm ~/.aws, ~/.ssh, ~/.ginmon are NOT reachable from inside sandbox
□ Confirm only the scoped repo bind-mount is visible
□ Confirm egress to arbitrary hosts fails
□ Confirm Bedrock token cannot call S3/EC2/RDS
□ Confirm forbidden git commands are blocked
□ Confirm every broker call lands in the audit log
```

## Job lifecycle

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

The transition from gVisor to Firecracker is already tested. The repo has a working Hermes VM configuration (`nix/vms/hermes/`) that proves the networking, storage, and lifecycle management on this hardware.

## Deployment: NixOS systemd services

The entire autonomous agent system is declared in Nix:

```nix
# Planned in nix/home/autonomous-agents.nix
services.agent-supervisor = {
  enable = true;
  agents = {
    code = {
      sandbox = "runsc";          # or "firecracker" in Phase 2
      repo-bind = "/home/usman/repos/ginmon-backend";
      schedule = "daily 06:00";
    };
    ops = {
      sandbox = "runsc";
      schedule = "daily 07:00";
    };
  };
};
```

The supervisor runs as a `systemd --user` service, and the per-agent sandboxes are spawned as transient systemd scopes for resource accounting.

## What Pattern 2 enables

This architecture is the result of years of layered infrastructure. Without Nix, reproducing the sandbox image, broker, and systemd units across machines would be impractical. Without the agentic stack from Part 2, the broker MCP protocol would be foreign. Without the security posture from Part 3, the sops-nix integration and audit logging would require separate infrastructure.

In [Part 5](/blog/part-5-future-roadmap/), we'll look at what's next: the Hermes agent system, full NixOS switch, skill architecture improvements, and the longer-term vision.
