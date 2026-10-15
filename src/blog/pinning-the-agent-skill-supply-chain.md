---
title: "Pinning the agent skill supply chain"
date: 2026-09-30
description: "What a skill can do on my machine, how my catalog installs them, which installs are pinned, and why my pin script no longer pins anything."
part: 23
permalink: /blog/pinning-the-agent-skill-supply-chain/
---

A skill is a markdown file that tells an agent what to do, often with scripts next to it. The agent runs those steps with my permissions. I would never install a package without a lockfile, but for a long time I installed skills from GitHub with no record of which commit I got. This post covers how I track them now, and how much of that tracking is still fiction.

[Part 13](/blog/part-13-skills-consolidation/) counted 202 skills at consolidation time. The number today is different again, somewhere in the low 150s in my own dotfiles and well over double that across the full agent skills directory, most of the difference being symlinks into external sources. I haven't reconciled the two counts, so I'm treating them as separate facts rather than forcing them to agree.

## What a skill can do

The instructions in a skill are text, but the frontmatter can also grant tools. The public `playwright-skill` from `lackeyjb/playwright-skill` declares this in its frontmatter:

```
allowed-tools: Bash(node:*) Bash(npm:*) Read Write
```

Its setup step tells the agent to run `cd "$SKILL_DIR" && npm run setup`, which installs Playwright and Chromium, and the frontmatter says that needs network access. So installing this skill means the agent will run `npm` and `node` with arbitrary arguments on my behalf, and a later change to the repo changes what those commands do. I copied this skill into my dotfiles after adopting it, but the point holds for any skill: the text I review today is not the text I get after the next pull.

## The catalog

`skills/catalog.yaml` is the source of truth for external skill sources. Its header defines six install methods:

```
lockfile   tracked in ~/.agents/.skill-lock.json; restored via `npx skills install`
npx-add    installed via `npx skills add <repo>`
git-clone  cloned to ~/.agents/<dir>, skills symlinked to ~/.agents/skills/
dotfiles   committed to ~/dotfiles/skills/, deployed by home-manager switch
skip       evaluated, not worth adding
evaluate   promising but needs deeper review before adoption
```

A typical entry has a repo, a URL, a status, a note and a list of skills with a category and a one line description. `skills/REGISTRY.md` sits beside it and records the decision made for each source, so I do not re-evaluate the same repo twice.

I counted entries per section by matching `- repo:` lines and inline `{ name:` lines. The skill name count includes names under `skip`, so treat it as approximate.

<figure class="diagram">
<svg viewBox="0 0 880 320" role="img" aria-labelledby="skill-pin-title skill-pin-desc" xmlns="http://www.w3.org/2000/svg"><title id="skill-pin-title">Skill catalog, install method and pin status</title><desc id="skill-pin-desc">The catalog lists sources under four install methods. The lockfile method has 3 repos and no lockfile on this machine. The npx-add method has 20 repos and records no revision. The git-clone method has 10 repos and clones the default branch. The dotfiles method is pinned by a commit in my dotfiles repository.</desc><rect class="d-zone" x="0" y="0" width="880" height="320" rx="8"/><text class="d-tag" x="16" y="20">Install path for an external skill</text><rect class="d-box" x="24" y="120" width="170" height="70" rx="6"/><rect class="d-focal" x="24" y="120" width="170" height="70" rx="6"/><text class="d-name" x="40" y="148">catalog.yaml</text><text class="d-sub" x="40" y="170">skills/catalog.yaml</text><path class="d-arrow" d="M194 155 H242 V58 H290"/><path class="d-arrow" d="M194 155 H242 V128 H290"/><path class="d-arrow" d="M194 155 H242 V198 H290"/><path class="d-arrow" d="M194 155 H242 V268 H290"/><rect class="d-box" x="290" y="30" width="260" height="56" rx="6"/><text class="d-num" x="306" y="52">1</text><text class="d-name" x="326" y="52">lockfile</text><text class="d-sub" x="306" y="72">3 repos, 11 skill names</text><rect class="d-box" x="290" y="100" width="260" height="56" rx="6"/><text class="d-num" x="306" y="122">2</text><text class="d-name" x="326" y="122">npx-add</text><text class="d-sub" x="306" y="142">20 repos, 160 skill names</text><rect class="d-box" x="290" y="170" width="260" height="56" rx="6"/><text class="d-num" x="306" y="192">3</text><text class="d-name" x="326" y="192">git-clone</text><text class="d-sub" x="306" y="212">10 repos, 91 skill names</text><rect class="d-box" x="290" y="240" width="260" height="56" rx="6"/><text class="d-num" x="306" y="262">4</text><text class="d-name" x="326" y="262">dotfiles</text><text class="d-sub" x="306" y="282">copied into my repo</text><path class="d-arrow" d="M550 58 H640"/><path class="d-arrow" d="M550 128 H640"/><path class="d-arrow" d="M550 198 H640"/><path class="d-arrow" d="M550 268 H640"/><rect class="d-box" x="640" y="30" width="216" height="56" rx="6"/><text class="d-tag" x="656" y="62">Lockfile absent here</text><rect class="d-box" x="640" y="100" width="216" height="56" rx="6"/><text class="d-tag" x="656" y="132">No revision recorded</text><rect class="d-box" x="640" y="170" width="216" height="56" rx="6"/><text class="d-tag" x="656" y="202">Default branch, depth 1</text><rect class="d-box" x="640" y="240" width="216" height="56" rx="6"/><rect class="d-focal" x="640" y="240" width="216" height="56" rx="6"/><text class="d-tag" x="656" y="272">Pinned by my commit</text></svg>
<figcaption>Only the dotfiles path ends in something I can check out at a known revision.</figcaption>
</figure>

| Install method | Pinned to a revision | Count in catalog |
|---|---|---|
| lockfile | unknown, see below | 3 repos, 11 skill names |
| npx-add | no | 20 repos, 160 skill names |
| git-clone | no | 10 repos, 91 skill names |
| dotfiles | yes, by my own commit | 156 SKILL.md files under `skills/` |
| skip | not installed | 9 repos |
| evaluate | not installed | 14 repos |

The dotfiles count is the file count from the start of the post. It includes skills I wrote myself, and I am not listing those.

## What is pinned and what is not

Copying a skill into `~/dotfiles/skills/` is the only method that gives me a fixed revision, because my own Git history then holds the text. Home Manager deploys those files read-only from the Nix store, and `nix/home/ai-tools/lib.nix` builds the `home.file` entries by enumerating the skill directories.

The other methods track whatever the source serves. The catalog has no field for a commit, tag or hash. I searched it for `rev:`, `commit:`, `ref:` and `sha`, and the only hits were ordinary words such as "shared" and "share" inside descriptions. So the 20 npx-add repos and the 10 git-clone repos are unpinned, 30 of the 33 installable repos. For git-clone, the restore script runs `git clone --depth=1` on the URL, which takes the default branch tip, and tells me to run `git pull` if the directory already exists.

The lockfile method is supposed to be the pinned one. The catalog says `~/.agents/.skill-lock.json` tracks those skills. That file does not exist on this machine, so I cannot tell you what it records. I also did not open the `skills` CLI's source, so I do not know whether it stores commit hashes or only repo names.

## The pin script that no longer pins

`scripts/pin-skill-hashes.sh` fetches the current HEAD and Nix hash for two public repos, `obra/superpowers-skills` and `nimrodfisher/data-analytics-skills`, and prints a `rev` and `hash` to paste into `nix/home/ai-tools.nix`. That file is now the directory `nix/home/ai-tools/`. I ran `rg -n 'rev *=' nix/home/ai-tools` and it found nothing. There is no pinned revision anywhere in that directory.

The comment in `tools-and-skills.nix` still says "Revs are pinned" and points at the script. The code below that comment does something else for `data-analytics-skills`: an activation step runs `git clone` into `~/.agents/skills/` if the directory is missing, with the comment that it is a live clone so `git pull` works. So the script works as a tool, the comment describes a design I abandoned, and nothing consumes the output. I have not fixed either file. I did not find when the pin block was removed.

## Restore

`scripts/restore-agent-skills.sh` reads the catalog and rebuilds `~/.agents/skills/`. It takes `--dry-run`, which prefixes each command with `[dry-run]` instead of running it, and `--section lockfile`, `npx_add` or `git_clone`. It skips the dotfiles section because Home Manager owns it. If the lockfile is missing it prints a warning and skips `npx skills install`, which is the case here. I did not run it, because a dry run still touches `~/.agents` with `mkdir -p` before anything else, and I was asked not to change that directory.

## Review before install

The repo documents a decision record, not a review procedure. `REGISTRY.md` tells me to consult it before ingesting a skill, and each entry records adopted, adapted, merged or rejected with a reason. That stops repeat work. It does not say what I read in a skill before adopting it, and I have no written checklist for scripts or `allowed-tools`. I will not claim one.

## What I could not verify

- What `~/.agents/.skill-lock.json` records, since the file is absent and I did not read the CLI source.
- Why the count in Part 13 and the count today don't agree, and how the file count and the symlink count relate.
- When the Nix revision pins were removed.
- Whether any npx-add or git-clone skill has changed upstream since I installed it. I have no revision to compare against.
