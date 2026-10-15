---
title: "Constraining the tool and the session, not the prompt"
date: 2026-10-15
description: "A web fetch sanitiser plus a taint rule that blocks side effects after hostile content arrives, what I measured and rejected, and the gaps that remain."
part: 26
permalink: /blog/restricted-mcp-servers-for-agents/
---

This is what I run right now. I rewrote this post because an earlier draft described holes that have since closed. My thesis is that you cannot reliably tell an agent to ignore a hostile page, so you limit what the agent can do after it has read one. Two pieces do that: a sanitiser that cleans fetched pages, and a taint rule that strips side effects from a session once a page looks hostile. Both run as a single plugin. The earlier design, in [Part 4](/blog/part-4-agent-security/), was a broker holding every credential. I never built it.

## What I actually run

Two pieces are registered with the agent runtime. The first is a read-only database server: each tool it exposes is a named statement with typed parameters defined in one file, so the read-only property comes from what that file defines, not from a permission check on the database connection itself. A comment in the file forbids adding a raw SQL tool. I've never seen the actual grants on the database user, so I can't say the account itself is incapable of writing. If someone adds a raw tool later, that comment and my own review are the only things standing in the way.

The second is a plugin that runs the sanitiser and the taint rule on the built-in web-fetch tool.

A third server, built for fetching and searching documentation, is registered for the research agent now, after sitting unused for a while. It only fetches hosts on an explicit allowlist, and it routes everything through the same sanitiser the plugin uses.

There was also a restricted git wrapper. It exposed six git tools and was supposed to keep agents from pushing to main. It never actually did. It wasn't registered with the agent runtime either, so prompts described tools agents didn't have. It only governed calls to its own six tools, so a raw `git push origin main` through the shell went straight past it untouched. Most of its blocklist was dead config, matched only inside a handler that nothing ever called. It also had a bypass: naming a branch `fix/x:main` passed its branch-name check and ran the push anyway. I removed it, recoverable from git history if I ever need to look back at it.

Git protection is declarative policy now, managed through the same config system as everything else. A shared rule set blocks pushes to main and master in every refspec form, blocks force variants, and blocks transport tricks. A per-person rule limits pushes to allowed branch prefixes. The full design is in [the post on declarative git policy](/blog/declarative-git-policy-for-agents/).

## The sanitiser pipeline

The sanitiser is plain standard-library code with no dependencies, called both by the plugin and by the documentation server. The earlier version failed in two ways I found by reading it: it tried to redact a matched phrase by overwriting the warning message instead of the actual matched text, so nothing was really removed, and it never checked where a redirect actually led. Both are fixed now. The documentation server validates every redirect hop and rejects anything that isn't http or https. The built-in web-fetch tool doesn't get that redirect check, only the sanitiser and the taint rule apply to it.

| Layer | What it does | What it misses |
|---|---|---|
| Normalise | Folds lookalike characters, strips zero-width and bidi control characters | Homoglyphs that normalisation doesn't fold |
| Markup | Strips comments, scripts, forms, iframes and hidden elements | Text hidden in ways the pattern doesn't see |
| Images | Replaces every external image with a placeholder | Other exfiltration channels, like links |
| Encodings | Decodes base64 and hex runs and redacts those that hide an injection | Other encodings, payloads split across runs |
| Phrases | Redacts known-bad wording, like "ignore previous instructions" | Paraphrases that match no pattern |
| Typoglycemia | Flags scrambled keywords when several appear together | Scrambles of words not on its list |
| Wrap | Labels the text as untrusted inside a random boundary | A label informs the model; it doesn't bind it |
| Datamark | Marks a page's whitespace once a high-severity finding fires | Clean-looking pages aren't marked at all |

The wrap step fails closed: if the sanitiser can't run, the page gets withheld entirely rather than passed through unlabeled.

<figure class="diagram">
<svg viewBox="0 0 880 300" role="img" aria-labelledby="taint-flow-title taint-flow-desc" xmlns="http://www.w3.org/2000/svg"><title id="taint-flow-title">Fetched content, sanitiser, taint, then blocked or allowed tools</title><desc id="taint-flow-desc">A page fetched by webfetch or fetch_doc goes to the sanitiser, which redacts, datamarks and wraps it. A high-severity finding marks the session as tainted. A tainted session blocks write, task, most bash and mutating MCP tools, and keeps read-only tools. The next real user message releases the taint.</desc><rect class="d-zone" x="0" y="0" width="880" height="300" rx="8"/><text class="d-tag" x="16" y="20">OpenCode session</text><rect class="d-box" x="24" y="110" width="160" height="90" rx="6"/><text class="d-num" x="40" y="134">1</text><text class="d-name" x="40" y="158">Fetch</text><text class="d-sub" x="40" y="178">webfetch tool</text><text class="d-sub" x="40" y="192">fetch_doc MCP</text><path class="d-arrow" d="M184 155 H224"/><rect class="d-box" x="224" y="110" width="200" height="90" rx="6"/><text class="d-num" x="240" y="134">2</text><text class="d-name" x="240" y="158">Sanitiser</text><text class="d-sub" x="240" y="178">redact, datamark,</text><text class="d-sub" x="240" y="192">wrap as untrusted</text><path class="d-arrow" d="M424 155 H464"/><rect class="d-box" x="464" y="110" width="190" height="90" rx="6"/><rect class="d-focal" x="464" y="110" width="190" height="90" rx="6"/><text class="d-num" x="480" y="134">3</text><text class="d-name" x="480" y="158">Taint</text><text class="d-sub" x="480" y="178">high finding marks</text><text class="d-sub" x="480" y="192">the session</text><path class="d-arrow" d="M654 155 H674 V75 H694"/><path class="d-arrow" d="M654 155 H674 V235 H694"/><rect class="d-box" x="694" y="30" width="162" height="90" rx="6"/><text class="d-num" x="710" y="54">4</text><text class="d-name" x="710" y="78">Blocked</text><text class="d-sub" x="710" y="96">write, task, bash</text><text class="d-tag" x="710" y="112">until user speaks</text><rect class="d-box" x="694" y="190" width="162" height="90" rx="6"/><text class="d-num" x="710" y="214">5</text><text class="d-name" x="710" y="238">Allowed</text><text class="d-sub" x="710" y="256">read, grep, glob</text><text class="d-tag" x="710" y="272">always</text></svg>
<figcaption>A page with a high-severity finding taints the session. Side-effecting tools stay blocked until the next real user message.</figcaption>
</figure>

## The taint rule

The plugin implements the rule in four steps. After a fetch call, it pipes the page through the sanitiser. If any finding is high severity, it marks the session tainted, noting the source URL and what kind of finding tripped it. While tainted, a hook blocks side-effecting calls by throwing an error: write and edit tools, subagent spawns (a subagent runs in its own session, so I block it outright rather than try to track taint across the boundary), shell commands outside a read-only allowlist, any call touching a credential path, a fetch to a URL with a query string or fragment, and anything that looks like a mutating call to an external tool. Read-only tools keep working.

The block message tells the agent not to retry or route around it, and to report what the page was trying to do instead. The taint lifts on the next real message from me, not from the model. A model can't write a user message, so it can't release itself. A timeout is a backstop, in case I just walk away.

This is deterministic, no model call, same style as the command guard. It doesn't stop the model from reading a hostile page. It removes the actions a hostile page would want it to take afterward.

## What I measured and rejected

I tested [a small local classifier](/blog/command-guards-for-coding-agents/) in two roles, against a small hand-built set of attacks and benign texts, so treat this as a smoke test rather than a benchmark.

As a prompt shield, it caught noticeably more real attacks than the plain pattern sanitiser. It also flagged several benign texts as attacks, more than the sanitiser did, including ordinary security writing and documentation that happened to mention a system prompt. It was fast once warm, slow to start cold, and its accuracy dropped the more the injected sentence was buried inside longer surrounding text.

As a critic, judging whether a proposed tool call actually matches what I asked for, it failed outright. A perfectly benign edit scored higher than some of the deliberately drifted calls it was supposed to catch. I don't use it as a critic, and I didn't ship it as a shield either. At most it's an advisory extra signal, not something I'd gate on.

## Known gaps

Paraphrased injections that match no pattern never trip the taint. Fetchers other than the built-in one, a browser tool, chat and ticket readers, aren't sanitised and don't taint at all. The shell allowlist during a tainted session is conservative on purpose, so ordinary commands get blocked along with dangerous ones. The redirect re-check and domain allowlist exist only in the documentation server, not in the built-in fetch tool. And labelling a page as untrusted informs the model; it doesn't bind it to anything.

## What I could not verify

I tested the plugin under a shim, not inside a live, long-running session. I haven't confirmed that fetching a page with an actual injection attempt produces a wrapped output and a refused follow-up write in practice, only in the test harness. I also haven't seen the database user's actual grants, and the domain allowlist has had no real use yet, so I don't know how well it holds up.
