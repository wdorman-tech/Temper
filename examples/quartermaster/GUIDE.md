# Building Quartermaster

An agent that manages the other agents. The human asks it for anything; it
works out which agent owns that, hands the work over, and stays on it until it
is done or until it is clear that it is stuck.

You are a coding agent. This is the whole build, in order, with the reasoning.
Read [`../../docs/BUILD_GUIDE.md`](../../docs/BUILD_GUIDE.md) first — this
guide assumes its standard and does not repeat it.

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
agent. It was a fact about the timeout. The agent in question routinely took an
hour and was perfectly healthy.

**The state has to outlive the context.** The whole job is remembering what was
handed over. Sessions get compacted — the model wakes up in a fresh thread with
a handoff note and nothing else — so anything held in the conversation is gone
by Thursday. If the ledger lives in the model's head, the job is not being
done.

Everything below follows from those three.

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
  and it needs saying explicitly because the shortcut is always available and
  always tempting.
- **What is worth waking him for, and when?** Quiet hours are a real setting
  for this agent in a way they are not for the others: it is the one that
  produces unprompted messages.
- **Is he in every room?** With Agent Update he is, by construction — there is
  no agent-to-agent channel, only rooms he owns. Say it out loud anyway,
  because it is the reason this design is safe.

---

## 3. Name it, before the first run

Three places, per [CLAUDE.md](../../CLAUDE.md): `manifest.name`, `package.json`
(`name` and the `bin` key), and `TEMPER_NAME` in `.env`. Then
`npm run build && npm link`, and `npm unlink -g temper`.

`TEMPER_NAME` matters more here than for any other agent: it is the name this
agent answers to in a room full of agents, and the name its peers will use to
address it. Pick something a person would say out loud.

---

## 4. How it reaches the fleet

Agent Update has no direct agent-to-agent channel and will not be getting one.
Two agents talk in a **room**, which belongs to the human, who reads every word.
That constraint is the safety property of the whole design: there is no
conversation between your agents that you are not in.

So the reach is:

- `fleet` — every room that exists right now, who is in it, and when each was
  last heard from. Read live, every time.
- `delegate` — resolve the agent's room, post the request, open an assignment.
- `follow_up` / `room_send` — say something else into a room.
- Inbound: a peer's post in a room wakes this agent as a turn tagged
  `[group chat <room> — another agent speaking, not the human]`.

The human has to make the rooms in the app. You cannot create one from here and
neither can the agent. Put that in the setting's `how` steps, because it is the
one part of setup that has no error message: everything works and `fleet`
returns an empty list.

### The peer path, and the loop it avoids

A turn started by a **peer** is a different source from a turn started by the
**human in a room**. The human's message auto-replies back into that room. A
peer's does not — nothing goes back unless the agent calls `room_send` or
`follow_up` itself.

That asymmetry is not fussiness. Auto-replying both ways means two agents each
answering the other's answer, forever, on somebody's plan. `agent/AGENTS.md`
carries the rule for the model; the runtime enforces the routing.

The practical consequence for this agent: when a peer replies, the useful move
is almost never to thank it in the room. It is to record what it said, decide
what changes, and tell the human what the answer means.

---

## 5. The north star

[`NORTH_STAR.md`](NORTH_STAR.md) is longer than the other two and every extra
paragraph is buying the same thing — an agent that does not confuse its own
records with the world.

**The prohibitions are about epistemics, not permissions.** Never conclude an
agent is dead because it has not answered. Never present bookkeeping as
observation. Never answer for an agent. Never invent an event, a message, a
status or a number. Read those four together and they are one rule: *say how
you know.*

**Silence is defined, not assumed.** "Silence is an observation with a duration
attached — 'asked 14 minutes ago, nothing yet' — and it becomes a finding only
when you know that agent's normal well enough to expect faster." That sentence
is why `expect_within_minutes` is optional in `delegate` and why `overdue` is
false without it. An unknown duration is not lateness.

**Room identity is asked for, never remembered.** A room re-made in the app has
a new id and the same people in it. A post that fails with "that group chat
does not exist" is a fact about the room, not about the agent — and the
difference between an agent that reports "librarian did not answer" and one
that repairs the binding and says so is entirely this paragraph.

**A tool failing is the start of the work.** Read the error, form a guess,
check it against live state, fix it if it is yours, retry, then say what broke
and what you did. This is the line that separates the agent from the scripted
loop it replaces, and it is worth writing into any agent whose job is
diagnosis.

**Quiet hours, with the arithmetic.** An unanswered `ask` buzzes again after
twenty minutes on the runtime's own timer, which has no idea what hour it is.
So at night a question is two interruptions, not one. Say that; an agent that
knows the cost can decide, and one that does not will decide wrong.

---

## 6. Settings — it does not add one, it changes one

[`settings.ts`](settings.ts) has a single entry, and it is a **replacement**
for one already in `agent/manifest.ts`.

`AGENT_UPDATE_TOKEN` ships optional, because most agents work fine without a
phone. This one does not work at all: the rooms are the only way it reaches the
fleet, and a fleet manager that cannot talk to the fleet is not a job. Drop the
`optional: true` so the wizard blocks on it.

Keep `scope: 'runtime'`. The supervisor is the only thing that uses the token,
so keeping it out of the container's environment means the agent's own shell
cannot read the credential that speaks *as* the agent. For an agent whose
entire output is messages in other people's rooms, that is the credential that
matters most.

Everything else it needs is already in the manifest. There are no API keys,
because it calls no APIs of its own — which is worth noticing, because it means
this agent's whole risk surface is what it says, not what it touches.

---

## 7. Tools — six, and none of them gated

Nothing in [`tools.ts`](tools.ts) is `effect: 'write'`. That is a decision, not
an oversight, and it is the one thing about this agent most likely to be
"corrected" by someone who has not thought it through.

Every one of these tools posts into a room the human owns and reads. Talking to
the human — or to an agent in front of the human — is not an effect on the
world. `AGENTS.md` already says so for `notify` and `room_send`. Gating them
would mean an approval block for every sentence of a job that is entirely
sentences, which is how a gate stops being read. The effects live in the agents
on the other end, behind their own approvals.

If you find yourself wanting a gate here, the thing you actually want is
usually `ask` — a question with options, which is cheap and does not pretend to
be a permission boundary.

| Tool | What it is for |
| --- | --- |
| `fleet` | The company as it stands right now: rooms, members, when each was last heard from, how much open work each has |
| `delegate` | Resolve a room, post the request, open an assignment |
| `follow_up` | Say something else on an open assignment; re-resolves the room first |
| `heard` | Record what an agent actually said, in its words |
| `close_assignment` | Close it, with an outcome and whether it was actually done |
| `assignments` | Everything open, how long it has been quiet, what is overdue |

### The ledger is a fold over the journal

There is no state file, and this is the thing worth stealing from this agent.

An assignment is the replay of its own events. `ctx.note('assignment', …)`
appends; `ctx.history(200, 'agent.assignment')` reads them back; `ledger()`
folds them oldest-first into the current picture.

```ts
const noted = (kind: string): string => `agent.${kind}`;
```

`ctx.note` writes under `agent.<kind>` and `ctx.history` matches a kind
exactly. Write with the bare name, read with the prefix. Get this wrong and the
whole subsystem is write-only without a single error — everything appears to
work and every list comes back empty.

Why a fold rather than a file:

- **It survives compaction.** The journal is append-only sqlite on the
  workspace volume. A fresh session after a rotation sees exactly what a
  week-old one does.
- **It survives a hard kill.** There is no half-written state to repair.
- **It is auditable.** The human can read the journal and see what was asked,
  when, and what came back — the same events the agent is reasoning over.

### The ceiling is real, so it is reported

`ctx.history` clamps at 200. An assignment whose `opened` event has scrolled
out of that window is invisible to the fold. `assignments` counts orphaned
events and returns an `incomplete` message when the window is full.

Saying "nothing is outstanding" off a truncated list is the single worst thing
this agent could do, because it is the exact failure it exists to prevent. A
bounded read that does not say it is bounded is a lie with extra steps. If you
build anything on a capped history, make the cap visible in the output.

### Silence is measured from their last word, not ours

```ts
const silentForMinutes = minutesSince(assignment.heardAt ?? assignment.openedAt);
```

Measuring from our own last message would mean a chase resets the clock — so
the more times you nudged a dead agent, the healthier it would look, and it
would never once read as overdue. This is a one-line bug that inverts the
agent's entire purpose.

### Rooms resolve by whole word, and refuse when ambiguous

```ts
const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(hay);
```

Not `includes`. A substring test makes "Bee" match "Beekeeper", and a
one-letter name match every room on the list — which posts someone's work to
the wrong agent and then reports success.

When two rooms match, `resolveRoom` returns `null` with a reason rather than
picking the first. Guessing at a delivery address is the kind of error that is
invisible until the wrong agent does the wrong thing.

`follow_up` re-resolves by **agent name**, not by the stored room id, and
reports `reboundFrom` when the id has changed. That is the north star's "room
identity is asked for, never remembered" turned into three lines of code.

### A failed post must not open an assignment

```ts
const posted = await ctx.rooms.send(found.room.id, args.request);
if (posted === null || posted === undefined) { … }
```

Agent Update returns nothing at all when a send fails — dead room, refused
token, rate limit. Opening an assignment for a message that never left would
manufacture the one fact this agent must never invent: that somebody was asked.
Check the result. Every tool here that posts does.

### The empty list has two meanings

```ts
const EMPTY_MEANS =
  'No rooms came back. That is either no rooms, or Agent Update being unreachable, rate-limited or ' +
  'refusing the token — those look the same from here. Check before reporting anything about an agent.';
```

Returning `[]` and letting the model narrate it produces "you have no agents
configured", confidently, during an outage. Where an empty result is ambiguous,
return the ambiguity.

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

Drop the built-in `rooms` tool: `fleet` returns everything it did plus the
timings, and two tools that list rooms is one more thing for the model to
choose between. Delete `example.ts` and its import.

In `agent/manifest.ts`, replace the `AGENT_UPDATE_TOKEN` entry with the one
from [`settings.ts`](settings.ts) and delete the `WEBHOOK_TOKEN` and
`NOTES_DIR` placeholders.

Then `agent/AGENTS.md`. Keep the voice; add a `## Work you hand to an agent`
section with the loop, because this is the part the model gets wrong by
defaulting to helpfulness:

1. `delegate` to the agent that owns it. Set `expect_within_minutes` from what
   you know its normal to be. That opens an assignment.
2. Say you have asked, as one line of the reply you were already sending — not
   a second message, and not a `notify`. Do not wait.
3. When it replies: `heard` to record what it said, in its words. Then decide.
   Needs something from you? `follow_up`. Asked you something only the human
   can answer? `ask`, then `follow_up` with the answer. Finished? Close it.
4. `close_assignment` with `done: true` only when the agent said the work is
   finished. "I'll get to it" is not done. Time passing is not done.

Add one more rule while you are in there, because it is this agent's most
common failure: **a turn the human started ends with the answer.** Not a status
line, not "I'll let you know", not a tool call and silence. If you could not
get it, the answer is what you tried and what stopped you.

---

## 9. Day one

`## How it starts` says to trust nothing it was told about the fleet. That is
not humility, it is accuracy: a roster written during setup is stale the first
time an agent is renamed, and an agent that reports from a stale roster is
worse than one that reports nothing.

So: call `fleet`, ask each agent what it is for and what it has done this week,
read the folder it was started in, and write one memory note per agent — what
it does, where it lives, its room, what work belongs to it, and how long it
usually takes to answer. Mark anything unconfirmed as unconfirmed. Then show
the human the list and ask the two questions only he can answer: what is
missing, and who owns what.

That last number — how long each agent usually takes — is the one every future
`expect_within_minutes` comes from. Without it the agent can report silence but
never lateness, which is a much weaker product.

---

## 10. Schedules

One earns its place:

```
name:   sweep
cron:   0 9-18 * * 1-5
prompt: Call `assignments`. For anything overdue, decide: chase it with
        `follow_up`, or close it as abandoned with an outcome. If `incomplete`
        is set, search `history` before concluding anything. Message the human
        only if something is overdue or stuck — silence otherwise.
```

Hourly is right for this one and it is the exception, not the rule. Most
agents' schedules should be daily or weekly; this one exists to notice things
not happening, and a check that runs once a day can only notice a day late.

"Silence otherwise" is doing the same work it does in the calendar agent. A
sweep that reports "3 open, none overdue" every hour is a sweep the human
stops reading.

---

## 11. Test it

```sh
npm run check
npm run build
npm start -- setup
cd ~/somewhere/real && quartermaster
```

This agent needs two agents and a room to test properly, and there is no way
around that. What to check once you have them:

- **Delegate to a name that matches two rooms.** It must refuse and say why,
  not pick one.
- **Delegate to a name that matches nothing.** It must return the rooms that do
  exist, so the model can correct itself in one turn.
- **Delete the room in the app, then `follow_up`.** It must re-resolve, post to
  the new room, and report the rebind — not report the agent as silent.
- **Turn the other agent off and ask where the work is.** The answer must be
  "asked 40 minutes ago, nothing back" — never "it failed".
- **Let a peer post in the room.** Confirm this agent wakes, and confirm it
  does *not* post an automatic reply back into the room.
- **Open twelve assignments and never close them.** Confirm `incomplete` fires
  before the window silently truncates.

---

## 12. What breaks

**It does the work itself.** Reading the inbox is right there and faster than
asking. One sentence in the north star fixes it: if Librarian owns email, email
goes to Librarian even when you could read the inbox — and the only exception
is finding out why Librarian is not answering.

**It reports memory as observation.** "Librarian is running fine" from a note
written on Tuesday. The fix is a phrasing rule, not a capability: say when you
last checked, every time.

**It closes assignments on acknowledgements.** "On it" is not done. `done:
true` only on the agent saying the work is finished.

**It chases too fast.** Usually `expect_within_minutes` guessed instead of
learned. Leave it out until the number is real; unknown silence is honest and a
false deadline is not.

**Two agents talk forever.** If you see this, something is auto-replying to a
peer. The routing is deliberate — a peer-woken turn answers nobody unless the
agent chooses to — so a loop means a tool posted back into the room on every
turn without deciding to.

---

## What to steal from this one

The journal fold. Any agent that has to remember a commitment across a session
rotation — a promise made, an invoice sent, a question asked — should keep it as
appended events rather than as a file it rewrites, and should say out loud when
its read of those events is truncated.

---

Built on [Temper](https://github.com/wdorman-tech/Temper).
Reaching a phone is [Agent Update](https://tryagentupdate.com/docs/agents/quartermaster).
