---
title: "What I dropped and why"
date: 2026-09-30
updated: 2026-10-15
description: "Eight agent sandbox and tooling designs I wrote about as if they existed, checked against the repo, with the reason for each cut where one was recorded."
part: 24
permalink: /blog/what-i-dropped-and-why/
---

Earlier in this series I described a declarative Firecracker VM for an agent I called Hermes as something that already existed. It didn't, not when I wrote it. That isn't the only claim like that. This post goes back through the series and checks each one against the actual repository: what got built, what got dropped, and why, where a reason survives anywhere.

## The gVisor sandbox

I described agents running "inside gVisor sandboxes, holding zero secrets," with a runner scheduled for later that year. Neither shipped. The planning document for it says plainly that none of the twelve listed tasks were done, and the directories the sandbox would have lived in don't exist.

No reason for dropping it is recorded anywhere I can find. The closest thing to an explanation shows up later: the supervisor design assumed a machine I wasn't running on. It was written for Linux, and I'm on macOS. What replaced the sandbox is a Lima VM, covered in [the NixOS VM post](/blog/a-nixos-vm-as-an-agent-jail/), which says outright that neither gVisor nor Firecracker ever ran.

## Firecracker microVMs

I called this phase two and described the target as microVMs that "give you hardware-level isolation." The only artifact that exists is a handoff document whose status line says, plainly, future work. A later post adds the real blocker: Firecracker needs KVM, and macOS doesn't have it. No other reason is recorded.

## The Hermes VM and its deploy pipeline

I described a NixOS VM for an ops agent, deployed through a tool called krops, and said it would be "plenty" once it was "actually running." None of that exists today. The flake lists no such VM and no such package, and a search through the relevant directories for anything related turns up nothing.

The directory did exist for a while, and its own history tells the story better than I can summarize it. One commit added the VM. A later one flagged it as not deployed. A third removed it, citing an unrelated audit that found the deploy tool itself hadn't been touched upstream in well over a year. That removal commit specifically says it left a different, still-active Hermes setup alone: a plain Lima VM that reads from a database and a ticket tracker, with nothing credential-bearing mounted into it. I haven't booted it, so I can't say whether it still works.

## Heracles

I described "a full agent platform called Heracles," with a web UI, scheduled runs, a tool registry, token tracking. It never existed. No file, no commit, nothing under that name anywhere in the history. There's no reason recorded, because there's no decision to record. It was never built.

## OrbStack

I wrote that I used OrbStack instead of Docker Desktop for Maven test containers. That was true when I wrote it. A comment left behind in the config that eventually removed it says why: it was never actually running, no socket ever existed for it, nothing used it. Docker runs in a Lima VM instead now.

## Per-job Bedrock minting

I designed credential minting at the start of each job: the host mints a short-lived API key and injects it per job. What actually runs is simpler and less precise. A background job refreshes one shared credentials file on a timer, and a VM start job copies it in. There's no per-job boundary, because there was never a sandbox with job boundaries to mint for in the first place. [The Bedrock credentials post](/blog/short-lived-bedrock-credentials-for-agents/) covers what actually runs.

## The NixOS agent image

This one is real. The flake builds it, and [the VM post](/blog/a-nixos-vm-as-an-agent-jail/) covers what it does and where it disagrees with the Lima config that actually runs today.

## The git-restricted MCP server

I removed this one myself, recently, and wrote down why at the time. It was never registered with the agent runtime, so prompts described tools agents didn't actually have. It never touched raw shell commands, only its own six tools, and most of its blocklist matched nothing because the handler it needed was missing entirely. It also had a straightforward bypass: naming a branch `fix/x:main` sailed past its own check. Git protection is declarative policy now, covered in [the post on that](/blog/declarative-git-policy-for-agents/), with more detail in [the restricted servers post](/blog/restricted-mcp-servers-for-agents/).

## The webfetch-filter server

Not dropped, just slow to register. It sat unused for a long stretch before I wired it into the research agent. Its sanitiser also protects the built-in web-fetch tool through a separate plugin.

## The laya approval gate

I removed this with no reason recorded in the commit itself. Separately, I measured it as a prompt shield and as a critic of proposed tool calls, and rejected it for both roles. The numbers are in [the command guards post](/blog/command-guards-for-coding-agents/).

<figure class="diagram">
<svg viewBox="0 0 880 280" role="img" aria-labelledby="drop-tl-title drop-tl-desc" xmlns="http://www.w3.org/2000/svg"><title id="drop-tl-title">From design to removal of the Hermes Firecracker VM</title><desc id="drop-tl-desc">A timeline of five steps. Design documents, then the Hermes Firecracker config, then the VM disabled months later, then the VM removed, then the posts edited and squashed. A note says an earlier post claimed the config already existed, before any of this happened.</desc><rect class="d-zone" x="0" y="0" width="880" height="280" rx="8"/><text class="d-tag" x="16" y="20">Sequence in the dotfiles repo history</text><rect class="d-box" x="24" y="60" width="148" height="80" rx="6"/><text class="d-num" x="40" y="84">1</text><text class="d-name" x="40" y="106">Design docs</text><text class="d-sub" x="40" y="126">written</text><path class="d-arrow" d="M172 100 H196"/><rect class="d-box" x="196" y="60" width="148" height="80" rx="6"/><text class="d-num" x="212" y="84">2</text><text class="d-name" x="212" y="106">Hermes VM</text><text class="d-sub" x="212" y="126">added</text><path class="d-arrow" d="M344 100 H368"/><rect class="d-box" x="368" y="60" width="148" height="80" rx="6"/><text class="d-num" x="384" y="84">3</text><text class="d-name" x="384" y="106">Disabled</text><text class="d-sub" x="384" y="126">months later</text><path class="d-arrow" d="M516 100 H540"/><rect class="d-box" x="540" y="60" width="148" height="80" rx="6"/><rect class="d-focal" x="540" y="60" width="148" height="80" rx="6"/><text class="d-num" x="556" y="84">4</text><text class="d-name" x="556" y="106">Removed</text><text class="d-sub" x="556" y="126">weeks after that</text><path class="d-arrow" d="M688 100 H712"/><rect class="d-box" x="712" y="60" width="148" height="80" rx="6"/><text class="d-num" x="728" y="84">5</text><text class="d-name" x="728" y="106">Posts edited</text><text class="d-sub" x="728" y="126">squashed</text><rect class="d-zone" x="24" y="180" width="500" height="64" rx="6" style="stroke-dasharray:6 4"/><text class="d-tag" x="40" y="206">An earlier post</text><text class="d-sub" x="40" y="228">says the VM config already existed</text></svg>
<figcaption>What an earlier post described as already shipped took months to arrive, and then got pulled back out.</figcaption>
</figure>

## What I do differently now

Recent posts in this series say up front, in the first paragraph, whether something is built or only designed. That's a real fix, but not a complete one. I haven't gone back to confirm every earlier post in the series links forward to this one, and at least one still has no correction note where it probably needs one.

## What I still can't explain

Why the Hermes VM's actual history lands so much later than the post that described it as already running. Whether the old, simpler Lima-based Hermes setup still works today. And why gVisor, Firecracker and Heracles got dropped at all. None of the three has a recorded reason. Just the absence of anything built.
