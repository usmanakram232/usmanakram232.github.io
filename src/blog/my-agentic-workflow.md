---
title: "How We Ship Production Java with AI Agents"
date: 2026-06-27
description: "Six months of real production Java on a financial services backend — multi-agent automation, automated reviews, and the human decisions that still matter."
image: "/assets/img/scaling-agentic-workflow.png"
series: false
permalink: /blog/my-agentic-workflow/
---

# How We Ship Production Java with AI Agents (and Why Humans Still Matter)

AI autocomplete saves keystrokes, and that's about the extent of it. The real leverage I've found comes from somewhere else entirely: multi-agent automation, where specialized agents handle creation, review, and audit — each with a defined scope, each checked by the next one in line — while a human decides what actually ships.

This isn't a thought experiment. It's what six months of real production Java on a financial services backend has looked like for me. Here's the pipeline, what it catches, and where human judgment still wins.

![Scaling agentic software production pipeline](/assets/img/scaling-agentic-workflow.png)

---

## 1. Agents Build the Code

Agents don't write code in isolation. They execute structured plans, dispatch sub-agents for independent chunks of work, and validate at every step along the way.

### From Spec to Implementation in One Pass

Features move through a four-phase pipeline: Proposal → Design → Specs → Tasks. Each phase produces artifacts the next one consumes. For an invoicing system — 18 tasks spanning domain IDs, database migrations, code generation, message definitions, fee calculations, and API endpoints — I dispatched sub-agents to work several of those tasks in parallel:

```
Task 1: Domain IDs and Enums
Task 2: Database Migration     → Sub-agent A → commit
Task 3: Code Generation
Task 4: Message Definitions    → Sub-agent B → commit
Task 5: Fee Calculation        → Sub-agent C → TDD cycle → commit
Task 6: Valuation Calculation  → Sub-agent D → commit
...
```

Each sub-agent got the full context it needed — existing patterns, field types, table schemas, and the exact file to create — and a build verification step ran after every one of them to confirm nothing had broken.

### TDD as a Native Agent Cycle

The fee calculation task followed Red-Green-Refactor almost by default:

1. The agent wrote tests first, against a stub returning `BigDecimal.ZERO`. Four failed. (RED)
2. It implemented the formula. All six passed. (GREEN)
3. It checked whether refactoring was warranted and decided the implementation was already clean and minimal.

### Refactoring Through Conversation

A valuation service was making three separate SQL queries just to get the latest valuation and the largest position. The agent proposed collapsing that into a single query with a join, aggregation, and ordering. I reviewed the logic, approved it, and the agent implemented the change — three round-trips became one, and every existing test still passed.

---

## 2. Automated Reviews Catch What Humans Miss

Every code change runs through multi-axis review before it reaches a human — five axes, eighty-plus rules, all enforced by automated agents.

### Java Correctness (Axis 1)

A review agent once caught a critical logic error buried in a wrong method call: a service was using a general aggregation where a specific business rule required a targeted calculation instead. The agent flagged the mismatch against the spec, and the fix ended up propagating across three layers. Only one line actually changed the logic, but it took an automated reviewer to catch it before it reached production.

Other automated catches:

- Timestamp inconsistency in upsert logic (updating one timestamp but not the other)
- Missing enum value required by the spec
- Random ID generation using `UUID.randomUUID()` instead of an injected generator
- `Instant.now()` bypassing the injected `Clock` — broken testability

### Schema Review (Axis 2)

Database migrations get checked against a strict set of rules:

- No `ENUM` columns. All enums must use typed columns with converters.
- IDs, timestamps, and monetary amounts use fixed-size types throughout.
- All constraints must be named using a consistent convention.
- New `NOT NULL` columns on existing tables require a three-step migration: nullable column, backfill, then constraint.

One session caught an `ENUM` column violation, triggered a corrective migration, and had the ORM code regenerated — all before the PR ever landed in front of a human.

### API Contracts and Test Compliance (Axes 3-4)

- Every endpoint must declare a security scheme. Missing declarations block the PR.
- Every test method requires four tags: role, outcome, HTTP method, path.
- Status codes use named constants, never raw integers.
- Hardcoded UUIDs in test request bodies are blocked. Fixtures must seed through the test utility.
- Request bodies must be text block variables, never inline JSON strings.

### Distributed Systems (Axis 5)

Changes that span the API and processing modules trigger a few additional checks:

- Webhook handlers must check current database state before writing. Idempotency matters.
- Message queue handlers must check if work is already done.
- No blocking waits for external services in the API module.
- Business logic must not live in shared utility modules. That's where discipline breaks down.

---

## 3. The Human Decides What Ships

None of this is autonomous shipping. Every output passes through human review before merge, and the pattern is always the same: **Agent proposes. Human validates. Agent adjusts. Tests verify. Human approves.**

### Design Decisions Are Not Delegatable

A status transition was leaving records stuck permanently in an intermediate state. The agent traced the root cause and came back with two possible fixes:

- **Option A:** Add the missing transition to the state machine.
- **Option B:** Apply a synthetic two-step transition atomically in the handler.

Both came with rationale attached. I chose Option A — the state machine should reflect real-world timing, not an idealized sequential path — and the agent wrote the fix, starting with a failing test that then passed once the change landed. Every existing test still succeeded.

### Code Reviews With Teeth

Reviews come back with explicit verdicts and named blockers, not vague suggestions. "Not ready to merge. Three critical issues." is a typical opening line. Here's what one output actually looked like:

```
### HIGH
- CalculationService.java — Uses wrong data source for business rule.
  Use getEligibleItems(), not getAllItems().
- OrderStatus.java — Missing enum value per spec requirement.

### MEDIUM
- OrderEndpoint.java — Validation commented out,
  no TODO tracking the deferred work.

### LOW
- AggregationService.java — Outdated javadoc referencing
  old three-query approach after refactor.
```

The agent never approves its own code. I review it, demand fixes, and decide when it merges — that constraint isn't a bug, it's the whole point.

### Worktree Isolation Enables Parallel Streams

The billing system spanned five concurrent Git worktrees, each on its own branch, and a rebase session kept migration versioning collision-free:

| Branch | Migrations | Status |
|--------|-----------|--------|
| main | V1–V2 | — |
| Feature A | V6–V10 | Rebased |
| Feature B | V3–V5 | Rebased + fixed |
| Feature C | V11–V13 | Rebased + fixed |
| Feature D | V14+ | Queued |

Each rebase followed the same pattern: resolve migration versions, regenerate ORM code (never manually merge generated files), fix known patterns, run targeted tests, then verify the full suite. I directed the sequencing and checked each worktree myself.

---

## What This Looks Like

Several months in, here's what I actually measure:

- **Most of the code is agent-written:** domain model, migrations, services, tests, API specs.
- **Zero enum-in-SQL violations** since automated schema review was introduced. The rule is enforced before the migration hits a PR.
- **Review latency dropped dramatically.** Agents catch the common issues. Humans focus on the decisions that require judgment.
- **Multiple concurrent feature worktrees** in flight simultaneously, coordinated by migration version ordering.
- **Every commit has a passing build.** Agents verify compilation after every sub-agent, not just at PR time.

The architecture isn't "AI replaces humans." It's AI that scales what one engineer can do: agents create, gates catch the mechanical stuff, and the human saves their energy for the decisions that actually matter.
