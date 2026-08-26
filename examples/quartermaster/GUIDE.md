# Building Quartermaster

An agent that manages the other agents. The human asks it for anything; it
works out which agent owns that, hands the work over, and stays on it until it
is done or until it is clear that it is stuck.

You are a coding agent. This is the build, in order. Read
[`../../docs/BUILD_GUIDE.md`](../../docs/BUILD_GUIDE.md) first — this guide
assumes its standard and does not repeat it. The interface work in its §5 and
§8 is runtime debt, not part of building an agent; leave it alone unless you
were asked for it.

---

## 1. Why this job is hard

Every other agent in this folder acts on something: a calendar, a vault, an
inbox. This one acts on *agents*, and that changes three things.

**You cannot see the thing you manage.** Quartermaster is sandboxed. The agents
it manages are separate installs with their own containers, their own logins
and their own approvals. There is no process list, no service to restart, no
filesystem path to another agent. The only instrument that reaches past the
boundary is a group chat.

**Silence is ambiguous and the ambiguity is expensive.** An agent that has not
answered might be finished, busy, crashed, or never asked. A previous build of
this agent waited 120 seconds and reported "did not answer" as a fact about the
agent. It was a fact about the timeout.

**The state has to outlive the context.** The whole job is remembering what was
handed over. Sessions get compacted — the model wakes in a fresh thread with a
handoff note and nothing else — so anything held in the conversation is gone by
Thursday. If the ledger lives in the model's head, the job is not being done.

---

## 2. The interview

- **Which agents exist, and what does each own?** Write the answer down and
  then throw it away, because it will be wrong within a month. What you
  actually need is the *rule*: how does the human decide who owns a new kind of
  work?
- **How long does each one normally take to answer?** This is the number that
  makes overdue mean something. If he does not know, that is fine — the agent
  learns it, and until it has, silence has no deadline.
- **What should it never do itself?** The answer is usually "any of the work",
  and it needs saying explicitly because the shortcut is always available.
- **What is worth waking him for, and when?** Quiet hours are a real setting
  for this agent in a way they are not for the others: it is the one that
  produces unprompted messages.

---

## 3. Name it, before the first run

CLAUDE.md says three places. It is four, and one of them cannot be done yet.

1. `manifest.name` in `agent/manifest.ts` — the installation id. Names the
   image, the container and the volume.
2. `manifest.settings` — the `TEMPER_NAME` entry ships with
   `default: 'temper'` and the wizard prefills from it, so a human who presses
   enter through setup gets an agent that calls itself `temper`. Set
   `manifest.tagline` too.
3. `package.json` — `name`, and the `bin` key.
4. `.env` — **written by the wizard on the first run**, so there is nothing to
   edit yet. Fix `TEMPER_NAME` in `.env.example`, the reference copy.

`npm run build && npm link` belongs at the end of §8, not here.
`npm unlink -g temper` clears the stale link and takes the name the package was
registered under, which is still the old one. Then fix `README.md`.

`TEMPER_NAME` matters more here than for any other agent: it is the name this
agent answers to in a room full of agents, and the name its peers address it
by. Pick something a person would say out loud.

---

## 4. How it reaches the fleet

Agent Update has no direct agent-to-agent channel. Two agents talk in a
**room**, which belongs to the human, who reads every word.

- `fleet` — every room that exists right now, who is in it, and when each was
  last heard from. Read live, every time.
- `delegate` — resolve the agent's room, post the request, open an assignment.
- `follow_up` / `room_send` — say something else into a room.
- Inbound: a peer's post wakes this agent as a turn tagged `[group chat <room>
  — another agent speaking, not the human]`. `agent/AGENTS.md` already carries
  the rule for the model, so you do not have to write it: answering a peer is a
  choice, made with `room_send`, because two agents each answering the other's
  answer never stops.

The human has to make the rooms in the app. You cannot create one from here and
neither can the agent. Put that in the setting's `how` steps, because it is the
one part of setup with no error message: everything works and `fleet` returns
an empty list.

**Note what this constraint is and is not.** The human reading every room is
*visibility*, not a gate. `delegate` can ask another agent to do something
irreversible and nothing on this side stops it; that the far side re-gates it
is a promise its `AGENTS.md` makes, not something the runtime enforces. Say so
in the north star rather than letting the agent infer that the room makes it
safe.

---

## 5. Write the north star

`agent/NORTH_STAR.md`, from §2's answers, before any code. Every paragraph in
it is buying one thing: an agent that does not confuse its own records with the
world.

**The prohibitions are about epistemics.** Never conclude an agent is dead
because it has not answered. Never present bookkeeping as observation. Never
answer for an agent. Never invent an event, a message, a status or a number.
Read those four together and they are one rule: *say how you know.*

**Silence is defined, not assumed.** *An observation with a duration attached —
"asked 14 minutes ago, nothing yet" — and a finding only when you know that
agent's normal well enough to expect faster.* That sentence is why
`expect_within_minutes` is optional and why `overdue` is false without it.

**Room identity is asked for, never remembered.** A room re-made in the app has
a new id and the same people in it. A post that fails with "that group chat
does not exist" is a fact about the room, not about the agent.

**A tool failing is the start of the work.** Read the error, form a guess, check
it against live state, fix it if it is yours, retry, then say what broke and
what you did. Worth writing into any agent whose job is diagnosis.

**Quiet hours, with the arithmetic.** An unanswered `ask` nudges again after
twenty minutes and gives up after an hour — `NUDGE_AFTER` and `GIVE_UP_AFTER`
in `src/runtime/main.ts`, on a timer with no idea what hour it is. So at night
a question costs two interruptions, not one. An agent that knows the cost can
decide; one that does not will decide wrong.

Add a `## Status` section — `detail` is `waiting on librarian`, `metrics` is
`open 4 · overdue 1 · agents 3`. And `## How it starts`, which is also the only
place the sweep in §9 can live, because there is nowhere in `agent/` to seed a
schedule.

---

## 6. Settings

[`settings.ts`](settings.ts) is one entry, and it **replaces** the
`AGENT_UPDATE_TOKEN` already in `agent/manifest.ts` rather than joining it.
Swap the whole entry: the `why` changes, a fourth `how` step is added telling
the human to make the rooms, and — the load-bearing part — `optional: true`
comes off so the wizard blocks on it.

Most agents work fine without a phone. This one does not work at all: the rooms
are the only way it reaches the fleet.

Keep `scope: 'runtime'`. The supervisor is the only thing that uses the token,
so keeping it out of the container's environment means the agent's own shell
cannot read the credential that speaks *as* the agent.

Everything else it needs is already in the manifest. There are no API keys,
because it calls no service of its own: this agent's whole risk surface is what
it says, not what it touches.

---

## 7. The tools — six, and none of them gated

Nothing in [`tools.ts`](tools.ts) is `effect: 'write'`. These tools only talk,
in rooms the human reads, and gating them would mean an approval block for
every sentence of a job that is entirely sentences. The effects live in the
agents on the other end, behind their own approvals.

They go in `agent/tools/work.ts`, a new file next to `_kit.ts`.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `fleet` | none | `{checkedAt, rooms: [{id, name, members, lastHeard, openAssignments}], note?}` |
| `delegate` | `agent`, `request`, `expect_within_minutes?` | `{ok, id, agent, room}` or `{ok: false, reason, rooms}` |
| `follow_up` | `id`, `message` | `{ok, id, agent, reboundFrom?}` |
| `heard` | `id`, `what_they_said` | `{ok, id, agent}` |
| `close_assignment` | `id`, `outcome`, `done` | `{ok, id, agent, done}` |
| `assignments` | `include_closed?` | `{checkedAt, open, overdue, neverAnswered, closed?, incomplete?}` |

Two of the runtime's types are `Promise<unknown>` — `ctx.history` and
`ctx.rooms.list` — so every read needs narrowing you write by hand. There is no
generic to reach for.

### The ledger is a fold over the journal

There is no state file. An assignment is the replay of its own events. This is
the part the guide has to give you in full, because none of it is inferable:

```ts
// Four event shapes, all written under the same journal kind.
await ctx.note('assignment', { id, step: 'opened', agent, room, roomId, request, expectMinutes });
await ctx.note('assignment', { id, step: 'followed_up', roomId });
await ctx.note('assignment', { id, step: 'heard', what });
await ctx.note('assignment', { id, step: 'closed', outcome, done });

// Read them back. Newest first, so reverse before folding.
const events = (await ctx.history(LOOKBACK, noted('assignment'))) as JournalEvent[];
// JournalEvent is { id: number; at: string; kind: string; data: unknown }.
```

`step` is the discriminator. Everything that identifies the assignment rides on
`opened` and nothing else; the other three carry only what they change. **No
event carries a timestamp** — the journal row's `at` is the timestamp, which is
why `openedAt` and `heardAt` are read off the row rather than the payload.

```ts
const noted = (kind: string): string => `agent.${kind}`;
```

`ctx.note` writes under `agent.<kind>` and `ctx.history` matches a kind exactly.
Write with the bare name, read with the prefix. Get this wrong and the whole
subsystem is write-only without a single error — everything appears to work and
every list comes back empty.

### Silence is measured from their last word, not ours

```ts
const silentForMinutes = minutesSince(assignment.heardAt ?? assignment.openedAt);
const overdue = isOpen(a) && a.expectMinutes !== null && silentForMinutes > a.expectMinutes;
```

`minutesSince` rounds and clamps at zero. Measure from your own last message
instead and a chase resets the clock — so the more times you nudged a dead
agent, the healthier it would look. `overdue` is strictly greater, and is false
whenever `expectMinutes` is null: unknown silence is not lateness.

### The window has a ceiling, so report it

`ctx.history` clamps at 200 — silently, `Math.min(limit, 200)`. An assignment
whose `opened` event has scrolled out of that window is invisible to the fold,
and an event whose `opened` is gone is an orphan. Fire `incomplete` on
**either** condition:

```ts
const saturated = events.length >= LOOKBACK;   // window full
// orphaned: any non-`opened` event whose id has no assignment in the fold
incomplete: saturated || orphaned > 0 ? …
```

Saying "nothing is outstanding" off a truncated list is the exact failure this
agent exists to prevent. If you build anything on a capped history, make the
cap visible in the output.

### Where "last heard from" comes from

Not from your own events. The runtime records `journal.record('room.heard', {
from, room })` in `src/runtime/main.ts` every time a peer posts in a room, and
that is the only source of a pulse for an agent nobody has delegated to. Read
it with `ctx.history(LOOKBACK, 'room.heard')` — a bare kind, **not** through
`noted()`, because the runtime wrote it, not you.

### Rooms resolve by whole word, and refuse when ambiguous

```ts
const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(hay);
```

`hay` is the room name plus its members' names, lowercased. Not `includes`: a
substring test resolves "Bee" against a room called "Beekeeper", which posts
someone's work to the wrong agent and reports success. The regex refuses that
and matches a room actually called "Bee".

`resolveRoom` returns `{ room: LiveRoom | null; rooms: LiveRoom[]; reason?: string }`
— `room` is null exactly when there is a `reason`. Two matches is a refusal,
not a coin toss, and both refusals name the rooms that *do* exist so the model
can correct itself in one turn.

The room record on the wire carries more than `fleet` returns —
`{id, name, members: [{id, name, self, role}], human, humanPresent, createdAt,
lastMessageAt}` — and the runtime's own `Room` type declares only `{id, name}`.
Narrow it yourself, and keep `role`: it is what an agent was brought into the
room to do, which is half of deciding whether it is the agent you meant.

### A failed post must not open an assignment

```ts
const posted = await ctx.rooms.send(found.room.id, args.request);
if (posted === null || posted === undefined) { … }
```

A send that fails returns nothing rather than throwing, and the five causes —
429, 5xx, any non-ok, a thrown fetch, a disabled token — are indistinguishable
from here. Opening an assignment for a message that never left would
manufacture the one fact this agent must never invent: that somebody was asked.
Check the result. Every tool here that posts does.

Where an empty result is ambiguous, return the ambiguity:

```ts
const EMPTY_MEANS =
  'No rooms came back. That is either no rooms, or Agent Update being unreachable, rate-limited or ' +
  'refusing the token — those look the same from here. Check before reporting anything about an agent.';
```

Let the model narrate a bare `[]` and it produces "you have no agents
configured", confidently, during an outage.

---

## 8. Wire it up

```ts
// agent/tools/index.ts
import { assignments, closeAssignment, delegate, fleet, followUp, heard } from './work.ts';

export const tools: Tool[] = [
  ask, notify, status,
  remember, recall, forget,
  history,
  schedule, unschedule, schedules,
  roomSend,
  fleet, delegate, followUp, heard, closeAssignment, assignments,
];
```

Do §7 first, or `npm run check` is broken in between.

Drop the built-in `rooms` tool: `fleet` covers what it did and adds the
timings, and two tools that list rooms is one more thing for the model to
choose between. Then fix the sentence it leaves behind — `room_send`'s
description in `agent/tools/rooms.ts` says *"Room id from `rooms`"*, and that
tool no longer exists. Point it at `fleet`. A description is a prompt, and a
prompt naming a tool the model cannot call is a dead end it will try anyway.
While you are in there, have `room_send` check its send result, for the reason
in §7.

Swap the `AGENT_UPDATE_TOKEN` entry in `agent/manifest.ts` for the one in
[`settings.ts`](settings.ts) — **paste** it, never import, because the
Dockerfile copies `src/` and `agent/` and nothing else. Delete the
`WEBHOOK_TOKEN` and `NOTES_DIR` placeholders and `agent/tools/example.ts` in
the same edit; the tool and the setting it uses are a pair. `.env.example` is
the same list again, so fix it here too.

Then `agent/AGENTS.md`. Keep the voice; add a `## Work you hand to an agent`
section with the loop, because this is what the model gets wrong by defaulting
to helpfulness:

1. `delegate` to the agent that owns it. Set `expect_within_minutes` from what
   you know its normal to be. That opens an assignment.
2. Say you have asked, as one line of the reply you were already sending — not
   a second message, and not a `notify`. Do not wait.
3. When it replies: `heard` to record what it said, in its words. Then decide.
   Needs something from you? `follow_up`. Asked you something only the human
   can answer? `ask`, then `follow_up` with the answer. Finished? Close it.
4. `close_assignment` with `done: true` only when the agent said the work is
   finished. "I'll get to it" is not done. Time passing is not done.

Add one more rule, because it is this agent's most common failure: **a turn the
human started ends with the answer.** Not a status line, not "I'll let you
know", not a tool call and silence. If you could not get it, the answer is what
you tried and what stopped you.

Then `npm run build && npm link`.

---

## 9. Day one, and the sweep

`## How it starts` says to trust nothing it was told about the fleet. A roster
written during setup is stale the first time an agent is renamed, and an agent
reporting from a stale roster is worse than one reporting nothing.

So: call `fleet`, ask each agent what it is for and what it has done this week,
read the folder it was started in, and write one memory note per agent — what
it does, where it lives, its room, what work belongs to it, and how long it
usually takes to answer. Mark anything unconfirmed as unconfirmed. Then show
the human the list and ask the two questions only he can answer: what is
missing, and who owns what.

Without that last number the agent can report silence but never lateness.

The sweep goes in the same section, as an instruction — the agent creates it by
calling the `schedule` tool:

```
name:   sweep
cron:   0 9-18 * * 1-5
prompt: Call `assignments`. For anything overdue, decide: chase it with
        `follow_up`, or close it as abandoned with an outcome. If `incomplete`
        is set, search `history` before concluding anything. Message the human
        only if something is overdue or stuck — silence otherwise.
```

Hourly is the exception rather than the rule; most agents' schedules should be
daily or weekly. This one exists to notice things not happening, and a check
that runs once a day can only notice a day late.

---

## 10. Test it

```sh
npm run check
npm run build
npm start -- setup         # needs Docker running: the preflight is before the wizard
cd ~/somewhere/real && quartermaster
```

This agent needs two agents and a room to test properly. Short of that, a fake
`Ctx` in a scratch harness covers everything except the live peer post — the
tools take `ctx` and nothing else, which is what makes that possible.

- **Delegate to a name that matches two rooms.** It must refuse and say why,
  not pick one.
- **Delegate to a name that matches nothing.** It must return the rooms that do
  exist, so the model can correct itself in one turn.
- **Delete the room in the app, then `follow_up`.** It must re-resolve, post to
  the new room, and report the rebind — not report the agent as silent.
- **Turn the other agent off and ask where the work is.** The answer must be
  "asked 40 minutes ago, nothing back", never "it failed".
- **Let a peer post in the room.** Confirm this agent wakes, and confirm it
  does *not* post an automatic reply back into the room.
- **Fill the journal window.** Drop `LOOKBACK` to 5 for the test — twelve
  assignments will not do it, and 200 events by hand is not a test anyone runs.
  Confirm `incomplete` fires rather than the list quietly getting shorter.

---

## 11. What breaks

**It does the work itself.** Reading the inbox is right there and faster than
asking. One sentence in the north star fixes it: if Librarian owns email, email
goes to Librarian even when you could read the inbox — and the only exception
is finding out why Librarian is not answering.

**It reports memory as observation.** "Librarian is running fine" from a note
written on Tuesday. The fix is a phrasing rule, not a capability: say when you
last checked, every time.

**It closes assignments on acknowledgements.** "On it" is not done.

**It chases too fast.** Usually `expect_within_minutes` guessed instead of
learned. Leave it out until the number is real.

**Two agents talk forever.** Something is auto-replying to a peer. The routing
is deliberate — a peer-woken turn answers nobody unless the agent chooses to —
so a loop means a tool posted back into the room on every turn without
deciding to.

---

## What to steal from this one

Any agent that has to remember a commitment across a session rotation — a
promise made, an invoice sent, a question asked — should keep it as appended
events rather than a file it rewrites, and should say out loud when its read of
those events is truncated.

---

Built on [Temper](https://github.com/wdorman-tech/Temper).
Reaching a phone is [Agent Update](https://tryagentupdate.com/docs/agents/quartermaster).
