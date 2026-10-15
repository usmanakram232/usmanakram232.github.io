---
title: "Blocking destructive commands before an agent runs them"
date: 2026-09-30
updated: 2026-10-15
description: "How a hook denylist and a local classifier screen coding agent shell commands, what each one missed when I tested them, and why I removed one."
part: 19
permalink: /blog/command-guards-for-coding-agents/
---

A coding agent runs shell commands with my permissions. If it decides a recursive delete on the wrong directory, or a force push to main, is the fix, the shell doesn't ask who wrote the command. This covers what I run to stop that, what I tested, and one layer I built and then took back out.

While drafting this post, my own tooling gave me an example unprompted. I'd put a loop of test strings into a single shell command, and the guard blocked the whole thing because one string, buried in the middle, contained a recursive delete of the root path. It scans the full text of a command, not just the first word. I hadn't expected that. Nothing ran.

## Why a prompt isn't a control

I have instructions telling agents not to do destructive things. Those are guidance, and a model can ignore or misread them. A real control sits outside the model and runs whether or not the model cooperates. For me that's a hook that runs before every tool call, in both agent runtimes I use.

## Layer one: a pattern denylist

The guard itself is a small third-party binary that matches commands against known-bad shapes. I didn't build it and haven't read its source, so what I can describe comes only from its own help output and from testing it directly. One agent runtime calls it through a settings hook; the other through a generated plugin that pipes the command to the binary and throws an error on a deny or ask verdict. Throwing stops the call before it runs.

Here's what it said for nine test strings, run without executing anything:

| Command | Verdict |
|---|---|
| `rm -rf /` | blocked |
| `rm -rf /tmp/x` | allowed |
| `git push --force origin main` | blocked |
| `sh -c "rm -rf ~/x"` | blocked |
| a base64-encoded recursive home-directory delete, piped into `sh` | blocked |
| `find . -delete` | blocked |
| `chmod -R 000 .` | allowed |
| `mv flake.nix flake.nix.disabled` | allowed |
| `cp -f /dev/null flake.lock` | allowed |

The last three rows are the interesting ones. Each can wreck a working tree, and none of them matches a known-bad shape.

## Layer two: a classifier I added and then removed

Those misses pushed me to try a second gate: a small local model that scores whether a command looks destructive instead of matching it against a list. I ran it against the four commands the denylist had missed:

| Command | Score |
|---|---|
| `chmod -R 000 ~/dotfiles` | 0.83 |
| `cp -f /dev/null flake.lock` | 0.64 |
| `mv flake.nix flake.nix.disabled` | 0.29 |
| `sd 'usman' 'nobody' *.nix` | 0.24 |

Only the first was a clean catch. I set two thresholds, block above 0.8 and warn above 0.55, because a single high cutoff would have caught nothing but that one case. The rename and the mass find-and-replace scored low with real confidence, which is a blind spot, not a sign of safety.

A later re-run of that same `chmod` command through the same model gave a different score than the first time. I don't know why. Maybe the model changed, maybe my phrasing drifted slightly between runs. Either way, a score that moves between identical runs can't be a threshold I trust, and I pulled the gate back out not long after.

## Guarding fetched content

Shell commands aren't the only way an agent gets steered. A fetched web page can carry instructions too. I added a sanitiser and a session-taint rule to the web-fetch path: when a fetched page trips a high-severity finding, the taint rule blocks side-effecting tools, writes, subagents, most shell commands, until my next real message. Read-only tools keep working.

I also tested the same small classifier as a prompt shield and as a critic of proposed tool calls, and rejected it for both roles. It caught more real attacks than a plain regex filter, but also flagged far more benign text as hostile, and as a critic it couldn't reliably tell an aligned tool call from a drifted one. Details are in [the restricted MCP servers post](/blog/restricted-mcp-servers-for-agents/).

I also removed a git-specific wrapper server I'd assumed was protecting the main branch. It wasn't registered anywhere agents could actually reach it, so removing it changed nothing real.

## Git rules on top of the guard

The pattern guard blocks a plain force push, but I hadn't checked whether it blocked an ordinary push straight to main. It didn't, and neither did any of the refspec tricks that land on main through a side door. So I wrote a custom rule set: it blocks any push whose destination is a protected branch, in every form I could think of, blocks force variants more broadly, and blocks a handful of transport-option tricks that let git run arbitrary programs. A test script checks every case against the actual generated config, not just my notes about it, and currently passes all of them. The full story, including a prefix-based allowlist that differs per person, is in [the post on declarative git policy](/blog/declarative-git-policy-for-agents/).

## The guard fails open

Both layers fail open. If the binary is missing, or its output doesn't parse, the command runs anyway and a warning goes to a log I might not be watching. I chose that tradeoff on purpose: a guard that blocks all work the moment it breaks is a guard I'd disable within a week out of frustration. The real cost is the flip side of that: if it breaks quietly, agents run unguarded and I might not notice for a while.

<figure class="diagram">
<svg viewBox="0 0 880 300" role="img" aria-labelledby="guard-flow-title guard-flow-desc" xmlns="http://www.w3.org/2000/svg"><title id="guard-flow-title">Command flow through the guard layers</title><desc id="guard-flow-desc">An agent shell tool call goes to a pre-execution hook that runs dcg. A deny or ask verdict throws an error and the command never runs. An allow verdict, or a dcg failure, lets the command run. A semantic classifier stage that sat beside dcg was removed.</desc><rect class="d-zone" x="0" y="0" width="880" height="300" rx="8"/><text class="d-tag" x="16" y="20">Host, before the shell runs</text><rect class="d-box" x="24" y="90" width="180" height="80" rx="6"/><text class="d-num" x="40" y="114">1</text><text class="d-name" x="40" y="138">Agent tool call</text><text class="d-sub" x="40" y="158">bash command string</text><path class="d-arrow" d="M204 130 H264"/><rect class="d-box" x="264" y="90" width="220" height="80" rx="6"/><rect class="d-focal" x="264" y="90" width="220" height="80" rx="6"/><text class="d-num" x="280" y="114">2</text><text class="d-name" x="280" y="138">Hook runs dcg</text><text class="d-sub" x="280" y="158">pattern rules, no model</text><path class="d-arrow" d="M484 110 H564 V60 H624"/><text class="d-tag" x="500" y="52">deny or ask</text><rect class="d-box" x="624" y="30" width="232" height="60" rx="6"/><text class="d-name" x="640" y="56">Error thrown</text><text class="d-sub" x="640" y="76">command never runs</text><path class="d-arrow" d="M484 150 H564 V210 H624"/><text class="d-tag" x="488" y="232">allow, or dcg failed</text><rect class="d-box" x="624" y="180" width="232" height="60" rx="6"/><text class="d-name" x="640" y="206">Command runs</text><text class="d-sub" x="640" y="226">with my permissions</text><rect class="d-zone" x="264" y="250" width="264" height="40" rx="6" style="stroke-dasharray:6 4"/><text class="d-sub" x="280" y="275">Classifier, removed later</text></svg>
<figcaption>Every shell command passes one deterministic check. A failure of the check itself allows the command.</figcaption>
</figure>

## What I'd trust

I trust the pattern denylist for the shapes it names. Force pushes and recursive deletes outside temp paths were blocked every way I tried to phrase them, including wrapped inside a shell-in-a-shell. It's cheap, needs no model, and gives the same answer every time.

I don't trust it for anything without a pattern. The permission change, the rename, and the file truncation all sailed through. I don't trust the classifier as a gate either. At the low end it called two genuinely damaging commands safe, and a score that moves between identical runs can't be a threshold.

Neither layer limits what a permitted command can actually reach. If an agent can write to a directory, no guard makes that safe on its own. That's a job for a sandbox with a narrow set of mounts, not a command filter.

## What's still unverified

Whether the taint rule holds up in a live, long-running session rather than the shimmed test I ran it under. Whether the git rules do anything in practice yet, since the config hasn't shipped to a running machine. And the thing underneath all of it: paraphrased attacks that match no pattern and trip no classifier threshold, which never get flagged at all.
