---
title: "How We Ship Production Java with AI Agents"
date: 2026-06-27
description: "Six months of real production Java on a financial services backend — multi-agent automation, automated reviews, and the human decisions that still matter."
series: false
permalink: /blog/my-agentic-workflow/
---

# How We Ship Production Java with AI Agents (and Why Humans Still Matter)

AI autocomplete is fine. It saves keystrokes. But the real leverage comes from something different: multi-agent automation, where specialized agents handle creation, review, and audit — each with defined scope, each checked by the next — and a human decides what actually ships.

This isn't speculative. It's what six months of real production Java on a financial services backend looks like. Here's the pipeline, what it catches, and where human judgment still wins.

![Scaling agentic software production pipeline](/assets/img/scaling-agentic-workflow.png)

---

## 1. Agents Build the Code

Agents don't write code in isolation. They execute structured plans, dispatch sub-agents for independent work, and validate at every step.

### From Spec to Implementation in One Pass

Features go through a four-phase pipeline: Proposal → Design → Specs → Tasks. Each phase produces artifacts the next phase consumes. An invoicing system — 18 tasks across domain IDs, database migrations, code generation, message definitions, fee calculations, and API endpoints — was built by dispatching sub-agents to work in parallel:

```
Task 1: Domain IDs and Enums
Task 2: Database Migration     → Sub-agent A → commit
Task 3: Code Generation
Task 4: Message Definitions    → Sub-agent B → commit
Task 5: Fee Calculation        → Sub-agent C → TDD cycle → commit
Task 6: Valuation Calculation  → Sub-agent D → commit
...
```

Each sub-agent received the full context: existing patterns, field types, table schemas, and the exact file to create. After every sub-agent, a build verification step confirmed no breakage.

### TDD as a Native Agent Cycle

Fee calculation was implemented Red-Green-Refactor:

1. The agent wrote tests first with a stub returning `BigDecimal.ZERO`. Four tests failed. (RED)
2. It implemented the formula. All six passed. (GREEN)
3. It verified no refactoring was needed. Minimal clean implementation.

### Refactoring Through Conversation

A valuation service was making three separate SQL queries to get the latest valuation and the largest position. The agent proposed a single query using a join with aggregation and ordering. The human reviewed it, approved the logic, and the agent implemented it. Three round-trips became one. Existing tests still passed.

---

## 2. Automated Reviews Catch What Humans Miss

Every code change runs through multi-axis review before reaching a human. Five axes. Eighty-plus rules. All enforced by automated agents.

### Java Correctness (Axis 1)

A review agent caught a critical logic error involving a wrong method call — a service used a general aggregation where a specific business rule required a targeted calculation. The agent flagged the mismatch against the spec, and the fix propagated across three layers. One line changed the logic, but it took the automated reviewer to catch it before it reached production.

Other automated catches:

- Timestamp inconsistency in upsert logic (updating one timestamp but not the other)
- Missing enum value required by the spec
- Random ID generation using `UUID.randomUUID()` instead of an injected generator
- `Instant.now()` bypassing the injected `Clock` — broken testability

### Schema Review (Axis 2)

Database migrations are checked against strict rules:

- No `ENUM` columns. All enums must use typed columns with converters.
- IDs, timestamps, and monetary amounts use fixed-size types throughout.
- All constraints must be named using a consistent convention.
- New `NOT NULL` columns on existing tables require a three-step migration: nullable column, backfill, then constraint.

One session caught an `ENUM` column violation, triggered a corrective migration, and the ORM code was regenerated — all before the PR was reviewed by a human.

### API Contracts and Test Compliance (Axes 3-4)

- Every endpoint must declare a security scheme. Missing declarations block the PR.
- Every test method requires four tags: role, outcome, HTTP method, path.
- Status codes use named constants, never raw integers.
- Hardcoded UUIDs in test request bodies are blocked. Fixtures must seed through the test utility.
- Request bodies must be text block variables, never inline JSON strings.

### Distributed Systems (Axis 5)

Changes spanning API and processing modules trigger additional checks:

- Webhook handlers must check current database state before writing. Idempotency matters.
- Message queue handlers must check if work is already done.
- No blocking waits for external services in the API module.
- Business logic must not live in shared utility modules. That's where discipline breaks down.

---

## 3. The Human Decides What Ships

The agent workflow is not autonomous shipping. Every output passes through human review before merge. The pattern is always: **Agent proposes. Human validates. Agent adjusts. Tests verify. Human approves.**

### Design Decisions Are Not Delegatable

A status transition caused records to get stuck permanently in an intermediate state. The agent identified the root cause and proposed two fixes:

- **Option A:** Add the missing transition to the state machine.
- **Option B:** Apply a synthetic two-step transition atomically in the handler.

Both came with rationale. The human chose Option A: "the state machine should reflect real-world timing, not an idealized sequential path." The agent wrote the fix, started with a failing test, confirmed it passed. All existing tests succeeded.

### Code Reviews With Teeth

Reviews produce explicit verdicts and blockers. "Not ready to merge. Three critical issues." A typical output:

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

The agent does not approve its own code. The human reviews, demands fixes, and decides when to merge. This constraint isn't a bug. It's the whole point.

### Worktree Isolation Enables Parallel Streams

The billing system spanned five concurrent Git worktrees, each on a separate branch. A rebase session kept migration versioning collision-free:

| Branch | Migrations | Status |
|--------|-----------|--------|
| main | V1–V2 | — |
| Feature A | V6–V10 | Rebased |
| Feature B | V3–V5 | Rebased + fixed |
| Feature C | V11–V13 | Rebased + fixed |
| Feature D | V14+ | Queued |

Each rebase followed the same pattern: resolve migration versions, regenerate ORM code (never manually merge generated files), fix known patterns, run targeted tests, verify the full suite. The human directed sequencing and verified each worktree.

---

## What This Looks Like

After several months, here's what we measure:

- **Most of the code is agent-written:** domain model, migrations, services, tests, API specs.
- **Zero enum-in-SQL violations** since automated schema review was introduced. The rule is enforced before the migration hits a PR.
- **Review latency dropped dramatically.** Agents catch the common issues. Humans focus on the decisions that require judgment.
- **Multiple concurrent feature worktrees** in flight simultaneously, coordinated by migration version ordering.
- **Every commit has a passing build.** Agents verify compilation after every sub-agent, not just at PR time.

The architecture is not "AI replaces humans." It's AI that scales what one engineer can do. Agents create. Gates catch the mechanical. And the human saves their energy for the decisions that matter.
