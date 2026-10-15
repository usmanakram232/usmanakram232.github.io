---
title: "One flake, two people: moving per-user config into one file each"
date: 2026-08-16
description: "How 17 commits of fork drift collapsed into one nix/personal file per person, and the audit process that keeps a shared nix-darwin flake shared."
image: "/assets/img/fork-sync-architecture.jpg"
part: 11
permalink: /blog/part-11-fork-sync-architecture/
---

This repo started as one person's dotfiles. Then a friend wanted the same declarative macOS setup on their own machine, forked the repo, and started editing. Names in this post are changed: I call them "the second user", and the fork's config file is `friend-mac.nix` here. Six weeks later the fork had 17 commits of drift: hardcoded usernames, hand-deleted secret keys, and a `git.nix` block that assumed everyone signs commits with my GPG key. Each upstream improvement I made had to be re-applied by hand to files the fork had already diverged from, and the divergence came from need, not choice.

![Shared flake feeding two per-person darwinConfigurations](/assets/img/fork-sync-architecture.jpg)

## The divergence-by-necessity problem

Carelessness did not cause this. The original files had no slot for "this value differs per person", so any difference had to go in as a direct edit. `nix/home/git.nix` hardcoded my name, email, and GPG signing fingerprint. The fork's `dotfilesName` did not match `dotfiles-mac` (the clone directory), so the `gitdir:~/dotfiles/` conditional include never matched, and the second user deleted the whole signing block. `nix/home/default.nix` and `nix/home/mac-default.nix` had a hardcoded 10-key `sops.secrets` list, but the fork's encrypted `secrets/opencode.yaml` had only 3 of those keys. Activation failed until they hand-deleted `deepseek_api_key` and four MySQL keys from the module.

None of these were bugs in the usual sense. Each was a correct fix for one machine, applied in a file that both configs were supposed to share.

The fork audit that found this (`docs/memory/2026-08-15-fork-audit-report.md`) diffed the fork against the merge-base and sorted 16 touched files into four buckets: adopt as-is, parametrize, personal-only, or needs verification. The "parametrize" bucket mattered most. Every item in it was a real per-person difference that had been edited into a file that should have stayed byte-identical in both forks.

## The fix: one file per person, nothing personal anywhere else

The rule that came out of this, in `docs/FORK-SYNC.md`:

> Every time a file needs to differ between the two of us, the default instinct (hand-edit the file differently in each fork) creates permanent drift. Push every per-person difference into one file per person, keep every other `.nix` file byte-identical across both forks.

That gives `nix/personal/usman-mac.nix` and one file for the second user, called `friend-mac.nix` in this post. Each is a flat attrset with no logic and no conditionals. It covers identity, machine settings, git signing, and OpenCode model choices:

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

The second user's file has the same shape with different values. Where they have not supplied a real value yet, it holds an obvious placeholder instead of a wrong default:

```nix
# nix/personal/friend-mac.nix
{
  username     = "friend";
  dotfilesName = "dotfiles-mac";
  workName     = "beta";

  dockerRuntime = "colima";

  # TODO: replace with your real name/email.
  gitUserName       = "CHANGE_ME_friend";
  gitUserEmail      = "CHANGE_ME@example.com";
  gitSigningEnabled = false;
  gitSigningKey     = null;

  sopsSecretNames = [ "context7_api_key" "openrouter_api_key" "atlassian_mcp_token" ];
}
```

`flake.nix` imports both files once and spreads the whole attrset into every `specialArgs` and `extraSpecialArgs` block that needs it:

```nix
usmanMac   = import ./personal/usman-mac.nix;
friendMac  = import ./personal/friend-mac.nix;

darwinConfigurations.macbook = nix-darwin.lib.darwinSystem {
  specialArgs = { inherit inputs; } // usmanMac;
  modules = [ /* ... */
    { home-manager.extraSpecialArgs = { inherit inputs; } // usmanMac; }
  ];
};

darwinConfigurations.macbook-friend = nix-darwin.lib.darwinSystem {
  specialArgs = { inherit inputs; } // friendMac;
  modules = [ /* ... */
    { home-manager.extraSpecialArgs = { inherit inputs; } // friendMac; }
  ];
};
```

The spread matters more than it looks. Before it, `flake.nix` held five separate inline attrsets per person, one for each flake target (`nixosConfigurations.default`, two `homeConfigurations`, two `darwinConfigurations`), each with slightly different keys. Two commits replaced those five blocks with one-line spreads, and the second deleted 31 lines of inline attrsets in exchange for 5 lines of `{ inherit inputs; } // usmanMac`. Adding a personal setting now touches one file, your own.

## `sopsSecretNames`: the guard that makes a short list safe

The secrets list needed more than parametrizing, because the consuming modules had to change too. `mac-default.nix` used to declare a fixed 10-key `sops.secrets` block. sops-nix fails activation if a declared secret is missing from the decrypted file. That is why the second user had to hand-delete keys instead of listing fewer of them.

The fix uses `sopsSecretNames` as the source list, and every optional consumer checks that its secret exists before using it:

```nix
# nix/home/opencode-agents.nix
optionalSecretEnvVars = [
  { name = "deepseek_api_key";   envVar = "DEEPSEEK_API_KEY"; }
  # ...one entry per optional secret
];

# Only emit an `if` block for secrets this person declared.
# A missing secret is skipped instead of raising a nix eval error.
secretEnvFishLines = lib.concatMapStrings (s:
  lib.optionalString (config.sops.secrets ? ${s.name}) ''
    if test -f ${config.sops.secrets.${s.name}.path}
      set -gx ${s.envVar} (string trim < ${config.sops.secrets.${s.name}.path})
    end
  ''
) optionalSecretEnvVars;
```

A three-key list and a ten-key list both activate cleanly now. They differ only in which environment variables get set, and nobody edits the shared file.

## The OpenCode config: from a static file to a generated one

`~/.opencode/opencode.json` used to be a checked-in JSON file. Model choices, provider credential structure, agent prompts, and MCP server definitions all lived in that one file, and both forks edited it directly. Every model change risked a merge conflict.

That file no longer exists as a static artifact. The shared parts (agent prompts, colors, permissions, provider skeletons, MCP structure) moved to `nix/lib/opencode-template.nix`. The per-person choices (`defaultModel`, which `providers` to include, `agentModels`, extra project `references`) live in each person's `nix/personal/*.nix` under an `opencode` key. `nix/home/ai-tools/opencode.nix` merges the two and writes `~/.opencode/opencode.json` at `darwin-rebuild switch` time. Before deleting the static version, I compared the generated output with the old file using a Python deep diff. The values matched, and only the JSON key order differed.

The second user's `opencode` block picks different providers (`github-copilot` models only, no `amazon-bedrock`, `deepseek`, or `mlx`) without touching a shared line.

I did this in three passes: notice a hardcoded personal value, move it into `nix/personal/*.nix`, repeat until nothing personal is left inline. Designing the abstraction up front would have been faster, but the passes found every instance. Grepping for my username afterward turned up cases a design pass would have missed.

## What stays deliberately unsynced

Not everything should be parametrized. `docs/FORK-SYNC.md` lists files that the sync tooling never touches:

- `.sops.yaml` and `secrets/*.yaml`. Each machine has its own age key, and sharing these would mean sharing the private key.
- Each person's own `nix/personal/<name>-mac.nix`. Upstream keeps improving the other person's file and the shared consumers, and your own file is yours.
- AeroSpace workspace assignments and sketchybar icons. These are personal preference, not config bugs.
- One-off opt-ins such as the .NET SDK, a `dab` fish function, and `ollama`. Only one of us uses them, so they stay out of shared files instead of sitting behind a flag nobody else needs.

A setting is parametrized when both people need their own version of it, like git identity, the secrets list, or the docker runtime. A setting is personal-only when one person needs it at all. Forcing a personal-only setting into a shared file behind a flag only adds complexity for the other person.

## `scripts/sync-fork.sh` and the audit direction that caught things

Pulling upstream changes into a fork is the easy direction. `scripts/sync-fork.sh` fetches, diffs from the merge-base (raw branch tips are mostly noise on a long-lived fork), and runs a scoped `git checkout upstream/master -- <file>` for everything not on a hardcoded `PROTECTED` list:

```bash
PROTECTED=(
  ".sops.yaml"
  "secrets/opencode.yaml" "secrets/keys.yaml" "secrets/hermes.yaml"
  "nix/personal/${PERSONAL_FILE}"
  "scripts/sync-fork.sh"   # never self-overwrite mid-run
)
```

The harder direction, pulling the fork's changes into upstream, is the one that surfaced the drift, because it is an audit and not a merge. I have no push access to the fork. I run `gh repo clone`, diff against the merge-base, and sort every touched file into adopt, parametrize, personal-only, or needs-verification.

That process found three things. The `tealdeer` cache path on macOS is `~/Library/Caches/tealdeer`, not `~/.cache/tealdeer`. The fork's fix was right, and my activation step from [Part 9](/blog/part-9-production-pass/) re-ran `tldr --update` on every activation. The fork's `extraBrews` also included the `lima` Homebrew formula, which mine lacked. Finally, a `nvim-jdtls` to `jdtls` nixvim rename tracked a real upstream change, not a personal preference. A blind three-way merge would have accepted or rejected that rename without asking why the option name changed. The sorting step forces the question.

## The lesson

A shared config file with no per-person slot does not stay shared. The first time someone hits a value that does not apply to them, they edit it, and the file splits into two copies. Give every per-person value one legitimate home before anyone needs to make that first edit. The same one-home rule shaped how I later moved agent skills into the flake in [Part 13](/blog/part-13-skills-consolidation/).
