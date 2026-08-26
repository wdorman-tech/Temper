# Temper

Temper is a starting point for building your own agent — one that lives in your
terminal, does real work for weeks at a time, and can't wreck your machine while
it does. Clone it, tell Claude Code what you want the agent to do, and you get
an inbox triager, a calendar manager, or something quietly running your
business. Memory, schedules, custom tools, a sandbox, and a line to your phone
are already built; you supply the job.

It isn't a chatbot with automations bolted on. Inside its container the agent
has a full shell, the web, and no permission prompts, because the container is
the boundary — the constraint is on where it can go, not on what it's allowed to
think. That's the difference between an agent that can work through a billing
dispute and one that can only fill in a form.

## Start

```sh
git clone https://github.com/wdorman-tech/Temper my-agent
cd my-agent
npm install        # also builds
npm link           # so `temper` works from any folder

cd ~/work/acme     # the folder you want the agent to work on
temper
```

First run walks you through every setting one screen at a time and tells you
where to get each one. Then it builds the container and signs you into Codex.

To make it *yours*: point Claude Code at the repo. It'll interview you, write
the north star, and build the tools. See [CLAUDE.md](CLAUDE.md), and
[docs/QUICKSTART.md](docs/QUICKSTART.md) for the order it should work in.

[`examples/`](examples) has three finished agents — one that keeps an Obsidian
vault, one that owns a calendar, one that hands work to your other agents and
notices when one goes quiet. Each carries a `GUIDE.md` that builds it end to
end with the reasoning, and reading the closest one first is worth an hour.

`temper` is a placeholder, the same way `my-agent` is. The command is named
after the agent you build: call yours Paul and you type `paul`, `paul setup`,
`paul reset`. Read `temper` as *your agent's name* everywhere below —
[naming it](#naming-it) is a two-minute change you make once.

## One agent per folder

The agent works on **the folder you ran it in, and nothing else on your
machine**. Everything it writes that isn't your work — memory, journal,
schedules, its whole workspace — lives in a Docker volume that belongs to that
folder. Not in the folder, and not in this checkout.

So `cd` is how you use it:

```sh
cd ~/work/acme && temper     # acme's agent
cd ~/work/beta && temper     # in another terminal, at the same time
```

Same agent, same tools, same instructions — two containers, two volumes, two
memories. The one in `acme` has never heard of `beta` and has no way to look.
Run it in twenty folders if you like; they share the image and your Codex
login, and nothing else.

That confinement only widens if you widen it. A folder you name during setup is
mounted at `/workspace/mounts/<name>`, read-only unless you ask for otherwise.
A folder you never named isn't reachable — not by the agent's shell, not by
asking it nicely.

(`npm start` always runs in the checkout, because that's where npm puts you —
use the linked command for anything else.)

## What you see

```
 warden                                              ● working · 4m
   drafting 3 replies  ·  unread 12  ·  next: inbox sweep in 42m

   you     anything urgent from legal?
   warden  two. contract redline due friday, and a W-9 request.
           want me to draft both?
   ·       searched gmail: from:legal newer_than:3d
   ·       wrote memory/legal-thread.md

 ╭────────────────────────────────────────────────────────────╮
 │ approve · send_email                                       │
 │ reply to Dana — contract redline, 2 attachments            │
 │ 1 Allow once   2 No                                        │
 │ pick one · no reply means no · also on your phone          │
 ╰────────────────────────────────────────────────────────────╯

 › ▮
   enter send · esc interrupt · ctrl-c quit
```

The screen belongs to the agent you built, not to this project. Its name is the
header, and the second line is whatever it decided you should know — it writes
that itself, every time the picture changes. A triage agent puts unread counts
there; a trading agent puts its position. Nothing in the UI assumes what your
agent is for.

## What's in the box

**Codex, on your plan.** Device-code login inside the container. No API key, no
per-token bill. The Codex CLI runs the agent loop, so you get its tools, its
shell and its threads for free.

**Memory that's just files.** `/workspace/memory/*.md`, with an index. The agent
greps its own notes, rewrites them, throws them out. You can read every one with
`cat`. No embeddings, nothing to reindex, nothing to corrupt.

**Schedules it writes itself.** "Check email at 4pm on weekdays" becomes a cron
entry the agent created and can change. They're timers in your session — when
your terminal is closed, nothing runs. On the next start it's told what it slept
through and decides what's still worth doing.

**Tools as files.** Drop a file in `agent/tools/`, export it, restart. Anything
marked `effect: 'write'` stops and asks first, as a question block with tappable
options and a one-line preview of what's about to happen — in the terminal and on
your phone at once, whichever you answer first. The options are the only answers
that count: a sentence isn't a yes, and neither is silence.

**Your phone.** [Agent Update](https://tryagentupdate.com) is the way out of the
terminal — a line on your lock screen, a question with tappable answers, group
chats where several of your agents and you talk in one room. Approvals go out as
the same block, so "send this invoice?" is a decision you make from a queue
rather than one you have to be at a desk for. Terminal and phone are the same
conversation; answer wherever you are.

**Standing orders.** `/correct always ship before polishing` records a rule that
outlives every session. Corrections are re-read at the start of each one, so
compaction can't lose them, and the agent can't edit the file — it's rewritten
from the journal, because a rule the agent can quietly repeal isn't a rule.

**A journal.** Every message, shell command, tool call, approval and schedule
run, appended to SQLite. The agent reads its own with the `history` tool, so
"what did you do last Tuesday?" is a question it answers rather than guesses at.

**Live settings.** Edit `.env` or anything in `agent/` and the change reaches
the running agent on its next turn. Swapping the model or rotating a credential
doesn't cost you the session.

## Where the lines are

Worth being precise about, because most agent frameworks aren't.

**Hard boundary — the container.** The agent gets a volume and one folder of
yours. The rest of your filesystem isn't there. Delete the volume and it's
factory-new. The runtime is root-owned and read-only to the agent, so the code
enforcing the rules isn't code the agent can edit. This holds even if the model
actively tries to get out.

**The folder you started it in.** Wherever you ran the command, that folder is
mounted writable at `/workspace/project` and nothing else on your disk is
reachable. Its own memory, journal and schedules are in that folder's volume, so
a second copy started elsewhere is genuinely a second agent — same instructions,
separate head. Working in the folder is the whole point, so ordinary edits don't
ask — but those are your real files, live, and **no gate sees a write**. Start
the agent in a folder you'd survive losing, or one under version control. It's
told to ask before deleting, overwriting anything you'd miss, or pushing.

**The other hole you open yourself — mounts.** A host folder you name during
setup appears at `/workspace/mounts/<name>`, read-only unless you set
`writable: true`. If you make one writable, know what you've done: the agent's
shell writes straight through to your real files and **no gate sees it**. Mount
a copy, or a folder you'd survive losing.

**Soft boundary — the effect gate.** Tools that reach the outside world ask
first, as a question block on your terminal and your phone. The options offered
are the only answers: an approval is a tap or a number, never a sentence, so a
reply that merely contains the word "allow" can't be read as one — and silence
after an hour is a no, not a later. They run inside the supervisor rather than
the tool server, so a shell that talks to the control socket gains nothing — it
can invoke a tool, and that tool still has to clear you. What it can still do is
skip tools entirely and use `curl`. A good fence, not a wall.

**Gated credentials.** Settings marked `scope: 'gated'` never enter the
container's environment. The supervisor holds them in memory and releases one to
a tool only inside a call you approved, so `env` inside the sandbox shows
nothing and the model can't read one by asking its own shell. It is not a
guarantee against a compromised container — the supervisor runs in there too —
it's a guarantee against the agent.

The honest summary: the container is what stops a wrong agent from hurting you.
Everything else raises the cost of a mistake.

## Built to run for weeks

Long-running agents don't usually crash. They rot — the thread fills up, the
model gets slower and stranger, and one day it does something odd.

So a session has a ceiling: 220k tokens or 60 turns, whichever comes first
(`TEMPER_ARC_TOKENS`, `TEMPER_ARC_TURNS`). At the ceiling the agent writes a
handoff note to memory and starts a clean thread seeded with that note, its
memory index and its north star. Nothing important is lost, because anything
important was already written down. That's why memory is a folder and not a
scrollback.

Turns run one at a time, queued, so it never races itself. Writes are atomic,
the journal is append-only and self-pruning, and a crash says what happened
instead of wedging.

Questions don't stall it either. An unanswered question buzzes your phone once
at twenty minutes and gives up at an hour, and the agent is told to work around
it rather than wait. Silence is never taken as approval — anything with an
effect simply doesn't run.

## Commands

```
temper                 start the agent in this folder — the one you want
temper setup           walk through every setting again
temper login           forget the Codex login and sign in fresh (all folders)
temper build           rebuild the container image
temper reset           delete this folder's workspace: memory, journal, schedules
```

`temper` is whatever you named the command; if your agent is Paul, every line
above starts with `paul`.

Without `npm link` these are `npm start`, `npm start -- setup`, and so on — but
npm runs them in the checkout, so the agent works on the checkout. Link it.

Everything except `build` and `login` is per-folder. `reset` throws away one
folder's agent and leaves your files, your other folders and your Codex login
alone.

## Naming it

One checkout, one agent, one name. Change these together, ideally before the
first run:

1. `manifest.name` in `agent/manifest.ts` — the installation id. It names the
   image, the container and the volume, and it's what the setup wizard prints.
2. `name` and `bin` in `package.json` — `"bin": { "paul": "dist/src/cli.js" }`.
   Then `npm run build && npm link` and the command is `paul`.
3. `TEMPER_NAME` in `.env` — what it calls *itself*, on the dashboard and on
   your phone. This one you can change any time.

What you don't rename: the `TEMPER_*` environment keys. They're the runtime's
plumbing, not branding, and renaming them means editing `src/`.

Renaming `manifest.name` after the agent has run leaves its memory, journal and
schedules behind in the old volume — `docker volume ls` and move them across, or
accept a fresh start. The Codex login moves with the name too, so you sign in
once more.

## Requirements

Docker, Node 24+, and either a ChatGPT plan with Codex or an OpenAI API key.
macOS, Linux, or Windows with Docker Desktop. Clone it — this is a template you
edit, not a dependency you install.

## The name

Tempering is what turns brittle steel into steel that holds, which is the whole
problem with agents meant to run for weeks. Temper is also disposition: this
one's is short, direct and unbothered.

It's the boilerplate's name, though, not your agent's. Yours gets its own — see
[naming it](#naming-it).

MIT.
