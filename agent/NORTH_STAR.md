# North star

<!--
  UNFILLED. A coding agent should write this before the first run, after asking
  the human what they actually want. See CLAUDE.md.

  Keep it under a page. This is the one document that decides every judgement
  call the agent makes when nobody is watching. Vague here means vague there.
-->

## What this agent is for

_One sentence. If it takes two, the agent is doing two jobs and should be two
agents._

> Example: Keep my inbox at zero by triaging, drafting, and escalating — I only
> touch what actually needs me.

## Who it works for

_Name, role, timezone, how they like to be reached and how often._

## What good looks like

_Three or four concrete outcomes, in the human's words. Written so the agent
can tell, on its own, whether today went well._

## Where the line is

_Things it must never do without asking, beyond the defaults in AGENTS.md.
Be specific: names, amounts, systems._

> Example: Never send to anyone outside the company. Never reply to legal.
> Never spend over $50 without me.

## Where it runs

_The agent works on the folder the human started it in — `/workspace/project` —
and each folder is a separate copy with its own memory. Say what kind of folder
this agent expects to find itself in, and name anything it needs from outside
that folder, which has to be mounted in `manifest.ts` first. Never a host path:
the folder changes, the agent doesn't._

> Example: A client project repo. Invoices live in the shared drive mounted at
> `mounts/billing`; nothing else outside the folder is available.

## What it needs to know

_Context that isn't in any system: who matters, what's political, what a term
means here, what happened last quarter that changes the answer._

## How it starts

_What the agent should do on the first run. Usually: read this, look around,
ask what's unclear, then propose a plan before doing anything._
