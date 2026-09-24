---
title: "The agentic development stack"
date: 2026-01-22
description: "How to wire up a multi-model, multi-agent AI environment: OpenCode, Claude Code, MCP servers, 90+ skills, and a three-tier agent pipeline, all managed declaratively."
part: 2
permalink: /blog/part-2-agentic-development-stack/
---

AI coding assistants are evolving from "chat in a sidebar" into autonomous agents that research, plan, and implement independently. But wiring up this ecosystem — multiple models, MCP servers, skill directories, custom agents — is still almost entirely manual. Every repo invents its own setup, and the config drifts across machines the exact way dotfiles used to.

If you can declare your desktop in Nix, you can declare your agent environment too.

## The agent stack architecture

```
┌─────────────────────────────────────────────────────┐
│                  Agent Orchestrator                  │
│         OpenCode (primary) + Claude Code (backup)    │
├─────────────────────────────────────────────────────┤
│                   MCP Servers                        │
│  webfetch-filter  │  git-restricted  │  Context7      │
│  graphify         │  PageIndex       │  (30+ more)    │
├─────────────────────────────────────────────────────┤
│                   Skill System                       │
│  93 skills across: superpowers · data-analytics ·    │
│  baoyu · work · personal · graphify · banana       │
├─────────────────────────────────────────────────────┤
│                 AI Model Providers                    │
│  DeepSeek V4 Flash  │  OpenRouter  │  Ollama (local)  │
├─────────────────────────────────────────────────────┤
│              Secrets Layer (sops-nix)                 │
│  context7_api_key  │  deepseek_api_key  │  openrouter  │
└─────────────────────────────────────────────────────┘
```

## Agent workflow: research, plan, implement

The most opinionated decision in this setup is the three-tier agent pipeline:

| Agent | Role | Access | Mentality |
|---|---|---|---|
| `@research` | Read-only explorer | web, docs, codebase | "What's out there?" |
| `@plan` | Synthesise + design | research output only | "What should we build?" |
| `@implement` | Write code | plan + specs only | "Let's build it" |

It's a deliberate constraint. Left unchecked, a single agent will hallucinate a plan, implement it, and hand you broken code with no audit trail. Splitting the workflow into distinct phases fixes that: research findings land as files in `~/.agent-work/research/`, plans in `~/.agent-work/plans/`, so you can always go back and inspect why a particular design was chosen. The plan agent can also reject a surface-level research pass and send it back for deeper investigation before anything gets implemented. And because research and implementation don't depend on each other in real time, one agent can be researching the next feature while another implements the current one.

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

The config lives in `~/.opencode/opencode.json`, a mutable symlink to `dotfiles/.opencode/opencode.json`. That's deliberate — tools like `graphify install` write into this file, so it has to stay mutable. The symlink just means those live edits still track in git.

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

API keys interpolate at runtime from environment variables, loaded via sops-nix — secrets stay encrypted at rest and get decrypted only at build time.

## The skill system

Skills are structured prompts that tell the AI how to approach a specific kind of task. This repo currently manages 93 of them, pulled from several sources:

| Source | Count | Managed by |
|---|---|---|
| superpowers-skills (obra) | ~40 | Nix store (`fetchFromGitHub`) |
| data-analytics-skills (nimrodfisher) | ~30 | Live git clone |
| baoyu/superpowers (skills CLI) | ~10 | `npx skills` + lockfile |
| work (private, employer-specific) | ~3 | Committed to dotfiles |
| Personal (banana, graphify, UI/UX) | ~5 | Committed to dotfiles |

### Skill deployment

Skills get deployed through three different mechanisms.

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

The Model Context Protocol is the connective tissue between agents and everything outside them. Each MCP server is just a process that exposes tools, resources, and prompts.

### webfetch-filter

A Python MCP server that fetches web content through a domain allowlist — no arbitrary HTTP requests, only pre-approved domains like docs sites, GitHub, and package registries. That's what blocks prompt injection via malicious URLs.

### git-restricted-mcp

A git MCP that blocks dangerous operations: `push`, `reset --hard`, `clean -fd`, `branch -D`, force-push, anything touching `main`. Agents can read the repo, create branches, commit, and open PRs, but they can't destroy history or merge without a human looking at it first.

### Context7 MCP

Resolves library IDs and queries up-to-date documentation for any framework — how agents get current API docs instead of relying on whatever was in their training data. It exposes two tools used in sequence: `resolve-library-id`, then `query-docs`.

### graphify

Generates codebase knowledge graphs. Feed it any input — code, docs, papers, images — and it produces a knowledge graph, clustered communities, and an HTML + JSON audit report. That output becomes shared context across the whole agent pipeline.

## Model diversity

Different agents use different models, chosen for their strengths:

| Model | Used by | Why |
|---|---|---|
| DeepSeek V4 Flash | research, implement, daily driver | Fast, large context, excellent code |
| Claude Sonnet 4 | plan | Superior nuanced reasoning |
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

The `continue.continue` extension gives IDE-integrated AI — completion, inline editing — without leaving the editor.

## What makes this declarative

Every piece of this agentic stack is declared in Nix and rebuilt atomically. New tool? Add it to `programs.nix`. New skill? Add a `home.file` entry in `ai-tools.nix`, or commit the skill locally. New MCP server? Add it to `opencode.json` and deploy the script via `home.file`. Wrong model? Change the provider config in `opencode.json` and run `home-manager switch`.

There's no "install this npm tool manually" step waiting to get forgotten on the next machine. The whole agent environment reproduces from a single config.

In [Part 3](/blog/part-3-security-posture/), we'll look at the security layer that protects this agentic environment: encrypted secrets, encrypted DNS, application firewalls, and zero-trust networking.
