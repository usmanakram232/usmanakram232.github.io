---
title: "How I ship production Java with AI agents"
date: 2026-06-27
description: "Six months of production Java on a backend service: agents that build, review and audit code, and the decisions I still make myself."
image: "/assets/img/scaling-agentic-workflow.webp"
series: false
permalink: /blog/my-agentic-workflow/
---

Autocomplete saves keystrokes. What changed my output was splitting work across agents: one writes code from a spec, others review it against written rules, and I decide what merges.

This is what six months of production Java on a backend service looked like for me. The sections below cover the pipeline, what the reviews caught, and where I still decide myself.

![Scaling agentic software production pipeline](/assets/img/scaling-agentic-workflow.webp)

## 1. Agents build the code

Agents work from structured plans. They dispatch sub-agents for independent chunks and validate after each step.

### From spec to implementation in one pass

Features move through four phases: proposal, design, specs, tasks. Each phase produces artifacts the next one consumes. For a reporting feature with 18 tasks (domain IDs, database migrations, code generation, message definitions, pricing rules, API endpoints), I dispatched sub-agents to work several of those tasks in parallel:

```
Task 1: Domain IDs and Enums
Task 2: Database Migration   → Sub-agent A → commit
Task 3: Code Generation
Task 4: Message Definitions  → Sub-agent B → commit
Task 5: Pricing Rules      → Sub-agent C → TDD cycle → commit
Task 6: Report Totals → Sub-agent D → commit
...
```

Each sub-agent received the existing patterns, field types, table schemas and the exact file to create. A build ran after every sub-agent.

### TDD as an agent cycle

The pricing rules task followed red, green, refactor:

1. The agent wrote tests first, against a stub returning `BigDecimal.ZERO`. Four failed (red).
2. It implemented the formula. All six passed (green).
3. It checked whether refactoring was warranted and decided the implementation was already minimal.

### Refactoring through conversation

A reporting service was making three separate SQL queries just to get the latest total and the largest entry. The agent proposed collapsing that into a single query with a join, aggregation, and ordering. I reviewed the logic, approved it, and the agent implemented it. Three round-trips became one and every existing test still passed.


## 2. Automated reviews catch what humans miss

Every code change goes through automated review on five axes before it reaches me. The axes cover more than eighty written rules.

### Java correctness (axis 1)

A review agent once caught a wrong method call. A service used a general aggregation where the business rule required a targeted calculation. The agent flagged the mismatch against the spec, and the fix touched three layers, though only one line changed the logic. The reviewer caught it before production.

Other automated catches:

- Timestamp inconsistency in upsert logic (updating one timestamp but not the other)
- Missing enum value required by the spec
- Random ID generation using `UUID.randomUUID()` instead of an injected generator
- `Instant.now()` bypassing the injected `Clock`, which breaks testability

### Schema review (axis 2)

Database migrations get checked against a strict set of rules:

- No `ENUM` columns. All enums must use typed columns with converters.
- IDs, timestamps, and monetary amounts use fixed-size types throughout.
- All constraints must be named using a consistent convention.
- New `NOT NULL` columns on existing tables require a three-step migration: nullable column, backfill, then constraint.

One session caught an `ENUM` column violation, wrote a corrective migration and regenerated the ORM code before the PR reached me.

### API contracts and test compliance (axes 3 and 4)

- Every endpoint must declare a security scheme. A missing declaration blocks the PR.
- Every test method requires four tags: role, outcome, HTTP method, path.
- Status codes use named constants, never raw integers.
- Hardcoded UUIDs in test request bodies are blocked. Fixtures must seed through the test utility.
- Request bodies must be text block variables, never inline JSON strings.

### Distributed systems (axis 5)

Changes that span the API and processing modules trigger extra checks:

- Webhook handlers must check current database state before writing. 
- Message queue handlers must check if work is already done.
- No blocking waits for external services in the API module.
- Business logic must not live in shared utility modules.


## 3. The human decides what ships

Nothing ships autonomously. Every output passes human review before merge. The sequence is the same each time: the agent proposes, I validate, the agent adjusts, tests verify, and I approve.

### Design decisions stay with me

A status transition was leaving records stuck permanently in an intermediate state. The agent traced the root cause and came back with two possible fixes:

- **Option A:** Add the missing transition to the state machine.
- **Option B:** Apply a synthetic two-step transition atomically in the handler.

Both came with rationale attached. I chose Option A because the state machine should reflect real-world timing, not an idealized sequential path. The agent wrote a failing test, then the fix. Every existing test still passed.

### Reviews with explicit verdicts

Reviews come back with a verdict and named blockers. "Not ready to merge. Three critical issues." is a typical opening line. One output looked like this:

```
### HIGH
- PricingService.java: Uses wrong data source for business rule.
 Use getEligibleItems(), not getAllItems().
- JobStatus.java: Missing enum value per spec requirement.

### MEDIUM
- JobEndpoint.java: Validation commented out,
 no TODO tracking the deferred work.

### LOW
- AggregationService.java: Outdated javadoc referencing
 old three-query approach after refactor.
```

The agent never approves its own code. I review it, request fixes and decide when it merges.

### Worktrees allow parallel streams

The reporting feature spanned five concurrent Git worktrees, each on its own branch. A rebase session kept migration versions from colliding:

| Branch | Migrations | Status |
|--------|-----------|--------|
| main | V1 to V2 | none |
| Feature A | V6 to V10 | Rebased |
| Feature B | V3 to V5 | Rebased + fixed |
| Feature C | V11 to V13 | Rebased + fixed |
| Feature D | V14+ | Queued |

Each rebase followed the same pattern: resolve migration versions, regenerate ORM code (never manually merge generated files), fix known patterns, run targeted tests, then verify the full suite. I directed the sequencing and checked each worktree myself.


## What I measure

After several months, this is what I track:

- Agents write most of the code: domain model, migrations, services, tests and API specs. I have not counted the share.
- No enum-in-SQL violations since automated schema review started. The rule is enforced before the migration reaches a PR.
- Agents catch the common issues, so I spend review time on decisions that need judgment. I have no before-and-after latency numbers.
- Several feature worktrees run at once, coordinated by migration version order.
- Every commit has a passing build, because agents compile after each sub-agent, not only at PR time.

Agents create, automated gates catch mechanical errors, and I decide the rest.
