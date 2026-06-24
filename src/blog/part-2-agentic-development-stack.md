---
title: "The agentic development stack"
date: 2026-01-22
description: "How to wire up a multi-model, multi-agent AI environment: OpenCode, Claude Code, MCP servers, 90+ skills, and a three-tier agent pipeline, all managed declaratively."
part: 2
permalink: /blog/part-2-agentic-development-stack/
---

AI coding assistants are evolving from "chat in a sidebar" to autonomous agents that can research, plan, and implement independently. But wiring up this ecosystem — multiple models, MCP servers, skill directories, custom agents — is still overwhelmingly manual. Every repo invents its own setup, and the config drifts across machines the same way dotfiles used to.

The premise: if you can declare your desktop in Nix, you can declare your agent environment too.

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
│  baoyu · ginmon · personal · graphify · banana       │
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

This is a deliberate constraint. Left unchecked, a single agent will hallucinate a plan, implement it, and leave you with broken code and no audit trail. Forcing the workflow through distinct phases gives you:

1. **Traceability.** Research findings are files in `~/.agent-work/research/`. Plans are in `~/.agent-work/plans/`. You can inspect why a particular design was chosen.
2. **Quality gates.** The plan agent can reject a surface-level research pass and ask for deeper investigation before moving to implementation.
3. **Parallelism.** Research and implementation are independent. You can have one agent researching the next feature while another implements the current one.

The agent workspace is structured for this:

```fish
~/.agent-work/
├── research/    # @research writes findings here
├── plans/       # @plan writes specs and implementation plans
├── specs/       # Shared specs between agents
└── status/      # @implement writes completion status
```

Fish abbreviations (`aw`, `awr`, `awp`, `aws`, `awt`) and helper functions (`agent-status`, `agent-pipeline`, `agent-archive`) make the workspace navigable from the terminal.

## OpenCode configuration

The config lives in `~/.opencode/opencode.json`, which is a mutable symlink to `dotfiles/.opencode/opencode.json`. This is deliberate: tools like `graphify install` write into this file, so it must be mutable. The symlink means live edits track in git.

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

API keys are interpolated at runtime from environment variables, loaded via sops-nix — encrypted secrets decrypted at build time.

## The skill system

Skills are structured prompts that tell the AI how to approach specific tasks. This repo manages 93 skills across multiple sources:

| Source | Count | Managed by |
|---|---|---|
| superpowers-skills (obra) | ~40 | Nix store (`fetchFromGitHub`) |
| data-analytics-skills (nimrodfisher) | ~30 | Live git clone |
| baoyu/superpowers (skills CLI) | ~10 | `npx skills` + lockfile |
| ginmon (private work) | ~3 | Committed to dotfiles |
| Personal (banana, graphify, UI/UX) | ~5 | Committed to dotfiles |

### Skill deployment

Skills are deployed through three mechanisms.

**1. Nix store (read-only).** Public GitHub repos are fetched at build time and symlinked into `~/.config/opencode/skills/`. Updates require a config change and `home-manager switch`.

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

**2. Live git clone.** The data-analytics-skills repo is cloned directly so `git pull` keeps it current. The activation block only clones on first run, preserving any local changes.

**3. Skills CLI (npm).** The `skills` CLI manages a lockfile of version-tracked skill packages in `~/.agents/.skill-lock.json`. Restoring them is an activation step:

```nix
home.activation.installAgentSkills = lib.hm.dag.entryAfter [ "installNpmAiTools" ] ''
  if [ -f "$AGENTS_DIR/.skill-lock.json" ]; then
    ( cd "$AGENTS_DIR" && npx skills experimental_install )
  fi
'';
```

## MCP servers

The Model Context Protocol is the connective tissue between agents and external systems. Each MCP server is a process that exposes tools, resources, and prompts.

### webfetch-filter

A Python MCP server that fetches web content through a domain allowlist. No arbitrary HTTP requests — only pre-approved domains (docs, GitHub, package registries). This blocks prompt injection via malicious URLs.

### git-restricted-mcp

A git MCP that blocks dangerous operations: `push`, `reset --hard`, `clean -fd`, `branch -D`, force-push, and anything touching `main`. Agents can read the repo, create branches, commit, and open PRs, but they cannot destroy history or merge without human review.

### Context7 MCP

Resolves library IDs and queries up-to-date documentation for any framework. This is how agents get current API docs without being trained on stale data. The `context7-mcp` skill describes the exact workflow: `resolve-library-id` then `query-docs`.

### graphify

Generates codebase knowledge graphs. Given any input (code, docs, papers, images), it produces a knowledge graph, clustered communities, and an HTML + JSON audit report. The output serves as shared context across the agent pipeline.

## Model diversity

Different agents use different models, chosen for their strengths:

| Model | Used by | Why |
|---|---|---|
| DeepSeek V4 Flash | research, implement, daily driver | Fast, large context, excellent code |
| Claude Sonnet 4 | plan | Superior nuanced reasoning |
| Ollama qwen3.5:4b | Walker LLM menu, private docs | Runs locally (4GB), no data leaves machine |

The `ai` devshell bundles all dependencies:

```bash
nix develop ~/dotfiles/nix#ai
# → Python ML stack: torch, transformers, accelerate, vllm
```

## VSCodium with AI extensions

While OpenCode is the primary agent interface, VSCodium provides the traditional editor experience:

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

The `continue.continue` extension gives IDE-integrated AI (code completion, inline editing) without leaving the editor.

## What makes this declarative

Every component of this agentic stack is declared in Nix and rebuilt atomically.

New tool? Add it to `programs.nix`. New skill? Add a `home.file` entry in `ai-tools.nix` (or commit the skill locally). New MCP server? Add it to `opencode.json` and deploy the script via `home.file`. Wrong model? Change the provider config in `opencode.json` and run `home-manager switch`.

There's no "install npm tool manually" step that gets forgotten on the next machine. The entire agent environment reproduces from a single config.

In [Part 3](/blog/part-3-security-posture/), we'll look at the security layer that protects this agentic environment: encrypted secrets, encrypted DNS, application firewalls, and zero-trust networking.
