---
title: "My notes are a codebase. The LLM is the build step."
date: 2026-06-27
description: "A Git repo, a fish function, and a compile step that turns raw daily captures into a wiki you actually read."
image: "/assets/img/notes-build-pipeline.webp"
series: false
permalink: /blog/notes-as-a-codebase/
---

The retrieval problem is what kills most note-taking systems. Not the app, not the habit, not the capture discipline. Notes pile up, stop being referenced, and the value you meant to extract just sits there going stale.

I've been through the usual rotation. Notion. Bear. Plain markdown folders. Obsidian with seventeen plugins and a graph view that looked impressive and contained nothing I could find. Each time the same arc: initial momentum, gradual drift, read-never archive.

What finally worked was treating my notes like a codebase and letting an LLM be the compiler.

## The core idea

The setup is modeled after Andrej Karpathy's ["LLM Wiki" gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The premise is simple: you feed raw input, and the LLM synthesizes it into a wiki you never touch by hand — you capture, and periodically you compile.

It flips where the effort goes. Traditional note-taking asks you to maintain structure as you go; here, you maintain nothing and just capture, and structure falls out of compilation.

![Diagram of the note-taking build pipeline: raw captures flow into an LLM compiler which outputs a synthesised wiki](/assets/img/notes-build-pipeline.webp)

## The repo

Everything lives in `~/Dev/notes`, a single Git repo. `wiki/`, `til/`, `journal/`, and the structured note directories are version-controlled and diffable. `raw/` and `scratch/` are gitignored on purpose — the inbox itself never needs a history, only what gets compiled out of it does. No app lock-in, no sync service to babysit.

```
notes/
├── raw/          # INBOX — anything unprocessed
│   └── work/     # work-specific inbox
│
├── wiki/         # LLM-COMPILED — never edit by hand
│   ├── INDEX.md
│   ├── concepts/ # one .md per synthesised concept
│   └── work/     # work knowledge, compiled separately
│
├── til/          # Today I Learned — one file per insight
├── journal/      # Reflective writing (human-written)
├── work/         # Structured work notes — specs, sprints
├── learning/     # Topic study notes
├── writing/      # Long-form drafts
└── scratch/      # Temp files, not committed
```

The architectural decision that makes everything else work: `raw/` and `wiki/` are two separate namespaces with one-way data flow. Humans write to `raw/`. Humans read from `wiki/`. The LLM is the only thing that writes to `wiki/`.

This sounds rigid. It is rigid. That rigidity is also why the wiki is trustworthy. When you know a directory is always synthesized and never hand-edited to add one quick thing, you actually read it.

## Capturing: the `note` function

The capture loop has to be fast or it fails. My solution is a single `note` command that routes input to the right file.

```fish
# General inbox — goes to raw/YYYY-MM-DD.md
note some thought here
note idea: build a thing
note link: https://example.com — article on distributed tracing
note ?what's the difference between jemalloc and tcmalloc?
note learn: read about BPF internals
note ref: "Designing Data-Intensive Applications", Kleppmann

# Work inbox — goes to raw/work/YYYY-MM-DD.md
note work: billing bug reproducible with order > 10k
note work: todo: check spec section 21.02
note work: idea: add retry logic to payment webhook handler

# Any other context — auto-creates raw/<context>/YYYY-MM-DD.md
note learning: finished A1 German playlist
note personal: permit renewal date is 2027-03-01

# No text — opens today's file in $EDITOR
note
note work:
```

The routing rule: if the first word ends with `:` and is not a reserved content tag (`idea`, `link`, `ref`, `learn`, `todo`, `fix`), it becomes a context router. Content tags stay in the text and route to the general inbox.

`note idea: build X` goes to the general inbox with the text `idea: build X`. `note work: billing bug` routes to the work inbox and drops the prefix. The distinction matters when you're at the terminal at 9pm and don't want to think about it.

Content tags form a lightweight semantic layer:

| Prefix | Meaning |
|--------|---------|
| `idea:` | Something to build or try |
| `link:` | URL worth saving |
| `?` | Open question |
| `learn:` | Something to study |
| `ref:` | Reference or citation |
| `todo:` | Action item |
| `fix:` | Bug or issue to track |

The compiler later uses these prefixes to route entries to special wiki pages. `?` entries go to `wiki/open-questions.md`. `idea:` entries go to `wiki/ideas.md`.

## Compiling: the LLM as build step

After a few days of captures, or before a weekly review, I tell Claude or OpenCode:

```
compile the wiki from raw/
```

The compiler follows a deterministic process:

1. Read all `raw/YYYY-MM-DD.md` files newer than `wiki/.last_compiled` (or all files if the timestamp is missing).
2. Extract key concepts, decisions, tools, links, and questions.
3. For each concept without a `wiki/concepts/<slug>.md` yet: create it with frontmatter and a synthesis article.
4. For existing articles: append new information, update `last_compiled`.
5. Rebuild `wiki/INDEX.md` as a categorized table of contents.
6. Write a new timestamp to `wiki/.last_compiled`.

The frontmatter template is minimal but useful:

```yaml
---
title: Concept Name
sources:
  - raw/2026-05-09.md
related:
  - "[[related-concept]]"
last_compiled: 2026-06-27
---
```

The `sources` field is a provenance trail. You can always trace a compiled claim back to the raw entry that originated it. The `related` field uses `[[wikilinks]]` that Obsidian, Logseq, and most markdown tools resolve into graph links.

The critical rule: synthesize, don't dump. One clear paragraph per concept beats five bullets of raw text. If the LLM just transcribes raw notes into the wiki, the system adds no value. The instruction I give is explicit: produce prose articles, not transcriptions.

## The work namespace

Work knowledge is kept entirely separate. `raw/work/` compiles to `wiki/work/`, never to `wiki/concepts/`.

Work concepts — service names, API quirks, sprint decisions — don't belong mixed into general knowledge, and keeping them apart means I can share just `wiki/concepts/` if I ever open the wiki up, without leaking anything work-specific. The two also age at different rates: general concepts stay useful for years, while work knowledge can go stale in days.

The compiled work wiki currently tracks billing pipelines, custody integrations, KYC workflows, XML protocol schemas, brokerage order semantics, and a backlog of engineering tickets. All synthesized from daily captures.

## TIL: one insight per file

`til/` is the simplest part of the system. Each entry is a standalone markdown file, self-contained enough to share as a gist.

- Filename: `YYYY-MM-DD-short-slug.md` (or just `slug.md` for timeless entries)
- Title: `# TIL — <what was learned>`
- Body: the insight, why it matters, a code snippet if relevant. One screen max.

An example, `git-get-2nd-last-commit-message.md`:

```bash
git reflog -2 | sed 's/^.*: //' | tail -1 | xclip -r
```

Gets the second-to-last commit message and puts it in the clipboard. Useless to document in a long article. Perfect as a TIL.

The one-screen constraint is what makes TILs worth writing. If something doesn't fit in a screen, it's probably a wiki concept.

## Journal: reflection, not log

`journal/YYYY-MM-DD.md` is free-form daily reflection. Not a log of what I did. Retrospective task logs are boring to write and painful to read six months later.

Three prompts I use:

- What's interesting today?
- What am I thinking about?
- What's stuck?

These push toward insight rather than summary. A journal entry might be three sentences or three pages. It never gets compiled into the wiki. It stays human-written, for me only.

## The broader pipeline

The notes repo is one node in a larger system.

Wallabag acts as the central read-later store, fed by browser saves, HN upvotes via RSS, and interesting links from email. Articles are indexed via PageIndex for full-text search. A weekly digest script summarizes new Wallabag items and `raw/` entries from the past week via LLM, writing output to `wiki/weekly/YYYY-WNN.md`. This creates a searchable personal layer over everything read and captured. A half-remembered article from three months ago is findable via Wallabag; the insight extracted from it is findable in the wiki.

(Some of this is aspirational. The weekly digest script is a design goal, not yet running software. I'm being honest about that.)

## What it solves, and what it doesn't

The wiki stays a genuinely better read than the raw captures, because the LLM is synthesizing instead of dumping — noisy, context-heavy notes go in, and clean, cross-referenced articles come out.

Capture is as fast as it can be. A thought in five seconds as `note idea: build X` is worth more than a perfectly formatted note written twenty minutes later that never gets written at all.

The repo is the source of truth, not the tool. Obsidian, Logseq, VS Code, vim: anything that reads markdown works. The workflow doesn't depend on any of them.

What it doesn't do: task management. The `todo:` and `fix:` prefixes capture action items, but they compile to a flat wiki page, not a kanban board. I use a separate `todo.md` at the repo root for that.

It's also not spaced repetition. If you want to memorize things, Anki is still Anki. This system is for reference. Finding something you know you captured is different from drilling it until it sticks.

And the compile step isn't yet fully automated. I run it manually, which is fine. A cron job or git hook could change that.

## Getting started

The setup isn't complicated. The `note` function is a compact fish function — most of its length is a built-in `--help` block; the actual capture and routing logic is well under a hundred lines. The compile prompt fits in a sentence.

Start by capturing for a week with no wiki at all. Just `note` things as they occur to you, work and personal both. After a week, run the compile and read what comes back. That first wiki will be rough. Run it again after another week. It gets better.

The value compounds in a way that's hard to see at the start. After a few months, the wiki becomes a genuine external memory you can query, share, and extend without ever having manually organized it.

The insight isn't that LLMs are smart. It's that you finally have a build step for your notes.
