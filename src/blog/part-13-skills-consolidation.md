---
title: "66 Loose Directories and How I Made Them Nix's Problem"
date: 2026-08-16
description: "Six months of git-clone-and-forget agent skills, an audit that found 202 entries and only 4 nix-managed, and the afternoon of merges and tooling that fixed it."
part: 13
permalink: /blog/part-13-skills-consolidation/
---

Back in Part 2 I wrote that this setup managed 93 agent skills, declaratively, via nix. That was January. By August, an audit of `~/.agents/skills/` found 202 entries. Of those, 4 were real nix-store symlinks. 116 were imperative symlinks planted by `add_skill`, `npx skills`, or a restore script. The other 82 were plain real directories — not tracked in git, not referenced in `catalog.yaml`, not reachable by any restore mechanism. Wipe the laptop and 82 skills are gone with it.

![66 loose skill directories consolidating into one nix-owned registry](/assets/img/skills-consolidation.png)

## How 82 unmanaged directories happen

None of it was one bad decision. Every time an agent session needed a capability that didn't exist yet, the fastest path was `git clone` straight into `~/.agents/skills/` and move on. Sometimes that clone got symlinked into dotfiles later. Sometimes it didn't, because the session ended and nobody circled back. Six months of that produces exactly this: a live tree that works fine on the one machine it grew on, and reproduces nowhere else.

The audit (`docs/audit/nix-and-skills-audit-2026-08.md`) also caught five name collisions — `grill-me`, `handoff`, `tdd`, and two others existed both as a tracked dotfiles skill and as an unmanaged real directory with the same name. Whichever one home-manager or the filesystem resolved first won, nondeterministically, per machine. And the enumerator that builds the skill index was flattening sub-resource directories like `banana/references/` into top-level "skills," polluting the router's search space with things that were never meant to be invoked directly.

## Fixing the enumerator first

Before moving anything, `skillsFrom` in `nix/home/ai-tools.nix` needed a stricter definition of "skill." The old version treated any directory as a skill candidate. The fix requires a `SKILL.md` at the directory root:

```nix
skillsFrom = dest: dir:
  let
    prose = [ "README.md" "HOWTO.md" "CHANGELOG.md" "LICENSE.md"
               "REGISTRY.md" "WORKFLOW.md" "catalog.yaml" ];
    # Only include a directory if it contains a SKILL.md at its root.
    # This prevents sub-resource dirs (e.g. banana/references/) from leaking
    # as spurious top-level skills.
    isSkill = name: type:
      (type == "directory" && builtins.pathExists (dir + "/${name}/SKILL.md")) ||
      (type == "regular"
        && lib.hasSuffix ".md" name
        && !(builtins.elem name prose));
    entries = lib.filterAttrs isSkill (builtins.readDir dir);
  in
  lib.mapAttrs' (name: type:
    lib.nameValuePair "${dest}/${name}" {
      source    = dir + "/${name}";
      recursive = type == "directory";
    }
  ) entries;
```

With that guard in place, `banana/references` and the four `cto-command-center` sub-skills stop showing up as top-level entries. The category comment inventory in the same file lists five `skillsFrom` calls now — `work`, `personal`, `claude-code`, `design`, and the new `community`:

```nix
   // skillsFrom ".agents/skills" ../../skills/work
   // skillsFrom ".agents/skills" ../../skills/personal
   // skillsFrom ".agents/skills" ../../skills/claude-code
   // skillsFrom ".agents/skills" ../../skills/design
   // skillsFrom ".agents/skills" ../../skills/community;
```

`community` is new. It's where the 66 real directories went.

## Moving the 66, deleting the rest

The move itself was mechanical once the enumerator was correct: 66 unmanaged directories relocated into `skills/community/`, which is now nix-owned like everything else. Nine gitnexus skills were deleted outright — the gitnexus MCP server auto-installs its own skills at connect time, so keeping static copies just meant two divergent versions drifting apart. The five collision directories were deleted too, since the dotfiles-tracked `personal/` version was already the authoritative one in every case. That commit also ripped out 68 imperative symlinks and 8 noisy sub-resource symlinks that the old enumerator had been generating.

After that, `skills/` breaks into five categories plus a handful of explicit multi-file entries (`banana`, `jasperreports`, `cto-command-center`) that don't fit the flat-directory pattern:

```
skills/
├── work/         19  work-specific (custody API integration, secretsmanager patterns)
├── personal/     25  general productivity, original prompts
├── claude-code/  19  engineering skills (python-pro, security-reviewer, ...)
├── design/       13  UI/UX, moved out of ~/.agents in an earlier pass
└── community/    66  everything git-clone-and-forgotten, now tracked
```

148 `SKILL.md` files under `skills/` in total, deployed flat into `~/.agents/skills/<name>/` regardless of which category directory they live in — the category is a dotfiles organizing convenience, not something an agent ever sees.

## Merging the overlaps

Consolidating ownership surfaced duplication that had been invisible while everything lived in separate unmanaged corners. Four skills got merged into their closest sibling rather than kept as parallel, half-overlapping options: `java-architect` folded into `spring-boot-engineer`, `cloud-architect` into `devops-engineer`, `secure-code-guardian` into `security-reviewer`, and `product-engineering` into `planning-and-task-breakdown`. Each merge kept the reference files from the deleted skill (`aws-services.md`, `owasp-prevention.md`, and so on) and rewired them under the surviving skill's `references/` directory — no content lost, just fewer competing entry points for the router to choose between.

That same pass fixed `master-orchestrator`, which had been referencing six skill names in its pipeline that had never existed on this machine — leftover from an earlier version of the orchestrator prompt that got copied forward without anyone checking the references still resolved.

`REGISTRY.md` tracks every one of these decisions so the next external skill that looks similar to something already adopted doesn't get re-processed from scratch:

```
| Skill Name | Action | Source | Notes |
|---|---|---|---|
| `master-orchestrator` | Merged | *(original prompt, v2)* | v1 was a thin V5
pipeline stub; v2 merged in a concrete spec with /daily-retro, /sprint-retro,
/sprint-execute commands. Legacy V5 primitives retained as standalone-callable. |
```

## The `add_skill` function

The manual process — clone a GitHub skill repo, wire it into `~/.agents/skills`, add a nix activation entry, register the decision in `REGISTRY.md`, commit — was exactly the kind of multi-step chore that gets skipped under deadline pressure, which is how 82 directories accumulated in the first place. `add_skill` in `config/fish/functions.fish` collapses that into one command:

```fish
function add_skill --description "Clone a GitHub skill repo and wire it into ~/.agents/skills"
    # ── arg parsing ──────────────────────────────────────────────────────────
    set -l url ""
    set -l override_name ""
    set -l list_only 0
    set -l dry_run 0
    # ...
    # ── normalise URL → org/repo ─────────────────────────────────────────────
    set url (string replace -r '\.git$' '' $url)
    set url (string replace -r 'https?://github\.com/' '' $url)
    set url (string replace -r 'github\.com/' '' $url)
    set url (string trim -c '/' $url)
    set -l parts (string split '/' $url)

    if test (count $parts) -lt 2
        echo "error: expected org/repo or https://github.com/org/repo" >&2
        return 1
    end
```

`add_skill metacircu1ar/audit` clones the repo, lists what it contains, wires each skill into the right place, and appends a `REGISTRY.md` entry — though the 11 audit skills actually credited to `metacircu1ar/audit` in the registry today landed slightly earlier via a different route, a one-off `home.activation.cloneAudit` block in `ai-tools.nix` that live-clones the repo straight to `~/.agents/audit/skills`. `add_skill` came online about ninety minutes later, on the same day, as the generalized version of that same idea. `--dry-run` shows the plan without touching anything; `--list` clones and inspects without editing dotfiles at all, useful for evaluating a skill repo before deciding whether it's worth adopting.

## What this actually cost

Four weeks, twelve commits directly touching skills infrastructure, one 230-line audit document that did the actual thinking before any file got moved. The commits span July 5th (the first `skills.json`/`mcps.json` inventory, and pulling `.agents/skills` design skills under nix) through August 3rd (the 66-directory move and the enumerator fix). Nothing here required new tooling I didn't already have — `home.file`, `readDir`, a fish function. The gap wasn't capability, it was that nobody had sat down and made the inventory the source of truth instead of a side effect of whatever a previous session happened to clone.

The lesson isn't about skills specifically. It's that any system where "add a thing" is faster via a shortcut than via the declared path will accumulate shortcuts, quietly, until an audit forces you to count them. The fix was never going to be discipline — it was making the declared path as fast as the shortcut, so there's no longer a reason to take the other one.
