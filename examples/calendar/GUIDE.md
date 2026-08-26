# Building the calendar agent

An agent that owns a calendar. It protects the hours where real work happens,
absorbs the scheduling back-and-forth, and tells the human the evening before
when tomorrow looks wrong.

You are a coding agent. This is the build, in order. Read
[`../../docs/BUILD_GUIDE.md`](../../docs/BUILD_GUIDE.md) first — this guide
assumes its standard and does not repeat it. The interface work in its §5 and
§8 is runtime debt, not part of building an agent; leave it alone unless you
were asked for it.

---

## 1. Why this job is hard

Almost everything a calendar agent does reaches another human. Moving a meeting
sends four people mail. Cancelling one sends mail nobody can unsend. Accepting
an invitation puts the human's name on an answer he did not write. There is no
undo for any of it, and the mistake is discovered by someone else.

The naive fix is to gate everything, and it is worse than not gating at all: an
agent that asks twenty times a day trains its human to tap Allow without
reading. Attention spent on approvals is a budget, and it is small.

So the whole design is one question asked well: **which changes reach another
person?** Those ask. The rest — his own focus blocks, his prep time, his travel
buffers — just happen, because a block with nobody on it notifies nobody.

That line is not a size threshold and it is not about importance. A five-minute
shortening of a client call reaches someone. Deleting a three-hour deep-work
block does not.

---

## 2. The interview

Get real answers before §5. The `NORTH_STAR.md` in this folder is one human's
answers, not a template to paste — a north star written from someone else's
week is the failure BUILD_GUIDE §2 is about.

- **Which calendar is the real one?** Often not `primary`. A work calendar on a
  personal account, or the reverse. Get the id.
- **Which other calendars can make him busy?** Shared, family, a partner's. An
  agent that checks one calendar and books over a birthday has technically not
  double-booked.
- **What are the hours, and what is sacred inside them?** Specifics: mornings,
  lunch, a standing block. "Protect my focus time" is not a rule.
- **What may it never do?** Names, not categories. "Never move anything with
  someone external on it. Never RSVP."
- **What does he never think to ask for?** This is the question that produces a
  good agent. Travel buffers, prep before a call he has not read for, a gap
  after a flight. **Get the number** — "real buffer" is not something an agent
  can act on.
- **What does a bad day look like, in numbers?** For this human: four
  back-to-back calls, and the fourth is where the decisions get worse.
- **His name, role and timezone.** All three end up in the north star, and
  `TEMPER_TZ` decides how every approval block reads.

---

## 3. Name it, before the first run

CLAUDE.md says three places. It is four, and one of them cannot be done yet.

1. `manifest.name` in `agent/manifest.ts` — the installation id. Names the
   image, the container and the volume.
2. `manifest.settings` — the `TEMPER_NAME` entry ships with
   `default: 'temper'` and the wizard prefills from it. Miss this one and the
   human presses enter through setup and gets an agent that calls itself
   `temper` on his phone. Change `manifest.tagline` while you are here; it is
   the line he reads on the first screen.
3. `package.json` — `name`, and the `bin` key:
   `"bin": { "calendar": "dist/src/cli.js" }`.
4. `.env` — **written by the wizard on the first run**, so there is nothing to
   edit yet. `.env.example` is the reference copy; fix `TEMPER_NAME` there.

`npm run build && npm link` belongs at the end of §10, not here — linking now
puts a command on `PATH` that has no tools behind it. `npm unlink -g temper`
clears the stale link, and takes the name the package was registered under,
which is still the old one. Finally fix `README.md`, which carries a dozen
`temper` references including the command table.

One trap specific to this agent: **macOS ships a `/usr/bin/calendar`.** Check
before you commit to the name — `command -v calendar` on macOS or Linux,
`Get-Command calendar` in PowerShell — and pick another if it collides. This
guide assumes it did not.

---

## 4. The split — three lanes, in the order they should be reached for

This is the design. Everything else follows from it.

| Lane | Tools | Asks before it acts? |
| --- | --- | --- |
| Read | `calendars`, `agenda`, `freebusy` | no |
| His own time | `hold` | no |
| Another person | `book`, `reschedule`, `cancel`, `rsvp` | yes — `effect: 'write'` |

Every one of them still raises a **credential** block the first time it reaches
Google, because `ctx.secret()` gates per tool. That is once per session, it is
not the effect gate, and §7 is how you keep it to three taps rather than
twenty-four.

BUILD_GUIDE §4 says to split read from write so the gate lands on the smallest
possible action. This splits *write* as well, because half the writes a
calendar agent makes are not addressed to anybody.

The runtime only distinguishes `effect: 'write'` from everything else — it
tests the exact string — so `'read'` and no `effect` field behave identically.
**Omit the field on `hold` rather than writing `effect: 'read'`.** `hold`
creates and deletes events; a type that calls that a read is a false statement
sitting in the file.

Get the boundaries right and two things follow. The human is asked roughly
twice a week instead of twenty times a day, so the asking still means
something. And `hold` — the ungated one — has to be incapable of the thing the
gate would otherwise catch, which is §8.

`agent/tools/index.ts` lists them in lane order, and that ordering matters: it
is the order the model reads them in, and the order it should reach for them.

---

## 5. Write the north star

`agent/NORTH_STAR.md`, from §2's answers, before any code.
[`NORTH_STAR.md`](NORTH_STAR.md) here is one human's; read it for the shape.
Four things in it do the work:

**The rule, in one sentence, first.** *If a change reaches another human, ask
first. If it touches only his own time, do it.* Everything under it is that
sentence made unambiguous.

**A never-list of specifics.** Invite anyone; move, shorten or cancel anything
with attendees *even by five minutes*; RSVP; touch a calendar that is not his.
A principle the model has to apply is a principle it can reason its way around.

**The mechanism named, and its bypasses pre-closed.** `hold` refuses events
with attendees; the refusal is the safety, not the prompt; do not go around it
with `curl`; do not strip the attendees off an event to make it editable, which
uninvites them. Naming a specific bypass costs one sentence.

**The priors it cannot discover.** Deep work belongs to mornings. Travel needs
45 minutes either side and he will not ask for it. Four calls in a row is the
failure mode. None of this is in the calendar, so an agent without it will
helpfully fill a Tuesday morning.

Three sections the boilerplate north star does not have, and this agent needs:

- **`## Status`.** The dashboard is free-form, so this file decides its
  content. `detail` is one line in his words; `metrics` is
  `today 4 · focus 6h · conflicts 1`.
- **`## Where it runs`**, and be honest in it: **this job does not live in a
  folder.** The agent still gets one, and its memory and journal belong to it,
  but nothing about the calendar depends on what is in it. Say so, or the model
  goes looking for a relationship that is not there.
- **`## How it starts`**, which is also where the recurring job in §11 has to
  be written, because a schedule the agent has not created does not exist.

Close on the correction rule: *he will correct these, and when he does that
correction outranks this file.* Without it the agent holds two rule sets with
no precedence and argues with `CORRECTIONS.md`.

---

## 6. Settings

[`settings.ts`](settings.ts) is one Google client — `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, all `scope: 'gated'` — plus
`CALENDAR_ID`, which is not. Those four key strings are what `ctx.secret()` and
`process.env` take in §7, so paste the entries into `agent/manifest.ts` before
you write the tools.

**None of the three is `optional`.** Right here, wrong in general: this agent
does nothing at all without a calendar, so a wizard the human can press enter
through would produce a broken install. Contrast
[`../librarian`](../librarian/GUIDE.md), where mail is a bonus and the same
three fields are optional. Get it backwards in either direction and setup
either cannot be finished or finishes into nothing.

`CALENDAR_ID` is ungated because it is an address, not a credential, and gating
it would leave the model unable to read the thing it must name in every
request. It arrives as a container environment variable, which is why
`calendarId()` needs no `ctx`.

The `how` is five clicks with the exact menu names. The `validate` on the client
id catches the most common paste error — the project number instead of the id —
at the keystroke rather than three screens later.

### The scope

[`settings.ts`](settings.ts) asks for
`https://www.googleapis.com/auth/calendar`: read/write across every calendar on
the account. That is broader than this agent needs, and it buys one consent
screen instead of three.

The narrower set is three scopes:

| Scope | What needs it |
| --- | --- |
| `.../auth/calendar.events` | everything under `events.*` — `agenda`, `hold`, `book`, `reschedule`, `cancel`, `rsvp` |
| `.../auth/calendar.calendarlist.readonly` | `calendars` |
| `.../auth/calendar.freebusy` | `freebusy` |

`calendar.events` **alone is not enough**: it is absent from the accepted
scopes for both `calendarList.list` and `freeBusy.query`, so an agent asking
only for it loses two of its three read tools. The scope is the ceiling on what
a bug can do, so if the human hesitates at the consent screen, this table is
the answer.

The refresh token comes from Google's OAuth playground — six clicks in a
developer tool, and the human pastes the result. A loopback consent flow the
wizard runs itself would be better and needs a field on `Setting` the runtime
does not have.

---

## 7. The tools

Eight, in `agent/tools/calendar.ts` — a new file next to `_kit.ts`. Here is the
contract; the reasoning is §8.

| Tool | Effect | Arguments | Returns |
| --- | --- | --- | --- |
| `calendars` | — | none | `{id, name, mine, access, timezone}[]` |
| `agenda` | — | `from`, `to`, `calendar?` | shaped events |
| `freebusy` | — | `from`, `to`, `calendars?: string[]` | `{calendar, busy, unreadable}[]` |
| `hold` | — | `action: 'create' \| 'move' \| 'release'`, `title?`, `start?`, `end?`, `event_id?`, `notes?`, `anyway?` | a sentence, or `{id, held}` |
| `book` | `write` | `title`, `start`, `end`, `attendees: string[]`, `notes?`, `location?` | `{id, invited}` |
| `reschedule` | `write` | `event_id`, `title`, `start`, `end`, `why` | a sentence |
| `cancel` | `write` | `event_id`, `title`, `why` | a sentence |
| `rsvp` | `write` | `event_id`, `response: 'accepted' \| 'declined' \| 'tentative'`, `title`, `note?` | a sentence |

All times are RFC3339 **with an offset**. Say so in every field description; a
naïve local time lands an hour out and nothing catches it.

`title` on the three gated tools that already take an `event_id` exists only so
the approval block can name what is changing. `why` is on `reschedule` and
`cancel` — the two that change something already agreed — and not on `book` or
`rsvp`, where the preview carries the whole decision on its own.

Every read returns a shaped event rather than Google's, and the field that
matters is `has_guests`. It is what tells the model which lane an event is in.

`hold`'s `release` deletes an event outright with no approval in front of it. It
is the one irreversible thing in the set that never asks, and it is safe only
because `mineAlone` has already established that nobody else is on it. Do not
fold a fourth action into this tool without re-deriving that.

### The API, in the order you need it

```
POST https://oauth2.googleapis.com/token
     form-encoded: client_id, client_secret, refresh_token, grant_type=refresh_token
     → { access_token, expires_in }

base: https://www.googleapis.com/calendar/v3
GET    /users/me/calendarList?minAccessRole=reader
GET    /calendars/{id}/events?timeMin&timeMax&singleEvents=true&orderBy=startTime&maxResults=2500
GET    /calendars/{id}/events/{eventId}
POST   /freeBusy                      body: { timeMin, timeMax, items: [{ id }] }
POST   /calendars/{id}/events?sendUpdates=…
PATCH  /calendars/{id}/events/{eventId}?sendUpdates=…
DELETE /calendars/{id}/events/{eventId}?sendUpdates=…
```

Four things in there are not optional.

**`sendUpdates=all` on every gated write.** Google notifies nobody without it.
Leave it off and the approval block is a lie: he approves *"and tell everyone on
it"*, the event moves, and no one is told. On `hold`, pass `sendUpdates=none`
explicitly — a block has nobody to notify, and the one tool with no approval in
front of it should not depend on `mineAlone` having been correct.

**`singleEvents=true` with `orderBy=startTime`.** It expands a recurring series
into instances, so an id addresses one occurrence and changing it leaves the
rest alone. `orderBy=startTime` is only accepted alongside it. Without this you
ship series-level ids and one reschedule moves every future Monday.

**Cache the access token at module scope.** `ctx.secret()` gates per tool *and*
per secret — the runtime keys on `` `${tool}:${name}` `` — so three gated
credentials across eight tools is up to twenty-four approval blocks before the
agent has done anything. One cached token, refreshed with a minute of headroom,
collapses that to three. **This is what makes §4's "asked twice a week" true.**

**`transparency: 'opaque'` on a created hold.** A focus block that reads as
*free* is invisible to `clash` and to everyone else's scheduling tool.

Three shapes to know: an all-day event carries `start.date`, not
`start.dateTime`; `attendees[].self` marks the owner; and a PATCH replaces an
array wholesale, which is why `rsvp` has to send every attendee back unchanged.

---

## 8. The rules that live in code

Two helpers in [`tools.ts`](tools.ts) enforce the never-list.

### `mineAlone` — the gate `hold` cannot argue with

```ts
async function mineAlone(ctx: Ctx, eventId: string): Promise<RawEvent> {
  const event = await getEvent(ctx, calendarId(), eventId);
  const others = guestCount(event);
  if (others > 0) {
    throw new Error(
      `"${event.summary ?? eventId}" has ${others} other people on it, so hold will not touch it. ` +
        'Changing it notifies them. Use reschedule or cancel, which ask first.',
    );
  }
  return event;
}
```

`hold` is ungated, so it is the tool to reach for when a gated one refuses. It
fetches the event and refuses before doing anything, and the refusal names the
tool that *is* allowed — an error that only says no leaves the agent to invent a
workaround. `guestCount()` counts attendees where `self` is false, so an event
with only the human on it has none — and it is named for what it returns,
because `guests(event) > 0` reads fine and is a silent bug for whoever
implements it as a list.

**Zero attendees is the whole test.** `hold` does not check who created the
event, so a solo entry the human made himself is inside the ungated lane. That
is the deliberate price of not asking about his own time, and it is worth
saying out loud at interview — "delete anything on my calendar with nobody else
on it, without asking" is a sentence some people will not agree to.

### `clash` — "never double-booked" as code

```ts
async function clash(ctx: Ctx, start: string, end: string, ignore?: string): Promise<RawEvent | null> {
  const existing = await listEvents(ctx, calendarId(), start, end);
  return (
    existing.find(
      (event) =>
        event.id !== ignore &&
        !allDay(event) &&
        event.transparency !== 'transparent' &&
        overlaps(start, end, when(event.start), when(event.end)),
    ) ?? null
  );
}
```

The north star promises the human he is never double-booked. A promise like that
belongs in a `throw`. Three exclusions are load-bearing: `ignore` is the event
being moved, all-day events are context rather than occupancy, and anything the
owner marked free is not a booking.

`clash` runs inside `hold`, `book` and `reschedule` — the three that put
something in a slot. Only `hold` takes an `anyway` escape, described in its
schema as *"Only when he explicitly asked for the overlap — never to get past a
refusal."* Write that sentence into the field description; it is the only place
the model reads it.

The order in `book` matters: check **before** the API call, so a refusal costs a
round trip rather than an invitation somebody has to recall.

---

## 9. Writing a preview for a lock screen

`2026-08-20T15:00:00-04:00` is not something anyone judges at a glance, and most
approvals are answered away from the desk:

```ts
preview: (args) => `move "${args.title}" to ${span(args.start, args.end)} and tell everyone on it — ${args.why}`
```

The supervisor frames it and posts to both surfaces at once. On the phone:

```
Approve · reschedule

move "Client review" to Thu 20 Aug 15:00–16:00 and tell everyone on it — clash with the board call

Tap an answer. No reply means no, and nothing runs.
```

and in the terminal, at the same moment:

```
approve · reschedule
move "Client review" to Thu 20 Aug 15:00–16:00 and tell everyone on it — clash with the board call
1 Allow once   2 No
pick one · no reply means no · also on your phone
```

`span()` formats in `TEMPER_TZ` and collapses a same-day range to one line. It
falls back to the raw ISO string rather than throwing, because an unknown
timezone should not stop an approval being asked. The runtime flattens a preview
to one line and caps it at 200 characters, so a long free-text `why` is
truncated rather than allowed to draw headings inside the block.

The frame is the supervisor's to draw. `ask` is ungated, so a model that could
write `Approve · …` into a plain question could compose a notification
indistinguishable from a real gate; `unframe` in `src/runtime/agentupdate.ts`
brackets any imitation. Worth knowing before you write a tool description
containing the word.

The rest of the approval contract — the options are the only answers, silence is
a refusal, `repeatable` is a real grant — is BUILD_GUIDE §4, and you inherit it.
Two consequences here: **require `why` on `reschedule` and `cancel`**, and
**none of the four is `repeatable`**.

---

## 10. Wire it up

```ts
// agent/tools/index.ts
import { agenda, book, calendars, cancel, freebusy, hold, reschedule, rsvp } from './calendar.ts';

export const tools: Tool[] = [
  ask, notify, status,
  remember, recall, forget,
  history,
  schedule, unschedule, schedules,
  rooms, roomSend,
  // read
  calendars, agenda, freebusy,
  // his own time — no approval
  hold,
  // other people — always asks
  book, reschedule, cancel, rsvp,
];
```

Do §7 first. Rewiring `index.ts` before the tool file exists leaves
`npm run check` broken in between, in a repo whose standard is that it is always
clean.

**Paste** the settings from [`settings.ts`](settings.ts) into
`agent/manifest.ts` — never import them. The image gets `src/protocol.ts`,
`src/runtime/` and `agent/`; `examples/` is in `.dockerignore` and is never
copied, so a value import from it typechecks on your machine and is missing at
runtime. Then delete the
`WEBHOOK_TOKEN` and `NOTES_DIR` placeholders and `agent/tools/example.ts` in the
same edit; the tool and the setting it uses are a pair. `.env.example` is the
same list of settings again, so fix it here too — a reference file that
disagrees with `manifest.ts` is worse than not having one.

Add a `## The calendar` section to `agent/AGENTS.md` — do not replace the file
and do not soften the voice. It says: the three lanes and what decides them;
read immediately before you write, because a slot that was free ten minutes ago
may not be; `freebusy` across every calendar, not just his own; always send a
UTC offset; never strip attendees; a recurring event id addresses one
occurrence, so ask before touching a series; and report the cost, not the
reasoning — *"Moved your 3pm to Thursday, told Sarah"* is the whole message.

Raise `model_reasoning_effort` to `"high"` in `agent/codex.toml`. This agent
makes judgement calls unattended and the cost of a bad one is somebody else's
morning.

Then `npm run build && npm link`, and the command exists.

---

## 11. Day one, and the schedule it writes itself

`## How it starts` is read-only on purpose: read eight weeks of calendar, change
nothing, write `memory/week-shape.md`, show it in under ten lines, then propose
three rules and wait for a yes on each.

Do not shorten it. The agent's first useful act is telling the human something
true about his own week that he had not noticed, and it buys the trust every
later approval spends.

The one recurring job goes in the same section, as an instruction rather than a
config file — there is nowhere in `agent/` to seed a schedule, so the agent
creates it by calling the `schedule` tool:

```
name:   check tomorrow
cron:   0 18 * * 0-4
prompt: Read tomorrow's agenda across every calendar in `calendars`. If it is
        wrong — no gap between calls, no lunch, four or more stacked, a 9am
        after travel, a meeting with no prep in front of it — send one message
        saying which and what you would do about it. If it is fine, say
        nothing.
```

"If it is fine, say nothing" is the important clause. A nightly message that
usually says *tomorrow looks fine* is a nightly message that gets muted, and
then the one that mattered is muted too.

Schedules are timers in this session, not a daemon. A 6pm check that fires at
9am the next day is worse than not firing, so say so in the prompt.

---

## 12. Test it

```sh
npm run check
npm run build
npm start -- setup         # needs Docker running: the preflight is before the wizard
cd ~/somewhere/real && calendar
```

The setup step is blocked without a running Docker daemon, so start it first —
the preflight runs before `onboard()` and you cannot reach the wizard at all.

What to check that is specific to this agent:

- **Ask it to move a meeting that has attendees, using `hold`.** It must refuse,
  and the refusal must send it to `reschedule`.
- **Ask it to book over an existing event.** It must refuse, name what is
  already there, and create nothing.
- **Trigger `reschedule` and read the approval on your phone.** Not on your
  screen. If you cannot decide from that one line, the preview is wrong.
- **Check the mail actually went.** Move an event with a second address on it
  and confirm that address received the update. This is the one failure that is
  invisible from inside the agent.
- **Reschedule one occurrence of a weekly meeting.** Next week must not move.
- **Cold-start it and exercise all eight tools.** Three credential blocks in
  total, not three per tool. `agenda` on its own costs three either way, so a
  test that stops there cannot see the bug.

---

## 13. What breaks

**It double-books anyway.** One calendar was checked and the busy one was
somewhere else. `freebusy` across every id from `calendars`, not `agenda` on
`primary`.

**Times land an hour out.** An RFC3339 string with no offset.

**Nobody is told.** A missing `sendUpdates=all`. The event moved, the approval
said otherwise, and the first person to find out is the attendee who turns up.

**The approvals get ignored.** Too many of them — usually the uncached token. If
`hold` is asking, a boundary is in the wrong place.

**A declined RSVP loses the other attendees.** A PATCH replaces the whole
`attendees` array, so the others have to be sent back unchanged.

---

## What to steal from this one

**The third lane.** Read-versus-write is the obvious split. The one worth
looking for is the write that reaches nobody: his own blocks here, a saved draft
in an inbox agent, a local ledger entry in a bookkeeping one. Those are real
effects with no audience, and leaving them ungated is what keeps the gate that
*does* matter rare enough to be read.

---

Built on [Temper](https://github.com/wdorman-tech/Temper).
Reaching a phone is [Agent Update](https://tryagentupdate.com/docs/agents/calendar).
