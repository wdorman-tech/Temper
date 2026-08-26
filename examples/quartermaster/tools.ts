import { type Ctx, defineTool, input } from '../../agent/tools/_kit.ts';

/**
 * A fleet manager: it hands work to the human's other agents and remembers
 * what it handed over.
 *
 * Nothing here is `effect: 'write'`, and that is not an oversight. Every one of
 * these posts into a room the human owns and reads — talking to them, or to an
 * agent in front of them, is not an effect on the world. Gating it would teach
 * them to tap Allow twenty times a day, which is how a gate stops meaning
 * anything. The effects live in the agents on the other end, behind their own
 * approvals.
 *
 * There is no state file. An assignment is the fold of its journal events,
 * replayed oldest first, because the journal is append-only and survives the
 * session rotation that wipes the model's context. A fresh session after a
 * compaction sees exactly what a week-old one does.
 */

/** `ctx.history` clamps here, so this is the real ceiling and it is visible. */
const LOOKBACK = 200;

/**
 * An empty room list has two causes that look identical from in here, and the
 * difference is the difference between "you have no agents" and "I could not
 * check". Never let the model pick the flattering one.
 */
const EMPTY_MEANS =
  'No rooms came back. That is either no rooms, or Agent Update being unreachable, rate-limited or ' +
  'refusing the token — those look the same from here. Check before reporting anything about an agent.';

type LiveRoom = { id: string; name: string; members?: { name?: string; role?: string }[] };

/** What `ctx.history` actually resolves to. See src/runtime/journal.ts. */
type JournalEvent = { id: number; at: string; kind: string; data: unknown };

/**
 * `ctx.note` writes under `agent.<kind>`; `ctx.history` matches a kind exactly.
 * Write with the bare name, read with this. Getting it wrong makes a whole
 * subsystem write-only without a single error.
 */
const noted = (kind: string): string => `agent.${kind}`;

const minutesSince = (iso: string): number =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

/* ---------------------------------------------------------------- the rooms */

async function liveRooms(ctx: Ctx): Promise<LiveRoom[]> {
  const rooms = (await ctx.rooms.list()) as LiveRoom[] | null;
  return Array.isArray(rooms) ? rooms : [];
}

const memberNames = (room: LiveRoom): string[] =>
  (room.members ?? []).map((member) => member.name ?? '').filter(Boolean);

/**
 * Whole-word match, never `includes`.
 *
 * A substring test makes "Bee" match "Beekeeper" and makes any one-letter name
 * match every room on the list — which posts someone's work to the wrong agent
 * and then reports success.
 */
export const mentions = (hay: string, needle: string): boolean => {
  const clean = needle.trim().toLowerCase();
  if (!clean) return false;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(hay);
};

/**
 * Room name plus member names. Members are optional on the wire, so this
 * degrades to matching on the room's name alone rather than throwing — a room
 * called "Will & Librarian" still resolves either way.
 */
const haystack = (room: LiveRoom): string =>
  [room.name, ...memberNames(room)].join(' ').toLowerCase();

/** Room names, quoted, so a refusal tells the model what it could have said. */
const names = (rooms: LiveRoom[]): string => rooms.map((room) => `"${room.name}"`).join(', ');

async function resolveRoom(
  ctx: Ctx,
  agent: string,
): Promise<{ room: LiveRoom | null; rooms: LiveRoom[]; reason?: string }> {
  const rooms = await liveRooms(ctx);
  const matches = rooms.filter((room) => mentions(haystack(room), agent));
  if (matches.length === 1) return { room: matches[0]!, rooms };

  // A refusal that only says no leaves the model to guess again. Both of these
  // say what exists, so it can correct itself in one turn instead of three.
  const reason = !rooms.length
    ? EMPTY_MEANS
    : matches.length === 0
      ? `No room reaches "${agent}". The rooms that exist right now are ${names(rooms)}. Use one of ` +
        'those names, or ask the human to make the room in the app — nobody can make one from here.'
      : `"${agent}" matches ${matches.length} rooms — ${names(matches)}. Not guessing. Ask which one, ` +
        'or use the exact room name.';
  return { room: null, rooms, reason };
}

/**
 * Readable, so the model can carry it across a turn without copying a uuid, and
 * so the human reading the journal can tell what an assignment was about.
 */
const newId = (agent: string): string => {
  const slug = agent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  // Random, not a truncated clock. `ledger()` keys by id, so two assignments
  // that collide are silently merged and one open item disappears — which is
  // the failure this agent exists to prevent, caused by its own id scheme.
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
};

/* ----------------------------------------------------------- the assignments */

type Heard = { at: string; what: string };

type Assignment = {
  id: string;
  agent: string;
  room: string;
  roomId: string;
  request: string;
  openedAt: string;
  lastSentAt: string;
  chases: number;
  heard: Heard[];
  heardAt: string | null;
  expectMinutes: number | null;
  closed: { at: string; outcome: string; done: boolean } | null;
};

type Step = {
  id?: string;
  step?: string;
  agent?: string;
  room?: string;
  roomId?: string;
  request?: string;
  expectMinutes?: number | null;
  what?: string;
  outcome?: string;
  done?: boolean;
};

/**
 * Replay the ledger.
 *
 * `ctx.history` is newest first and capped, so this reverses it and reports
 * when the window was full — an assignment whose `opened` event has scrolled
 * out is invisible here, and silently returning a short list is exactly the
 * failure this agent exists to prevent.
 */
async function ledger(ctx: Ctx): Promise<{ list: Assignment[]; saturated: boolean; orphaned: number }> {
  const events = ((await ctx.history(LOOKBACK, noted('assignment'))) as JournalEvent[] | null) ?? [];
  const saturated = events.length >= LOOKBACK;
  const byId = new Map<string, Assignment>();
  let orphaned = 0;

  for (const event of [...events].reverse()) {
    const step = (event.data ?? {}) as Step;
    if (!step.id) continue;
    if (step.step === 'opened') {
      byId.set(step.id, {
        id: step.id,
        agent: step.agent ?? '',
        room: step.room ?? '',
        roomId: step.roomId ?? '',
        request: step.request ?? '',
        openedAt: event.at,
        lastSentAt: event.at,
        chases: 0,
        heard: [],
        heardAt: null,
        expectMinutes: step.expectMinutes ?? null,
        closed: null,
      });
      continue;
    }
    const assignment = byId.get(step.id);
    if (!assignment) {
      orphaned += 1;
      continue;
    }
    if (step.step === 'followed_up') {
      assignment.chases += 1;
      assignment.lastSentAt = event.at;
      if (step.roomId) assignment.roomId = step.roomId;
    } else if (step.step === 'heard') {
      assignment.heard.push({ at: event.at, what: step.what ?? '' });
      assignment.heardAt = event.at;
    } else if (step.step === 'closed') {
      assignment.closed = { at: event.at, outcome: step.outcome ?? '', done: step.done === true };
    }
  }

  return { list: [...byId.values()], saturated, orphaned };
}

const isOpen = (assignment: Assignment): boolean => assignment.closed === null;

function view(assignment: Assignment) {
  // Their silence, not ours. Measuring from our own last message would mean a
  // chase resets the clock — so the more times you nudged a dead agent, the
  // healthier it would look, and it would never once read as overdue.
  const silentForMinutes = minutesSince(assignment.heardAt ?? assignment.openedAt);
  return {
    id: assignment.id,
    agent: assignment.agent,
    room: assignment.room,
    request: assignment.request,
    openedMinutesAgo: minutesSince(assignment.openedAt),
    silentForMinutes,
    lastChasedMinutesAgo: assignment.chases ? minutesSince(assignment.lastSentAt) : null,
    chases: assignment.chases,
    heard: assignment.heard,
    expectMinutes: assignment.expectMinutes,
    // Only ever true when you said what to expect. Without that this is silence
    // of an unknown duration, which is not the same thing as being late.
    overdue:
      isOpen(assignment) &&
      assignment.expectMinutes !== null &&
      silentForMinutes > assignment.expectMinutes,
    closed: assignment.closed,
  };
}

const noSuch = (id: string, list: Assignment[]) => ({
  ok: false,
  reason: `No open assignment "${id}".`,
  open: list.filter(isOpen).map((a) => ({ id: a.id, agent: a.agent, request: a.request })),
});

/* -------------------------------------------------------------------- tools */

export const fleet = defineTool<Record<string, never>>({
  name: 'fleet',
  description:
    'The company of agents as it stands right now: every room that exists, who is in it, when you ' +
    'last sent each agent something and when it last actually said something to you. Rooms are ' +
    'read live; the timings come from your journal. Use this before reporting on anyone, and ' +
    'report the ages, not just the facts — a fresh number and a three-day-old one read the same ' +
    'in a sentence. Room ids for `room_send` come from here.',
  input: input({}),
  run: async (_args, ctx) => {
    const rooms = await liveRooms(ctx);
    const heard = ((await ctx.history(LOOKBACK, 'room.heard')) as JournalEvent[] | null) ?? [];

    const lastHeardIn = (room: LiveRoom): { from: string; minutesAgo: number } | null => {
      for (const event of heard) {
        const data = (event.data ?? {}) as { from?: string; room?: string };
        if (data.room === room.name) {
          return { from: data.from ?? 'unknown', minutesAgo: minutesSince(event.at) };
        }
      }
      return null;
    };

    const { list } = await ledger(ctx);
    return {
      checkedAt: new Date().toISOString(),
      // Names and roles, not the whole room record. A role is what an agent was
      // brought into the room to do, so it is the half of a member that decides
      // whether this is the agent you meant.
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        members: (room.members ?? []).map((m) => (m.role ? `${m.name} (${m.role})` : m.name)),
        lastHeard: lastHeardIn(room),
        openAssignments: list.filter((a) => isOpen(a) && a.roomId === room.id).length,
      })),
      note: rooms.length ? undefined : EMPTY_MEANS,
    };
  },
});

export const delegate = defineTool<{ agent: string; request: string; expect_within_minutes?: number }>({
  name: 'delegate',
  description:
    'Hand a piece of work to one of the agents and start tracking it. Finds their room live, posts ' +
    'the request, and opens an assignment that stays open until you close it. This is how ' +
    'everything reaches another agent, including plain questions — a question nobody answered is ' +
    'the thing you are here to notice. It does not wait for a reply and neither do you: tell the ' +
    'human you have asked, then carry on. The reply arrives later as room traffic and wakes you.',
  input: input({
    agent: { type: 'string', description: 'The agent by name, e.g. "librarian". Matched against room and member names.' },
    request: { type: 'string', description: 'What you want done, in one or two sentences. The human reads this room.' },
    expect_within_minutes: {
      type: 'number',
      description:
        'How long a reply should take for this agent and this kind of work — from what you know its ' +
        'normal to be, not a guess. Past this the assignment reads as overdue. Leave it out if you ' +
        'do not know; unknown silence is not the same as late.',
      optional: true,
    },
  }),
  run: async (args, ctx) => {
    const found = await resolveRoom(ctx, args.agent);
    if (!found.room) {
      await ctx.note('assignment.unresolved', { agent: args.agent, reason: found.reason });
      return {
        ok: false,
        reason: found.reason,
        rooms: found.rooms.map((room) => ({ id: room.id, name: room.name })),
      };
    }

    // A failed post comes back as nothing rather than as an error. Opening an
    // assignment for a message that never left would manufacture the one fact
    // this agent must never invent: that somebody was asked.
    const posted = await ctx.rooms.send(found.room.id, args.request);
    if (posted === null || posted === undefined) {
      await ctx.note('assignment.undelivered', { agent: args.agent, room: found.room.name });
      return {
        ok: false,
        reason:
          `The post to ${found.room.name} did not go through, so nothing was opened and ${args.agent} ` +
          'has not been asked. Agent Update refused it, is rate-limited, or that room is gone. Call ' +
          '`fleet` and retry.',
      };
    }

    const id = newId(args.agent);
    await ctx.note('assignment', {
      id,
      step: 'opened',
      agent: args.agent,
      room: found.room.name,
      roomId: found.room.id,
      request: args.request,
      expectMinutes: args.expect_within_minutes ?? null,
    });
    return { ok: true, id, agent: args.agent, room: found.room.name };
  },
});

export const followUp = defineTool<{ id: string; message: string }>({
  name: 'follow_up',
  description:
    'Say something else on an open assignment — answer a question the agent asked you, add what it ' +
    'needs, or chase it because it has gone quiet. Re-finds the room live, so a room re-made in ' +
    'the app repairs itself here. Chasing an agent that is merely slow is noise: know its normal ' +
    'before you nudge.',
  input: input({
    id: { type: 'string', description: 'Assignment id from `delegate` or `assignments`.' },
    message: { type: 'string', description: 'What to say. Short — the human reads this room too.' },
  }),
  run: async (args, ctx) => {
    const { list } = await ledger(ctx);
    const assignment = list.find((a) => a.id === args.id && isOpen(a));
    if (!assignment) return noSuch(args.id, list);

    // The agent, not the stored id, is the durable handle on a room. A room
    // re-made in the app has a new id and the same people in it.
    const found = await resolveRoom(ctx, assignment.agent);
    if (!found.room) return { ok: false, reason: found.reason };

    const posted = await ctx.rooms.send(found.room.id, args.message);
    if (posted === null || posted === undefined) {
      return {
        ok: false,
        reason:
          `The post to ${found.room.name} did not go through, so ${assignment.agent} has not seen ` +
          'this. The assignment is untouched. Call `fleet` and retry.',
      };
    }

    const rebound = found.room.id !== assignment.roomId ? assignment.roomId : undefined;
    await ctx.note('assignment', { id: args.id, step: 'followed_up', roomId: found.room.id });
    return { ok: true, id: args.id, agent: assignment.agent, reboundFrom: rebound };
  },
});

export const heard = defineTool<{ id: string; what_they_said: string }>({
  name: 'heard',
  description:
    'Record what an agent actually said on an assignment, in its words, when its reply does not ' +
    'finish the job. This is what makes silence measurable, and what a future you — after the ' +
    'session has been compacted — reads instead of guessing. Recording is not closing: if the work ' +
    'is done, close it.',
  input: input({
    id: { type: 'string', description: 'Assignment id.' },
    what_they_said: {
      type: 'string',
      description: 'Their reply, or the substance of it. Do not paraphrase it into good news.',
    },
  }),
  run: async (args, ctx) => {
    const { list } = await ledger(ctx);
    const assignment = list.find((a) => a.id === args.id && isOpen(a));
    if (!assignment) return noSuch(args.id, list);
    await ctx.note('assignment', { id: args.id, step: 'heard', what: args.what_they_said });
    return { ok: true, id: args.id, agent: assignment.agent };
  },
});

export const closeAssignment = defineTool<{ id: string; outcome: string; done: boolean }>({
  name: 'close_assignment',
  description:
    'Close an assignment. `done: true` only when the agent said the work is finished — not when it ' +
    'said it would start, and not because enough time has passed. `done: false` closes it as ' +
    'abandoned or superseded, and the outcome is what you would tell the human if they asked why ' +
    'nothing happened.',
  input: input({
    id: { type: 'string', description: 'Assignment id.' },
    outcome: { type: 'string', description: 'One line: what actually happened. This is the record.' },
    done: { type: 'boolean', description: 'True only if the work was actually completed.' },
  }),
  run: async (args, ctx) => {
    const { list } = await ledger(ctx);
    const assignment = list.find((a) => a.id === args.id && isOpen(a));
    if (!assignment) return noSuch(args.id, list);
    await ctx.note('assignment', {
      id: args.id,
      step: 'closed',
      outcome: args.outcome,
      done: args.done,
    });
    return { ok: true, id: args.id, agent: assignment.agent, done: args.done };
  },
});

export const assignments = defineTool<{ include_closed?: boolean }>({
  name: 'assignments',
  description:
    'Everything you have handed to another agent and not yet closed: what was asked, how long ago, ' +
    'whether anything has come back, and which are overdue. Check this when an agent posts in a ' +
    'room, when the human asks where something is, and on every sweep. An open assignment nobody ' +
    'is watching is the failure this agent exists to prevent.',
  input: input({
    include_closed: {
      type: 'boolean',
      description: 'Also return closed ones, newest first. Default false.',
      optional: true,
    },
  }),
  run: async (args, ctx) => {
    const { list, saturated, orphaned } = await ledger(ctx);
    const open = list.filter(isOpen).map(view);
    return {
      checkedAt: new Date().toISOString(),
      open,
      overdue: open.filter((a) => a.overdue).map((a) => a.id),
      neverAnswered: open.filter((a) => !a.heard.length).length,
      closed: args.include_closed ? list.filter((a) => !isOpen(a)).map(view).reverse() : undefined,
      // Saying "nothing is outstanding" off a truncated list is the one lie
      // this tool could tell, so it says when it cannot see the whole ledger.
      incomplete:
        saturated || orphaned > 0
          ? [
              saturated
                ? `The journal window holds ${LOOKBACK} assignment events and it is full.`
                : null,
              orphaned
                ? `${orphaned} event(s) belong to assignments older than the window.`
                : null,
              'Older open assignments are missing from this list. Close what is finished so the ' +
                'window clears, and search `history` before telling them nothing is outstanding.',
            ]
              .filter(Boolean)
              .join(' ')
          : undefined,
    };
  },
});
