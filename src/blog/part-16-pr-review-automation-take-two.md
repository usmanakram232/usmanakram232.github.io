---
title: "Automating PR review: stale reviews, a new engine, and a PATH bug"
date: 2026-09-19
description: "GitHub hides a review once new commits land. I replaced my hand-rolled OpenCode reviewer with ocr, handled stale reviews, and fixed an exit 127 bug."
part: 16
permalink: /blog/part-16-pr-review-automation-take-two/
---

GitHub stops offering to finish your review once someone pushes new commits, and it gives no warning. That broke my PR review automation on a real pull request on 2026-09-16, and fixing it led me to swap the review engine and fix a second bug in the same script.

`pr-review-check.sh` polls the work backend repo for pull requests where I am a requested reviewer. It began as a hand-rolled OpenCode JSON prompt that fetched the diff, stuffed it into a prompt, asked for structured findings, and posted them as a review. "Take two" refers to this rewrite of that first version.

## The bug: a review that vanished from the GitHub UI

I had reviewed the PR, and then more commits landed. My review was still attached, but GitHub's "Finish your review" button was gone. There was no error and no warning. The review's `commit_id` no longer matched the PR's current head, and GitHub responds by no longer showing the stale review as something to finish. I found the cause by reading the review object from the API and comparing `commit_id` against the PR's `head.sha` by hand.

The script now checks every review I have already left before it reviews. If a review's `commit_id` differs from the current head, the script deletes it and queues the PR for a fresh review. Otherwise a dead review stays attached, and neither the script nor the GitHub UI will show it again.

## Swapping the reviewer engine

Separately, on 2026-09-19 I compared `ocr` ([alibaba/open-code-review](https://github.com/alibaba/open-code-review), installed with `npm install -g @alibaba-group/open-code-review`) against my hand-rolled prompt. `ocr` won clearly. Its deterministic file selection and a dedicated line-positioning module reproduced the duplicate-test-coverage bug I had earlier root-caused by hand on that PR. It gave the right line numbers and also suggested a diff that my version never produced. Its configuration lives outside the repo in `~/.opencodereview/config.json`:

```bash
ocr config set provider bedrock
ocr config set model eu.anthropic.claude-sonnet-4-6
ocr config set providers.bedrock.aws_region region-1
ocr config set providers.bedrock.aws_profile <work-profile>
```

The script now runs `ocr review` on the PR's `base..head` range. That returns structured JSON findings, inline comments with correct line positions, and a one-click ` ```suggestion` ` block where `ocr` offers one. The script posts all of it as a single PENDING GitHub review, not a submitted one.

## Why the review stays PENDING

`ocr` is not flawless. It flagged a real, published GitHub Action tag as "non-existent" because the model's knowledge cutoff predates the tag. A model that is usually right but sometimes wrong about facts it cannot check needs a human to read its output before it becomes a real review on someone's PR. So the pipeline produces a draft that I finish and submit.

## The second bug: exit 127 outside the launchd wrapper

The script runs two ways, under a launchd agent on a schedule and by hand for testing. It only worked the first way. GNU `timeout` exists inside the launchd wrapper's Nix closure, because `nix/lib/work-scripts.nix` pulls in `pkgs.coreutils` there. It is not installed as a general home-manager package, so it is missing from my interactive shell `PATH`. Running the script by hand failed with exit 127, "command not found", and I did not notice until I tested the manual path on purpose. The fix checks for `timeout` and runs the review without it when it is missing, so the script behaves the same either way:

```bash
if command -v timeout >/dev/null 2>&1; then
  timeout "$REVIEW_TIMEOUT" "$OCR" review ...
else
  "$OCR" review ...   # no timeout available outside the launchd sandbox
fi
```

## What runs now

Every unreviewed or stale PR gets an `ocr review` pass and a PENDING review with inline comments. A single macOS notification lists everything reviewed in that run, so a batch of five PRs produces one interruption.

This is the same shape as the [Part 12](/blog/part-12-launchd-sh-mystery/) launchd debugging. A script that runs under launchd and by hand sees a different `PATH` each time, so I test both.
