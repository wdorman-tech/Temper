# Building the calendar agent

An agent that owns a calendar. It protects the hours where real work happens,
absorbs the scheduling back-and-forth, and tells the human the evening before
when tomorrow looks wrong.

You are a coding agent. This is the whole build, in order, with the reasoning.
Read [`../../docs/BUILD_GUIDE.md`](../../docs/BUILD_GUIDE.md) first — this
guide assumes its standard and does not repeat it.

---

## 1. Why this job is hard

Almost everything a calendar agent does reaches another human. Moving a meeting
sends four people mail. Cancelling one sends mail nobody can unsend. Accepting
an invitation puts the human's name on an answer he did not write. There is no
undo for any of it, and the mistake is discovered by someone else.

The naive fix is to gate everything, and it fails in a way that is worse than
not gating at all: an agent that asks twenty times a day trains its human to
tap Allow without reading. By the time it asks about something that matters,
the reflex is already built. Attention spent on approvals is a budget, and it
is small.

So the whole design is one question asked well: **which changes reach another
person?** Those ask. The rest — his own focus blocks, his prep time, his travel
buffers — just happen, because a block with nobody on it notifies nobody.

That line is not a size threshold and it is not about importance. A five-minute
shortening of a client call reaches someone. Deleting a three-hour deep-work
block does not.

---

## 2. The interview

- **Which calendar is the real one?** Often not `primary`. A work calendar on a
  personal account, or the reverse.
- **Which other calendars can make him busy?** Shared, family, a partner's. An
  agent that checks one calendar and books over a birthday has technically not
  double-booked.
- **What are the hours, and what is sacred inside them?** Get the specifics:
  mornings, lunch, a standing block. "Protect my focus time" is not a rule.
- **What may it never do?** Names, not categories. "Never move anything with
  someone external on it. Never RSVP."
- **What does he never think to ask for?** This is the question that produces
  a good agent. Travel buffers, prep time before a call he has not read for, a
  gap after a flight.
- **What does a bad day look like, in numbers?** For this human: four
  back-to-back calls, and the fourth is where the decisions get worse.

---

## 3. Name it, before the first run

Three places, per [CLAUDE.md](../../CLAUDE.md): `manifest.name`, `package.json`
(`name` and the `bin` key), and `TEMPER_NAME` in `.env`. Then
`npm run build && npm link`, and `npm unlink -g temper`.

One trap specific to this agent: `calendar` may collide with something already
on the human's `PATH`. Check with `command -v calendar` before you commit to
the name, and use something like `cal-agent` if it does.

---

## 4. The split — three lanes, in the order they should be reached for

This is the design. Everything else follows from it.

| Lane | Tools | Gate |
| --- | --- | --- |
| Read | `calendars`, `agenda`, `freebusy` | none |
| His own time | `hold` | **none** |
| Another person | `book`, `reschedule`, `cancel`, `rsvp` | `effect: 'write'` |

BUILD_GUIDE §4 says to split read from write so the gate lands on the smallest
possible action. This goes one step further and splits *write* as well, because
half the writes a calendar agent makes are not addressed to anybody.

Get the boundaries right and two things follow. The human is asked roughly
twice a week instead of twenty times a day, so the asking still means
something. And `hold` — the ungated one — has to be incapable of the thing the
gate would otherwise catch, which is what §7 is about.

`agent/tools/index.ts` lists them in lane order, and that ordering is not
cosmetic: it is the order the model reads them in, and it is the order it
should reach for them.

---

## 5. The north star

[`NORTH_STAR.md`](NORTH_STAR.md) carries the rule in one sentence and then
spends the rest of the file making it unambiguous.

> if a change reaches another human, ask first. If it touches only his own
> time, do it.

Under it, the never-list is specific — invite anyone, move or shorten or cancel
anything with attendees *even by five minutes*, RSVP, touch a calendar that is
not his — because a principle the model has to apply is a principle it can
reason its way around, and a list is a list.

Three parts do disproportionate work:

**The mechanism is named, and so are its bypasses.** The file says `hold`
refuses events with attendees, that the refusal is the safety rather than the
prompt, and then closes the two doors the model would otherwise find: do not go
around it with `curl`, and do not strip the attendees off an event to make it
editable — that uninvites them, which is the thing the rule exists to stop.
Pre-closing a specific bypass costs one sentence.

**The priors it cannot discover.** That deep work belongs to mornings. That
travel needs real buffer and he will not think to ask. That four calls in a row
is the failure mode. None of this is in the calendar, so none of it is
derivable, and an agent without it will helpfully fill a Tuesday morning.

**A live correction outranks the file.** "He will correct these. When he does,
that correction outranks this file." Without that line the agent has two rule
sets and no precedence, and `CORRECTIONS.md` becomes something it argues with.

Note the `## Status` section. The dashboard is free-form because the runtime
has no opinion about what matters, so the north star decides: `detail` is one
line in his words, `metrics` is `today 4 · focus 6h · conflicts 1`. Numbers,
not prose. Write this during the interview and the dashboard configures itself.

---

## 6. Settings

[`settings.ts`](settings.ts) is one Google client — id, secret, refresh token —
all `scope: 'gated'`, plus `CALENDAR_ID`, which is not.

That last one is the interesting choice. `CALENDAR_ID` is an address, not a
credential; gating it would mean the model cannot read the thing it needs to
name in every request. Gate what spends money or speaks to a person, not
everything that arrives from the wizard.

The three gated ones are held by the supervisor and handed to a tool inside a
call the human approved. `env` in the agent's own shell shows nothing. That is
the property that makes this agent's boundary close to a wall rather than a
fence: the model can decide to skip the tools and use `curl`, and find it has
nothing to authenticate with.

Say the boundary precisely and do not oversell it. The supervisor runs *inside*
the container, so gating stops the shell and the model from reading a value; it
is not a defence against the container itself being compromised.

The `how` is five clicks with the exact menu names, because the wizard is the
only documentation most people read and a setting whose instructions are "get
an API key" is where they give up. The `validate` on the client id catches the
most common paste error — the project number instead of the id — at the
keystroke rather than three screens later.

The example asks for `https://www.googleapis.com/auth/calendar`, which is
read/write across the account's calendars. It needs the broad one because
`calendars` reads the calendar list. If you drop that tool, check Google's
current scope list for a narrower pair and ask for the smallest that works —
the scope is the ceiling on what a bug can do.

One honest limitation: the human gets the refresh token from Google's OAuth
playground, six clicks in a developer tool, and pastes it. A loopback consent
flow the wizard runs itself would be better and needs a field on `Setting` that
the runtime does not have.

---

## 7. The rules that live in code

Two helpers in [`tools.ts`](tools.ts) are where the north star stops being
prose.

### `mineAlone` — the gate `hold` cannot argue with

```ts
async function mineAlone(ctx: Ctx, eventId: string): Promise<RawEvent> {
  const event = await getEvent(ctx, calendarId(), eventId);
  const others = guests(event);
  if (others > 0) {
    throw new Error(
      `"${event.summary ?? eventId}" has ${others} other people on it, so hold will not touch it. ` +
        'Changing it notifies them. Use reschedule or cancel, which ask first.',
    );
  }
  return event;
}
```

`hold` is ungated, so it is the tool a model under pressure would reach for to
move a client call at 3am. It fetches the event and refuses before doing
anything. The refusal names the tool that *is* allowed, because an error that
only says no leaves the agent to invent a workaround.

`guests()` counts attendees where `self` is false. An event with only the human
on it has no guests even though the array is not empty.

### `clash` — "never double-booked" as code

```ts
async function clash(ctx: Ctx, start: string, end: string, ignore?: string): Promise<RawEvent | null> {
  const existing = await listEvents(ctx, calendarId(), start, end);
  return existing.find((event) =>
    event.id !== ignore &&
    !allDay(event) &&
    event.transparency !== 'transparent' &&
    overlaps(start, end, when(event.start), when(event.end)),
  ) ?? null;
}
```

The north star promises the human he is never double-booked. A promise like
that belongs in a `throw`, not in a paragraph. Three exclusions are load-bearing:
`ignore` is the event being moved (it always overlaps itself), all-day events
are context rather than occupancy, and anything the owner marked free is not a
booking.

`clash` runs inside `hold`, `book` and `reschedule` — the three tools that put
something in a slot. `hold` alone takes an `anyway` escape, described in its
schema as *"Only when he explicitly asked for the overlap — never to get past a
refusal."* Write that sentence into the field description; it is the only place
the model reads it.

The order in `book` matters: check the clash **before** the API call, so a
refusal costs a round trip rather than an invitation that has to be recalled.

---

## 8. Writing a preview for a lock screen

The approval block is the entire security interface for a gated call, and most
approvals are answered away from the desk, with no thread above the block. So
`2026-08-20T15:00:00-04:00` is useless, and this is not cosmetic:

```ts
preview: (args) => `move "${args.title}" to ${span(args.start, args.end)} and tell everyone on it — ${args.why}`
```

which renders as

```
approve · reschedule
move "Client review" to Thu 20 Aug 15:00–16:00 and tell everyone on it — clash with the board call
1 Allow once   2 No
pick one · no reply means no · also on your phone
```

`span()` formats in the human's timezone and collapses a same-day range to one
line. It falls back to the raw ISO string rather than throwing, because an
unknown timezone should not stop an approval being asked.

Three things about that block you inherit rather than implement, and have to
design for:

- **The options are the only answers.** An approval resolves by exact match or
  by number. Prose is not a vote — a reply of "sure, go ahead" reports back to
  the agent as *did not run*, along with what the human said.
- **Silence is a refusal.** After an hour it comes back as no, and the agent is
  told not to retry until someone actually chooses.
- **The `why` argument exists for this line.** It is the difference between an
  approval he can judge in two seconds and one he has to open the calendar for.
  Require it.

None of the four gated tools is `repeatable`. "Allow all session" would approve
that tool for *any* arguments until the process dies, which is right for
`refresh_cache` and wrong for anything that sends mail.

---

## 9. Wire it up

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

Delete `example.ts` and its import. Paste the four settings from
[`settings.ts`](settings.ts) into `agent/manifest.ts` — paste, do not import,
because `agent/` is mounted into the container and `examples/` is not — and
delete the `WEBHOOK_TOKEN` and `NOTES_DIR` placeholders.

Add a `## The calendar` section to `agent/AGENTS.md`. Do not replace the file
and do not soften the voice. It says: the three lanes and what decides them;
read immediately before you write, because a slot that was free ten minutes ago
may not be; `freebusy` across every calendar, not just his own; always send a
UTC offset; never strip attendees; a recurring event id addresses one
occurrence, so ask before touching a series; and report the cost, not the
reasoning — *"Moved your 3pm to Thursday, told Sarah"* is the whole message.

Raise `model_reasoning_effort` to `"high"` in `agent/codex.toml`. This agent
makes judgement calls unattended and the cost of a bad one is somebody else's
morning.

---

## 10. Day one

`## How it starts` in the north star is read-only on purpose: read eight weeks
of calendar, change nothing, write `memory/week-shape.md`, show it in under ten
lines, then propose three rules and wait for a yes on each.

Do not shorten this. The agent's first useful act is telling the human
something true about his own week that he had not noticed, and it buys the
trust that every later approval spends. An agent that starts enforcing rules
nobody agreed to is the fastest way to get uninstalled.

---

## 11. Schedules

The agent writes its own. The one the north star implies:

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
usually says "tomorrow looks fine" is a nightly message that gets muted, and
then the one that mattered is muted too.

Schedules are timers in this session, not a daemon. With the terminal closed
the agent is not running; on the next start it is told what came due and
decides whether catching up still makes sense. A 6pm check that fires at 9am
the next day is worse than not firing, so say so in the prompt.

---

## 12. Test it

```sh
npm run check              # types. clean, always.
npm run build
npm start -- setup         # walk the wizard as a new user, including a cancel
cd ~/somewhere/real && cal-agent
```

Then the tests that are specific to this agent:

- **Ask it to move a meeting that has attendees, using `hold`.** It must
  refuse, and the refusal must send it to `reschedule`.
- **Ask it to book over an existing event.** It must refuse and name what is
  already there.
- **Trigger `reschedule` and read the approval on your phone.** Not on your
  screen. If you cannot decide from that one line, the preview is wrong.
- **Reply to an approval with a sentence instead of tapping.** Nothing must
  run, and the agent must ask again rather than interpret.
- **Ignore an approval for an hour.** It comes back as a refusal. Confirm the
  agent does not retry.
- **Decline a credential.** The tool must fail and the agent must say so, not
  report a booking it did not make.

---

## 13. What breaks

**It double-books anyway.** Almost always one calendar was checked and the busy
one was somewhere else. `freebusy` across every id from `calendars`, not
`agenda` on `primary`.

**Times land an hour out.** An RFC3339 string with no offset. Require the
offset in every field description and reject anything else.

**A recurring meeting moves for everyone.** `singleEvents: 'true'` expands a
series so an id addresses one occurrence, which is what you want — but only if
the agent understands that changing the series is a different, unasked-for
operation. Say it in `AGENTS.md`.

**The approvals get ignored.** Too many of them. Look at what is being asked
about: if `hold` is asking, a boundary is in the wrong place.

**A declined RSVP loses the other attendees.** Patching `attendees` replaces
the whole array, so the others have to be sent back unchanged. `rsvp` in
[`tools.ts`](tools.ts) rebuilds the full list for exactly this reason.

---

## What to steal from this one

The three lanes. Most agents that "manage" something have a similar seam in
them — an inbox agent has drafts and sends, a bookkeeping agent has
reconciliation and payment — and finding it is worth more than any amount of
prompt engineering, because it is what makes the gate rare enough to be read.

---

Built on [Temper](https://github.com/wdorman-tech/Temper).
Reaching a phone is [Agent Update](https://tryagentupdate.com/docs/agents/calendar).
