---
title: "The agentic development stack"
date: 2026-01-22
description: "Wiring up OpenCode, Claude Code, MCP servers, agent skills and a research, plan, implement agent pipeline with Nix, so it rebuilds on any machine."
part: 2
permalink: /blog/part-2-agentic-development-stack/
---

AI coding assistants have moved from a chat sidebar to agents that research, plan, and implement on their own. Wiring up the pieces (models, MCP servers, skill directories, custom agents) is still manual. Every repo invents its own setup, and the config drifts across machines the way dotfiles used to.

This post builds on the flake from [Part 1](/blog/part-1-declarative-nixos-stack/). It describes the setup as of January 2026. Skill counts and file paths have changed since, and [Part 13](/blog/part-13-skills-consolidation/) covers the current layout.

If you can declare your desktop in Nix, you can declare your agent environment too.

## The agent stack architecture

<figure class="diagram">
<svg viewBox="0 0 880 320" role="img" aria-labelledby="agent-stack-title agent-stack-desc" xmlns="http://www.w3.org/2000/svg"><title id="agent-stack-title">Agentic development stack</title><desc id="agent-stack-desc">Five layers: agent orchestrator, MCP servers, skills, model providers and a sops-nix secrets layer.</desc><rect class="d-box" x="0" y="0" width="880" height="48" rx="6"/><text class="d-num" x="16" y="28">01</text><text class="d-name" x="64" y="28">Agent orchestrator</text><text class="d-sub" x="864" y="28" text-anchor="end">OpenCode (primary), Claude Code (backup)</text><rect class="d-box" x="0" y="56" width="880" height="72" rx="6"/><text class="d-num" x="16" y="96">02</text><text class="d-name" x="64" y="96">MCP servers</text><text class="d-sub" x="864" y="84" text-anchor="end">webfetch-filter, git-restricted, Context7</text><text class="d-sub" x="864" y="108" text-anchor="end">graphify, PageIndex, and more</text><rect class="d-box" x="0" y="136" width="880" height="72" rx="6"/><text class="d-num" x="16" y="176">03</text><text class="d-name" x="64" y="176">Skill system</text><text class="d-sub" x="864" y="164" text-anchor="end">93 skills (January 2026)</text><text class="d-sub" x="864" y="188" text-anchor="end">superpowers, data-analytics, baoyu, work, personal, banana</text><rect class="d-box" x="0" y="216" width="880" height="48" rx="6"/><text class="d-num" x="16" y="244">04</text><text class="d-name" x="64" y="244">Model providers</text><text class="d-sub" x="864" y="244" text-anchor="end">DeepSeek V4 Flash, OpenRouter, Ollama (local)</text><rect class="d-box" x="0" y="272" width="880" height="48" rx="6"/><text class="d-num" x="16" y="300">05</text><text class="d-name" x="64" y="300">Secrets layer</text><text class="d-sub" x="864" y="300" text-anchor="end">sops-nix: context7_api_key, deepseek_api_key, openrouter</text></svg>
<figcaption>The stack from orchestrator down to secrets. Skill count is as of January 2026.</figcaption>
</figure>

## Agent workflow: research, plan, implement

The most opinionated decision here is a three-tier agent pipeline:

| Agent | Role | Access | Mentality |
|---|---|---|---|
| `@research` | Read-only explorer | web, docs, codebase | "What's out there?" |
| `@plan` | Synthesise + design | research output only | "What should we build?" |
| `@implement` | Write code | plan + specs only | "Let's build it" |

The split is deliberate. A single agent left alone will invent a plan, implement it, and hand back broken code with no audit trail. Separate phases fix that: research findings land as files in `~/.agent-work/research/`, plans in `~/.agent-work/plans/`, so you can always go back and inspect why a particular design was chosen. The plan agent can also reject a surface-level research pass and send it back for deeper investigation before anything gets implemented. And because research and implementation don't depend on each other in real time, one agent can be researching the next feature while another implements the current one.

The agent workspace is structured for this:

```fish
~/.agent-work/
├── research/    # @research writes findings here
├── plans/       # @plan writes specs and implementation plans
├── specs/       # Shared specs between agents
└── status/      # @implement writes completion status
```

Fish abbreviations (`aw`, `awr`, `awp`, `awspec`, `awt`) and helper functions (`agent-status`, `agent-pipeline`, `agent-archive`) make the workspace navigable from the terminal.

## OpenCode configuration

The config lives in `~/.opencode/opencode.json`, a mutable symlink to `dotfiles/.opencode/opencode.json`. That is deliberate. Tools like `graphify install` write into this file, so it has to stay mutable. The symlink means those live edits still show up in git. This file is the one exception to "rebuilt atomically" below.

```jsonc
{
  "providers": {
    "deepseek": {
      "model": "deepseek/deepseek-v4-flash",
      "apiKey": "${DEEPSEEK_API_KEY}"
    },
    "openrouter": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "apiKey": "${OPENROUTER_API_KEY}"
    }
  },
  "agents": {
    "research": {
      "prompt": "~/.config/opencode/agents/research.md",
      "model": "deepseek"
    },
    "plan": {
      "prompt": "~/.config/opencode/agents/plan.md",
      "model": "openrouter"
    },
    "implement": {
      "prompt": "~/.config/opencode/agents/implement.md",
      "model": "deepseek"
    }
  },
  "mcpServers": {
    "context7": { },
    "webfetch-filter": { },
    "git-restricted": { },
    "graphify": { }
  }
}
```

API keys interpolate at runtime from environment variables, loaded via sops-nix, secrets stay encrypted at rest and sops-nix decrypts them when home-manager activates.

## The skill system

Skills are structured prompts that tell the AI how to approach a specific kind of task. In January this repo managed 93 of them, pulled from several sources. It now holds 156 `SKILL.md` files in a different layout (see Part 13):

| Source | Count | Managed by |
|---|---|---|
| superpowers-skills (obra) | ~40 | Nix store (`fetchFromGitHub`) |
| data-analytics-skills (nimrodfisher) | ~30 | Live git clone |
| baoyu/superpowers (skills CLI) | ~10 | `npx skills` + lockfile |
| work (private) | ~3 | Committed to dotfiles |
| Personal (banana, graphify, UI/UX) | ~5 | Committed to dotfiles |

### Skill deployment

Skills reach the machine through three mechanisms.

**1. Nix store (read-only).** Public GitHub repos get fetched at build time and symlinked into `~/.config/opencode/skills/`. Updating means changing the config and running `home-manager switch`.

```nix
home.file.".claude/skills" = {
  source = pkgs.fetchFromGitHub {
    owner = "obra";
    repo  = "superpowers-skills";
    rev   = "cdcd624ad3fd8026deb692e565351854569798dd";
    hash  = "sha256-6pR+GDkptgcuHGxPnusLCKToZNb394ZpitGc0Hq9LLI=";
  };
  recursive = true;
};
```

**2. Live git clone.** The data-analytics-skills repo is cloned directly, so a plain `git pull` keeps it current. The activation block only clones on first run, so any local changes survive.

**3. Skills CLI (npm).** The `skills` CLI tracks a lockfile of versioned skill packages in `~/.agents/.skill-lock.json`. Restoring them is just an activation step:

```nix
home.activation.installAgentSkills = lib.hm.dag.entryAfter [ "installNpmAiTools" ] ''
  if [ -f "$AGENTS_DIR/.skill-lock.json" ]; then
    ( cd "$AGENTS_DIR" && npx skills install )
  fi
'';
```

## MCP servers

> Update, as of 2026-10-16: the `git-restricted` server shown below was removed on 2026-10-15 (commit `8697dd5`) because it was never registered and it did not govern `bash`. Git rules now live in `dcg` policy, described in [the git policy post](/blog/declarative-git-policy-for-agents/). `webfetch-filter` is registered for the research agent as of 2026-10-16. The JSON above is a January snapshot.

The Model Context Protocol is the connective tissue between agents and everything outside them. Each MCP server is a process that exposes tools, resources, and prompts.

### webfetch-filter

A Python MCP server that fetches web content through a domain allowlist, it makes no arbitrary HTTP requests, only requests to pre-approved domains such as docs sites, GitHub, and package registries. This limits prompt injection through malicious URLs.

### git-restricted-mcp (removed 2026-10-15)

This server was never registered with OpenCode, so it did not run for any agent. Its description was: a git MCP that blocks dangerous operations: `push`, `reset --hard`, `clean -fd`, `branch -D`, force-push, anything touching `main`. Agents can read the repo, create branches, commit, and open PRs, but they can't destroy history or merge without a human looking at it first.

### Context7 MCP

Resolves library IDs and queries up-to-date documentation for any framework, how agents get current API docs instead of relying on whatever was in their training data. It exposes two tools used in sequence: `resolve-library-id`, then `query-docs`.

### graphify

Generates codebase knowledge graphs. Feed it any input, code, docs, papers, images, and it produces a knowledge graph, clustered communities, and an HTML + JSON audit report. That output becomes shared context across the whole agent pipeline.

## Model diversity

Each agent uses the model that suits its job:

| Model | Used by | Why |
|---|---|---|
| DeepSeek V4 Flash | research, implement, daily driver | Fast, large context, cheap per token |
| Claude Sonnet 4 | plan | Stronger at design tradeoffs |
| Ollama qwen3.5:4b | Walker LLM menu, private docs | Runs locally (4GB), no data leaves machine |

The `ai` devshell wraps local-model tooling:

```bash
nix develop ~/dotfiles/nix#ai
# → ollama, for one-off local inference (Walker LLM menu uses the system service instead)
```

## VSCodium with AI extensions

While OpenCode handles the agent side, VSCodium still covers the traditional editor experience:

```nix
programs.vscodium = {
  enable = true;
  profiles.default.extensions = with pkgs.vscode-extensions; [
    continue.continue
    golang.go
    ms-python.python
    redhat.java
    # ... 17 extensions from nixpkgs
  ];
};
```

The `continue.continue` extension gives IDE-integrated AI, completion, inline editing, without leaving the editor.

## What Nix manages here

Nearly all of this stack is declared in Nix and rebuilt atomically. `opencode.json` is the mutable exception. New tool? Add it to `programs.nix`. New skill? Add a `home.file` entry in the `ai-tools/` module (a single `ai-tools.nix` at the time), or commit the skill locally. New MCP server? Add it to `opencode.json` and deploy the script via `home.file`. Wrong model? Change the provider config in `opencode.json` and run `home-manager switch`.

No "install this npm tool manually" step is left to forget on the next machine.

[Part 3](/blog/part-3-security-posture/) covers the security layers around this environment: encrypted secrets, encrypted DNS, an application firewall, and Tailscale.
