---
title: "A git policy for agents belongs in tested config"
date: 2026-10-15
description: "I thought a restricted git MCP server protected main. Reading it showed it never did, so I moved the rule into a tested, declarative dcg pack."
part: 25
permalink: /blog/declarative-git-policy-for-agents/
---

A policy that agents must obey should live in version-controlled, tested config. Telling an agent to use the guard is not a policy until a test shows that the dangerous command gets refused. This post is about a case where I believed I had a policy and did not.

## What I thought protected main

I had a small Python MCP server called `git-restricted` that exposed six git tools: checkout of a new branch, commit, push, status, log and diff. Its job, as I understood it, was to keep agents from pushing to `main`. Before I wrote more about it, I read the code and the live config. Four things were wrong.

1. It was not registered. The `mcp` keys in my OpenCode config did not include it, and my Nix template had no entry for it. Agent prompts described tools the agents did not have.
2. It never constrained `bash`. It governed calls to its own six tools only. The `implement` agent has `bash: allow`, so a raw `git push origin main` never passed through it.
3. Most of its config was dead. The list of blocked commands (`push --force`, `reset --hard` and others) was matched only inside the push handler, and the server had no merge or reset tool.
4. It had a bypass. A call with the branch set to `fix/x:main` passed the name check, because it starts with `fix/` and is not literally `main`, and ran `git push origin fix/x:main`.

I covered the earlier restricted-server idea in [the restricted MCP servers post](/blog/restricted-mcp-servers-for-agents/). The short version of this one is that a tool-level wrapper cannot govern a shell the agent can also reach.

## What the guard I already had allowed

I had already switched to `dcg` for destructive commands, described in [the command guards post](/blog/command-guards-for-coding-agents/). My next assumption was that `dcg` covered the git case. `dcg test --stdin` reports a verdict without running the command, so I tested it. I used dcg 0.14.1 with the live setup, which had no config file and the `core` and `system.disk` packs.

| Command | dcg before | Custom pack |
|---|---|---|
| `git push origin main` | allow | block |
| `git push origin HEAD:main` | allow | block |
| `git push origin fix/x:main` | allow | block |
| `git push origin --delete main` | allow | block |
| `git push --force-with-lease origin main` | allow | block |
| `git push --receive-pack=evil origin fix/x` | allow | block |
| `git -c core.sshCommand=evil push origin fix/x` | allow | block |
| `git push --force origin fix/x` | block | block |
| `git reset --hard` | block | block |
| `git merge main` | allow | allow |

The built-in rules already handled local destruction and a plain force push. They did not stop `git push origin main`, and they did not stop any refspec form that lands on `main`. Live `dcg` allowed every row that matters for the stated goal. The old MCP server had not protected `main` either, because the shell path went around it, so nothing regressed when I removed it. The goal was simply unmet.

## The fix has two parts

The first part is a shared pack, `config/dcg/packs/git-common.yaml`, loaded on every machine. It has three rules. `push-protected-branch` blocks any refspec whose destination is `main` or `master`. Its own comment says it applies to "HEAD:main, fix/x:main, refs/heads/main, :main, --delete main and force-with-lease alike", because the protection is on the destination. `push-force-without-lease` blocks `--force`, `--mirror` and `+refspec` forms. `git-transport-option-injection` blocks `--receive-pack`, `--upload-pack`, `--exec`, `ext::` URLs, `ProxyCommand` and a few `-c` settings that can run programs.

I allow `--force-with-lease` on a branch that is not protected. An agent that rebases its own feature branch needs it, and the lease checks the remote before it overwrites anything.

The second part is a branch-prefix rule that differs per person. In `nix/personal/usman-mac.nix` I have this list.

```nix
dcgBranchPrefixes = [ "fix" "feat" "feature" "refactor" "experiment" "docs" "chore" ];
```

I added `feature` after the rule denied a push in a repository whose branches all start with `feature/`. The rule was doing its job, and my list was incomplete, so the list changed and the rule did not. It is a per-person flag. A second user leaves it as an empty list, and the module then writes no prefix pack for that person. `nix/home/ai-tools/dcg.nix` turns the list into a regex alternation and generates `git-branch-prefix.yaml`, so the allowed prefixes are written once and the pack cannot drift from the list. The module writes `~/.config/dcg/config.toml` with the pack paths. The shared pack is copied from the repo, and the prefix pack exists only when the list is not empty. The generated file says in its description "Do not edit."

The generated rule allows only a push that names a remote and a branch starting with one of the prefixes. That makes the rule an allowlist in a tool that is mostly a denylist, so it denies bare `git push` and `git push origin HEAD`. The reason is a limit of the tool. `dcg` sees the command string and not the repository, so it cannot know which branch is checked out. If it allowed a bare push, the checked-out branch could be `main`. An agent has to name the branch, as in `git push -u origin fix/some-slug`. This changes agent behavior, and the denial message says what to type instead.

<figure class="diagram">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="gitpol-title gitpol-desc" xmlns="http://www.w3.org/2000/svg"><title id="gitpol-title">How the git policy reaches dcg</title><desc id="gitpol-desc">The per-person Nix list and the shared git-common pack feed generated dcg config. dcg then returns allow or deny for each command. A test script feeds commands to dcg test against that generated config as a side check.</desc><rect class="d-zone" x="0" y="0" width="880" height="290" rx="8"/><text class="d-tag" x="16" y="20">Built by home-manager, read by dcg</text><rect class="d-box" x="24" y="35" width="200" height="60" rx="6"/><text class="d-num" x="40" y="56">1</text><text class="d-name" x="40" y="74">dcgBranchPrefixes</text><text class="d-sub" x="40" y="88">per person flag</text><rect class="d-box" x="24" y="115" width="200" height="60" rx="6"/><text class="d-num" x="40" y="136">2</text><text class="d-name" x="40" y="154">git-common.yaml</text><text class="d-sub" x="40" y="168">shared, in the repo</text><path class="d-arrow" d="M224 65 H262 V105 H300"/><path class="d-arrow" d="M224 145 H262 V125 H300"/><rect class="d-box" x="300" y="70" width="220" height="90" rx="6"/><text class="d-num" x="316" y="92">3</text><text class="d-name" x="316" y="112">Generated config</text><text class="d-sub" x="316" y="132">config.toml + packs</text><text class="d-sub" x="316" y="148">prefix pack if list set</text><path class="d-arrow" d="M520 115 H570"/><rect class="d-box" x="570" y="70" width="130" height="90" rx="6"/><rect class="d-focal" x="570" y="70" width="130" height="90" rx="6"/><text class="d-num" x="586" y="92">4</text><text class="d-name" x="586" y="112">dcg</text><text class="d-sub" x="586" y="132">pattern match</text><path class="d-arrow" d="M700 115 H740"/><rect class="d-box" x="740" y="70" width="130" height="90" rx="6"/><text class="d-num" x="756" y="92">5</text><text class="d-name" x="756" y="112">Verdict</text><text class="d-sub" x="756" y="132">allow or deny</text><path class="d-arrow" d="M410 210 V160"/><rect class="d-box" x="300" y="210" width="300" height="60" rx="6" style="stroke-dasharray:6 4"/><text class="d-name" x="316" y="236">dcg-pack-test.py</text><text class="d-sub" x="316" y="256">dcg test --stdin, no execution</text><text class="d-tag" x="426" y="190">checks</text></svg>
<figcaption>The test script reads the built output, not the repo copy, so it checks what dcg will load.</figcaption>
</figure>

## The test script

`scripts/dcg-pack-test.py` runs each command through `dcg test --stdin` and compares the verdict to what I expect. It never executes the commands. It writes a temporary `DCG_CONFIG` that points at the packs under test, so it does not touch my real config.

Run with no arguments, it tests the repo copy of the shared pack. Given `--hm-files` with the `home-manager-files` store path from a `darwin-rebuild build`, it tests the packs that home-manager generated. I prefer the second form, because it checks the file `dcg` will load, including the generated prefix pack.

The cases include benign commands that must pass, such as `rg 'git push origin main' docs`, because a guard that fires on quoted text gets turned off. The blocked cases cover each refspec form, `+refspec`, `--mirror`, the transport options, and a chained `git push origin fix/x && git push origin main`.

For my config it reports 41 of 41 cases as expected. The script exits with a non-zero code on any mismatch, so I can use it as a check after editing a pack.

## The fail-open caveat

`dcg` loads a broken custom pack fail-open. It prints a warning and skips the pack. That means a typo in a regex does not produce an error that stops my work. It produces a machine with no git policy, and the only sign is a warning line.

This is why the test matters. The script starts by running `dcg pack validate` on each pack and prints the result. Then the verdict cases show whether the rules fire. I re-run it after any pack edit, and I read the validate lines first.

## What I would trust

I trust the shared pack for the shapes it names, since the test covers each of them and I can see the rule name in the output for each block. I trust the prefix rule less, because it relies on agents reacting well to a denial. A denied bare push should lead an agent to name the branch, and I have only seen that in the test script, not in real sessions.

## What I could not verify

- I have not run a live OpenCode or Claude Code session after `darwin-rebuild switch`. The 41 of 41 result comes from the build output and the test script.
- I do not know how the branch-prefix rule behaves under real agents. A denial message may not lead to a working retry every time.
- `gh pr create` and `gh pr merge` are still prompt-only. A one-line custom pack rule would cover them, and I have not written it.
