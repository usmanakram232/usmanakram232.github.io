---
title: "66 loose directories and how I made them Nix's problem"
date: 2026-08-16
description: "An audit found 202 agent skill entries and only 4 managed by Nix. Here is how I moved 66 loose directories into the flake and fixed the skill enumerator."
part: 13
permalink: /blog/part-13-skills-consolidation/
---

I let agent skills pile up in `~/.agents/skills/` outside version control, and an August audit showed how bad it had got: wipe the laptop and most of them were gone. This post covers the fix, which was a stricter skill enumerator in Nix, a new `community` category, and a one-command `add_skill` function.

In [Part 2](/blog/part-2-agentic-development-stack/) I wrote that the setup managed 93 skills declaratively. That was January. The audit (`docs/audit/nix-and-skills-audit-2026-08.md`) found 202 entries in `~/.agents/skills/`:

| Kind | Count |
|---|---|
| Nix-store symlinks | 4 |
| Imperative symlinks planted by `add_skill`, `npx skills`, or a restore script | 116 |
| Real directories, untracked in git and absent from `catalog.yaml` | 82 |

The 116 symlinks worked but were declared nowhere. The 82 real directories had no restore path at all.

## How 82 unmanaged directories happen

No single decision caused it. Whenever an agent session needed a capability that did not exist yet, the fastest path was `git clone` straight into `~/.agents/skills/`. Sometimes I symlinked the clone into dotfiles later. Often the session ended and I never went back. After months of that, the live tree worked on one machine and reproduced nowhere else.

The audit also found five name collisions. `grill-me`, `handoff`, `tdd`, and two others existed both as a tracked dotfiles skill and as an unmanaged real directory. Whichever one home-manager or the filesystem resolved first won, and that differed per machine. The enumerator that builds the skill index also flattened sub-resource directories like `banana/references/` into top-level skills, so the router searched things nobody meant to invoke directly.

## Fixing the enumerator first

Before moving anything, `skillsFrom` in `nix/home/ai-tools/lib.nix` needed a stricter definition of "skill". The old version treated any directory as a candidate. The new version requires a `SKILL.md` at the directory root:

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

With that guard, `banana/references` and the four `cto-command-center` sub-skills stop showing up as top-level entries. The skills module now makes five `skillsFrom` calls: `work`, `personal`, `claude-code`, `design`, and the new `community`.

```nix
   // skillsFrom ".agents/skills" ../../skills/work
   // skillsFrom ".agents/skills" ../../skills/personal
   // skillsFrom ".agents/skills" ../../skills/claude-code
   // skillsFrom ".agents/skills" ../../skills/design
   // skillsFrom ".agents/skills" ../../skills/community;
```

The 66 real directories that survived the cleanup went into `community`.

## Moving the 66, deleting the rest

Once the enumerator was correct, the move was mechanical. I relocated 66 unmanaged directories into `skills/community/`, which is now Nix-owned like everything else. The other 16 real directories were deleted or folded into other skills. Nine of them were gitnexus skills. The gitnexus MCP server installs its own skills when it connects, so static copies only drifted from the real ones. Five were the name collisions, where the dotfiles-tracked `personal/` version was already the right one. The same commit removed 68 imperative symlinks and 8 sub-resource symlinks that the old enumerator had generated.

After that, `skills/` breaks into five categories plus a few multi-file entries (`banana`, `jasperreports`, `cto-command-center`) that do not fit the flat-directory pattern:

<table>
<thead><tr><th>Directory</th><th>Skills</th><th>What is in it</th></tr></thead>
<tbody>
<tr><td><code>skills/work/</code></td><td>19</td><td>Work-specific: custody API integration, secretsmanager patterns</td></tr>
<tr><td><code>skills/personal/</code></td><td>25</td><td>General productivity, original prompts</td></tr>
<tr><td><code>skills/claude-code/</code></td><td>19</td><td>Engineering skills such as <code>python-pro</code> and <code>security-reviewer</code></td></tr>
<tr><td><code>skills/design/</code></td><td>13</td><td>UI/UX, moved out of <code>~/.agents</code> in an earlier pass</td></tr>
<tr><td><code>skills/community/</code></td><td>66</td><td>Everything I had cloned and forgotten, now tracked</td></tr>
</tbody>
</table>

Those five categories hold 142 skills. Adding `banana` (1), `jasperreports` (1), and the four `cto-command-center` sub-skills gives 148 `SKILL.md` files, which is the count at the time of the move. The set has kept growing since. On 2026-09-30, `fd SKILL.md ~/dotfiles/skills | wc -l` reports 156. Every skill deploys flat into `~/.agents/skills/<name>/` regardless of category. The category is a dotfiles convention that an agent never sees.

## Merging the overlaps

Consolidating ownership exposed duplication that had been invisible while everything lived in separate unmanaged corners. I merged four skills into their closest sibling instead of keeping parallel, half-overlapping options: `java-architect` into `spring-boot-engineer`, `cloud-architect` into `devops-engineer`, `secure-code-guardian` into `security-reviewer`, and `product-engineering` into `planning-and-task-breakdown`. Each merge kept the reference files from the deleted skill (`aws-services.md`, `owasp-prevention.md`, and so on) under the surviving skill's `references/` directory. Nothing was lost, and the router has fewer competing entry points to choose between.

The same pass fixed `master-orchestrator`, which referenced six skill names that never existed on this machine. They were left over from an earlier orchestrator prompt that I copied forward without checking that the references still resolved.

`REGISTRY.md` records each of these decisions, so the next external skill that resembles something I already adopted does not get processed from scratch:

<table>
<thead><tr><th>Skill</th><th>Action</th><th>Source</th><th>Notes</th></tr></thead>
<tbody>
<tr><td><code>master-orchestrator</code></td><td>Merged</td><td><em>original prompt, v2</em></td><td>v1 was a thin V5 pipeline stub. v2 merged in a concrete spec with the <code>/daily-retro</code>, <code>/sprint-retro</code> and <code>/sprint-execute</code> commands. Legacy V5 primitives stay standalone-callable.</td></tr>
</tbody>
</table>

## The `add_skill` function

The manual process was to clone a GitHub skill repo, wire it into `~/.agents/skills`, add a Nix activation entry, register the decision in `REGISTRY.md`, and commit. It is exactly the kind of chore that gets skipped under deadline pressure, and that is how 82 directories accumulated. `add_skill` in `config/fish/functions.fish` collapses it into one command:

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

`add_skill metacircu1ar/audit` clones the repo, lists what it contains, wires each skill into the right place, and appends a `REGISTRY.md` entry. The 11 audit skills credited to that repo in the registry landed slightly earlier, through a one-off `home.activation.cloneAudit` block that clones the repo straight to `~/.agents/audit/skills`. `add_skill` arrived about ninety minutes later the same day as the general version of that idea. `--dry-run` shows the plan without touching anything. `--list` clones and inspects the repo without editing dotfiles, which helps when deciding whether a skill repo is worth adopting.

## What it cost

The work took four weeks and twelve commits that touched skills infrastructure, plus one 230-line audit document that did the thinking before I moved any file. The commits run from July 5th (the first `skills.json` and `mcps.json` inventory, and moving the design skills under Nix) through August 3rd (the 66-directory move and the enumerator fix). I needed no new tooling, only `home.file`, `readDir`, and a fish function. What was missing was an inventory that acts as the source of truth instead of a side effect of whatever a previous session cloned.

Any system where adding a thing is faster through a shortcut than through the declared path will collect shortcuts until an audit counts them. The fix was to make the declared path as fast as the shortcut, so there is no reason left to take the other one. [Part 11](/blog/part-11-fork-sync-architecture/) covers the same idea for the fork-sync pipeline.
