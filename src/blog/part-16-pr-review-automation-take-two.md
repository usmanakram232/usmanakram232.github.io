---
title: "Automating PR Review, Take Two"
date: 2026-09-19
description: "Replacing a hand-rolled OpenCode JSON-prompt PR reviewer with ocr (alibaba/open-code-review), root-causing why GitHub silently drops stale reviews, and why the result stays a PENDING draft instead of an auto-submit."
part: 16
permalink: /blog/part-16-pr-review-automation-take-two/
---

`pr-review-check.sh` polls the work backend repo for pull requests where I'm a requested reviewer, and it's existed for a while as a hand-rolled OpenCode JSON prompt: fetch the diff, stuff it into a prompt, ask for structured findings back, post them as a review. It worked, in the sense that it produced reviews. It didn't work in the sense that mattered on 2026-09-16, on a real PR.

## The bug: a review that vanished from the GitHub UI

I'd reviewed the PR, then it got more commits pushed. My existing review was still attached, but GitHub's "Finish your review" affordance had silently stopped rendering — not an error, not a warning, just absent. The review's `commit_id` no longer matched the PR's current head, and GitHub doesn't tell you that in the UI; it just stops surfacing the stale review as something to finish. Root-causing this took reading the API response for the review object and comparing `commit_id` against the PR's current `head.sha` by hand.

The fix in the script: before reviewing, check every review I've already left. If its `commit_id` doesn't match the PR's current head, treat it as stale — delete it and re-queue the PR for a fresh review rather than leaving a dead review object attached that neither the script nor GitHub's UI will surface again.

## Swapping the reviewer engine

Separately from that bug, I evaluated `ocr` (alibaba/open-code-review, `npm install -g @alibaba-group/open-code-review`) against the hand-rolled prompt approach on 2026-09-19, and it won outright: `ocr`'s deterministic file-selection plus a dedicated line-positioning module independently reproduced the exact duplicate-test-coverage bug that had previously been root-caused by hand on that PR — same bug, correct line numbers, plus a bonus suggested diff the hand-rolled version never produced. Configuration lives outside the repo, at `~/.opencodereview/config.json`:

```bash
ocr config set provider bedrock
ocr config set model eu.anthropic.claude-sonnet-4-6
ocr config set providers.bedrock.aws_region eu-central-1
ocr config set providers.bedrock.aws_profile work-dev
```

The script now shells out to `ocr review` against the PR's `base..head` range for structured JSON findings, real line-anchored inline comments with correct positions, and — where `ocr` provides one — a one-click-apply ` ```suggestion` ` block. Those get posted as a single PENDING GitHub review, not a submitted one.

## Why PENDING, not auto-submit

`ocr` is not flawless. Verified false positive: it flagged a real, already-published GitHub Action tag as "non-existent," because the model's knowledge cutoff predates the tag. That's exactly the failure mode that makes a fully autonomous review pipeline the wrong shape here — a model that's usually right and occasionally wrong about things it has no way to check needs a human reading the output before it becomes a real review on someone's PR. The pipeline stays a draft that I finish and submit, not a bot that posts directly.

## A quieter bug: exit 127 outside the launchd wrapper

The script is meant to run two ways — under a launchd agent on a schedule, and by hand for testing (`bash ~/dotfiles/scripts/pr-review-check.sh`). It only worked correctly the first way. GNU `timeout` exists inside the launchd wrapper's Nix closure (`nix/lib/work-scripts.nix` pulls in `pkgs.coreutils` there), but it is *not* installed as a general home-manager package — so it's absent from the interactive shell `PATH` and from any manual invocation. Running the script by hand failed with exit 127, the classic "command not found from a script that assumed it would be," and it failed silently enough that I didn't notice until I deliberately tested the manual path. The fix detects whether `timeout` is actually available and falls back to running the review without a timeout wrapper rather than hard-failing, so the script behaves the same whether launchd invokes it or I do:

```bash
if command -v timeout >/dev/null 2>&1; then
  timeout "$REVIEW_TIMEOUT" "$OCR" review ...
else
  "$OCR" review ...   # no timeout available outside the launchd sandbox
fi
```

## What ships now

Every unreviewed or stale PR gets an `ocr review` pass, a PENDING review with inline comments, and a single macOS desktop notification listing everything that was reviewed in that pass — one notification per run, not one per PR, so a batch of five doesn't turn into five interruptions.

This is the same shape as Part 12's launchd debugging: a script that behaves differently depending on how it's invoked, and the fix is making that difference explicit instead of hoping it never surfaces. The recurring lesson across both is that anything meant to run under launchd needs to be tested by hand too, because the two environments don't share a `PATH` and won't fail the same way.
