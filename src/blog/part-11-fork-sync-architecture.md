---
title: "One Repo, Two Machines, Zero Copy-Paste"
date: 2026-08-16
description: "Turning a single-person nix-darwin flake into a shared config for two people: how 17 commits of hand-diverged fork drift got collapsed into one file per person, and the audit process that keeps it that way."
image: "/assets/img/fork-sync-architecture.jpg"
part: 11
permalink: /blog/part-11-fork-sync-architecture/
---

This repo started as one person's dotfiles. Then my wife wanted the same declarative macOS setup on her own machine, forked the repo, and started editing. Six weeks later, her fork had 17 commits of drift: hardcoded usernames, hand-deleted secret keys, a `git.nix` block that assumed everyone signs commits with my GPG key. Every upstream improvement I made had to be manually re-applied to files she'd already diverged from by necessity, not by choice.

![Shared flake feeding two per-person darwinConfigurations](/assets/img/fork-sync-architecture.jpg)

## The divergence-by-necessity problem

The failure mode wasn't carelessness. It was that the original files had no slot for "this value differs per person," so any difference had to go in as a direct edit. `nix/home/git.nix` hardcoded my name, email, and GPG signing fingerprint. Her fork's `dotfilesName` didn't match `dotfiles-mac` (her clone directory), so the `gitdir:~/dotfiles/` conditional include never matched anything, and she just deleted the whole signing block instead. `nix/home/default.nix` and `nix/home/mac-default.nix` had a hardcoded 10-key `sops.secrets` list; her encrypted `secrets/opencode.yaml` only had 3 of those keys, so activation failed until she hand-deleted `deepseek_api_key` and four MySQL keys from the module.

None of these were bugs in the traditional sense — every one was a correct fix for her machine, applied at the wrong layer, inside a file that both configs were supposed to share.

The fork audit that surfaced this (`docs/memory/2026-08-15-fork-audit-report.md`) diffed her fork against the merge-base and categorized 16 touched files into four buckets: adopt as-is, parametrize, personal-only, or needs verification. The interesting bucket was "parametrize": every item in it was a real per-person difference that had been hand-diverged into a file that should have stayed byte-identical across both forks.

## The fix: one file per person, nothing personal anywhere else

The rule that came out of this, stated plainly in `docs/FORK-SYNC.md`:

> Every time a file needs to differ between the two of us, the default instinct (hand-edit the file differently in each fork) creates permanent drift. Push every per-person difference into one file per person, keep every other `.nix` file byte-identical across both forks.

Concretely: `nix/personal/usman-mac.nix` and `nix/personal/bushra-mac.nix`. Each is a flat attrset, no logic, no conditionals, covering identity, machine settings, and now git signing and OpenCode model choices:

```nix
# nix/personal/usman-mac.nix
{
  username     = "usman";
  dotfilesName = "dotfiles";
  workName     = "acme";

  dockerRuntime  = "lima";          # "lima" | "colima" | "none"
  nextdnsProfile = "profile-a1b2c3";
  extraCasks     = [ "intellij-idea" ];

  gitUserName       = "wolfie";
  gitUserEmail      = "usman.akram@acme.example";
  gitSigningEnabled = true;
  gitSigningKey     = "REDACTED0000REDACTED0000REDACTED0000RED";

  sopsSecretNames = [
    "context7_api_key" "deepseek_api_key" "openrouter_api_key"
    "atlassian_mcp_token" "hf_token"
    "mysql_prod_user" "mysql_prod_password"
    "mysql_dev_user" "mysql_dev_password"
    "odysseus_admin_password"
  ];

  opencode.defaultModel = "amazon-bedrock/eu.anthropic.claude-sonnet-4-6";
  # ...
}
```

Her file has the same shape with different values, and where she hasn't provided a real value yet, an obvious placeholder instead of a silent wrong default:

```nix
# nix/personal/bushra-mac.nix
{
  username     = "bsadia";
  dotfilesName = "dotfiles-mac";
  workName     = "beta";

  dockerRuntime = "colima";

  # TODO: replace with your real name/email.
  gitUserName       = "CHANGE_ME_bushra";
  gitUserEmail      = "CHANGE_ME@example.com";
  gitSigningEnabled = false;
  gitSigningKey     = "";

  sopsSecretNames = [ "context7_api_key" "openrouter_api_key" "atlassian_mcp_token" ];
}
```

`flake.nix` imports both once and spreads the whole attrset into every `specialArgs`/`extraSpecialArgs` block that config needs:

```nix
usmanMac  = import ./personal/usman-mac.nix;
bushraMac = import ./personal/bushra-mac.nix;

darwinConfigurations.macbook = nix-darwin.lib.darwinSystem {
  specialArgs = { inherit inputs; } // usmanMac;
  modules = [ /* ... */
    { home-manager.extraSpecialArgs = { inherit inputs; } // usmanMac; }
  ];
};

darwinConfigurations.macbook-bushra = nix-darwin.lib.darwinSystem {
  specialArgs = { inherit inputs; } // bushraMac;
  modules = [ /* ... */
    { home-manager.extraSpecialArgs = { inherit inputs; } // bushraMac; }
  ];
};
```

That last part matters more than it looks. Before this, `flake.nix` had five separate inline attrsets per person, one per flake target (`nixosConfigurations.default`, two `homeConfigurations`, two `darwinConfigurations`), repeated with slightly different keys each time. Two commits (`0c2d1b6`, `fdb1407`) collapsed those five inline blocks into one-line spreads; the second commit alone deleted 31 lines of inline attrsets in exchange for 5 lines of `{ inherit inputs; } // usmanMac`-style spreads. Adding a new personal setting now touches exactly one file: your own.

## `sopsSecretNames`: the guard that makes a short list safe

The secrets list gets its own section because it's the one place where "just parametrize it" wasn't enough; the consuming modules had to change too. `mac-default.nix` used to declare a fixed 10-key `sops.secrets` block. sops-nix fails activation hard if a declared secret name isn't present in the decrypted file, which is exactly why Bushra's fork had to hand-delete keys she didn't have rather than just listing fewer of them.

The fix wired `sopsSecretNames` through as the actual source list, and made every optional consumer check for presence before using it:

```nix
# nix/home/opencode-agents.nix
optionalSecretEnvVars = [
  { name = "deepseek_api_key";   envVar = "DEEPSEEK_API_KEY"; }
  # ...one entry per optional secret
];

# Only emit an `if` block for secrets this person actually declared —
# skips cleanly instead of a nix eval "attribute missing" error.
secretEnvFishLines = lib.concatMapStrings (s:
  lib.optionalString (config.sops.secrets ? ${s.name}) ''
    if test -f ${config.sops.secrets.${s.name}.path}
      set -gx ${s.envVar} (string trim < ${config.sops.secrets.${s.name}.path})
    end
  ''
) optionalSecretEnvVars;
```

Now a three-key `sopsSecretNames` list and a ten-key one both activate cleanly — the difference is just which env vars get populated. Nobody has to hand-delete anything from a shared file again.

## The OpenCode config: from a static file to a generated one

A smaller but telling case: `~/.opencode/opencode.json` used to be a checked-in JSON file. Model choices, provider credentials structure, agent prompts, and MCP server definitions all lived in one file that both forks edited directly, which meant every model preference change was a merge conflict waiting to happen.

That file doesn't exist as a static artifact anymore. The shared parts (agent prompts, colors, permissions, provider skeletons, MCP structure) moved into `nix/lib/opencode-template.nix`. Only the actual per-person choices (`defaultModel`, which `providers` to include, `agentModels`, extra project `references`) live in each person's `nix/personal/*.nix` under an `opencode` key. `nix/home/ai-tools.nix` merges the two and writes `~/.opencode/opencode.json` at `darwin-rebuild switch` time. I verified the generated output was semantically identical to the old hand-maintained file with a Python deep-diff before deleting the static version: same values, different JSON key ordering, zero drift.

Her `opencode` block picks entirely different providers (`github-copilot` models only, no `amazon-bedrock`/`deepseek`/`mlx`) without touching a single shared line.

The commit history behind this — `f19fa08`, `0c2d1b6`, `fdb1407` — reads as three sequential passes at the same idea: notice a hardcoded personal value, move it into `nix/personal/*.nix`, repeat until nothing personal is left inline. That's a slower process than designing the abstraction up front would have been, but it's also the only way I found every instance — grepping for "usman" after the fact turned up cases the design pass would have missed.

## What stays deliberately unsynced

Not everything should be parametrized. `docs/FORK-SYNC.md` keeps an explicit list of files the sync tooling refuses to touch, ever:

- `.sops.yaml` and `secrets/*.yaml`: each machine has its own age key; there's no meaningful way to share these without sharing the private key.
- Each person's own `nix/personal/<name>-mac.nix`: upstream will keep improving the *other* person's file and the shared consumers; your own file is yours.
- AeroSpace workspace assignments and sketchybar icons: genuinely personal, not a config bug.
- One-off feature opt-ins like the `.NET SDK`, a `dab` fish function, and `ollama`: things only one of us uses, kept out of shared files entirely rather than gated behind a flag nobody else needs.

The distinction that matters: a setting is *parametrized* when both people need a version of it — git identity, secrets list, docker runtime. It's *personal-only* when only one person needs it at all, and forcing it into a shared file with a flag would just be complexity for the other person to ignore.

## `scripts/sync-fork.sh` and the audit direction that caught things

Pulling upstream changes into a fork is the easy direction. `scripts/sync-fork.sh` fetches, diffs from the real merge-base (not raw branch tips, which are mostly noise on a long-lived fork), and does a scoped `git checkout upstream/master -- <file>` for everything not on a hardcoded `PROTECTED` list:

```bash
PROTECTED=(
  ".sops.yaml"
  "secrets/opencode.yaml" "secrets/keys.yaml" "secrets/hermes.yaml"
  "nix/personal/${PERSONAL_FILE}"
  "scripts/sync-fork.sh"   # never self-overwrite mid-run
)
```

The harder direction — pulling her changes *into* upstream — is the one that actually surfaced the drift, because it's a real audit, not a merge. No push access to her fork, so it's `gh repo clone`, diff against the merge-base, and manually bucket every touched file into adopt / parametrize / personal-only / needs-verification.

That process is what found the `tealdeer` macOS cache path bug — `~/Library/Caches/tealdeer`, not `~/.cache/tealdeer`; her fork's fix was real, mine had silently been re-running `tldr --update` on every activation — the missing `lima` homebrew formula in her `extraBrews`, and a `nvim-jdtls` → `jdtls` nixvim rename that turned out to be tracking an actual upstream regression, not a personal preference. A blind three-way merge would have taken her `jdtls` rename or rejected it without ever asking why the option name had changed. The bucket-and-categorize step is what forces that question.

## The lesson

A shared config file with no per-person slot doesn't stay shared. It gets hand-edited into two diverging copies the first time someone hits a value that doesn't apply to them, and every future improvement to that file now has to be manually reapplied to the copy that already drifted. The fix isn't discipline or code review catching the drift after the fact; it's giving every per-person value exactly one legitimate home before anyone needs to make that first edit.
