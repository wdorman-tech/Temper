import { type Ctx, defineTool, input } from '../../agent/tools/_kit.ts';

/**
 * Google Calendar, split by who a change reaches.
 *
 * Reading is free. Changing his own time is free, because a block with nobody
 * on it notifies nobody. Anything with another person on it is `effect:
 * 'write'` and stops for an approval, because it puts mail in someone else's
 * inbox and there is no undo for that.
 *
 * Two of the rules in NORTH_STAR.md are enforced here rather than hoped for:
 * `mineAlone` refuses to let the ungated tool touch an event with attendees,
 * and `clash` refuses to create a double-booking. A promise the model can talk
 * itself out of is not a promise.
 */

const API = 'https://www.googleapis.com/calendar/v3';

/** The calendar it writes to. An address, not a credential — see settings.ts. */
const calendarId = (): string => process.env.CALENDAR_ID || 'primary';

/** Set from the host's timezone at boot, so times read the way he reads them. */
const timeZone = (): string => process.env.TEMPER_TZ || 'UTC';

/* ------------------------------------------------------------------- google */

let cached: { token: string; until: number } | null = null;

async function token(ctx: Ctx): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: await ctx.secret('GOOGLE_CLIENT_ID'),
      client_secret: await ctx.secret('GOOGLE_CLIENT_SECRET'),
      refresh_token: await ctx.secret('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token) {
    throw new Error(`Google refused the refresh token: ${JSON.stringify(body).slice(0, 300)}`);
  }
  // A minute of slack, so a token cannot expire between here and the request.
  cached = { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000 };
  return cached.token;
}

async function call(ctx: Ctx, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token(ctx)}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const text = await response.text(); // deletes come back 204 with no body
  if (!response.ok) {
    // Surface Google's own sentence. "calendar 403" on its own has never
    // helped anyone work out what to do next.
    throw new Error(`calendar ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/* -------------------------------------------------------------------- shape */

type RawEvent = {
  id?: string;
  summary?: string;
  status?: string;
  location?: string;
  transparency?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[];
};

const when = (edge: RawEvent['start']): string => edge?.dateTime ?? edge?.date ?? '';
const allDay = (event: RawEvent): boolean => Boolean(event.start?.date);

/** The line that decides which tool may touch an event. */
const guests = (event: RawEvent): number => (event.attendees ?? []).filter((a) => !a.self).length;

const shape = (event: RawEvent) => ({
  id: event.id,
  title: event.summary,
  start: when(event.start),
  end: when(event.end),
  all_day: allDay(event),
  has_guests: guests(event) > 0,
  attendees: (event.attendees ?? []).map((a) => a.email),
  my_response: (event.attendees ?? []).find((a) => a.self)?.responseStatus ?? null,
  i_organize: event.organizer?.self === true,
  busy: event.transparency !== 'transparent',
  recurring: Boolean(event.recurringEventId),
  location: event.location ?? null,
});

async function listEvents(ctx: Ctx, id: string, from: string, to: string): Promise<RawEvent[]> {
  const query = new URLSearchParams({
    timeMin: from,
    timeMax: to,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  });
  const body = await call(ctx, `/calendars/${encodeURIComponent(id)}/events?${query.toString()}`);
  const items = (body.items ?? []) as RawEvent[];
  return items.filter((event) => event.status !== 'cancelled');
}

async function getEvent(ctx: Ctx, id: string, eventId: string): Promise<RawEvent> {
  return (await call(ctx, `/calendars/${encodeURIComponent(id)}/events/${eventId}`)) as RawEvent;
}

/* ------------------------------------------------------------------- guards */

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean =>
  new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

/**
 * "Nothing is ever double-booked" is a promise in the north star, so it is
 * checked rather than hoped for. All-day events and anything marked free do
 * not count: they are context, not occupancy.
 */
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

/**
 * The gate `hold` cannot talk its way past.
 *
 * Anything with someone else on it belongs to `reschedule` or `cancel`, both
 * of which ask. Stripping the attendees off an event to make it editable would
 * also uninvite them, so that door is closed here too.
 */
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

/* --------------------------------------------------------------- lock screen */

/**
 * The approval block is the entire security interface for a call, and it is
 * usually read on a phone with no thread above it. `2026-08-20T15:00:00-04:00`
 * is not something anyone judges at a glance.
 */
function clock(iso: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timeZone() }).format(new Date(iso));
  } catch {
    return iso; // An unknown timezone should not stop an approval being asked.
  }
}

function span(start: string, end: string): string {
  const day = clock(start, { weekday: 'short', day: 'numeric', month: 'short' });
  const from = clock(start, { hour: '2-digit', minute: '2-digit' });
  const to = clock(end, { hour: '2-digit', minute: '2-digit' });
  const sameDay = clock(end, { weekday: 'short', day: 'numeric', month: 'short' }) === day;
  return sameDay ? `${day} ${from}–${to}` : `${day} ${from} → ${clock(end, { weekday: 'short', day: 'numeric', month: 'short' })} ${to}`;
}

/* --------------------------------------------------------------------- read */

export const calendars = defineTool<Record<string, never>>({
  name: 'calendars',
  description:
    'List every calendar on the account, with the one this agent writes to marked. Read it before ' +
    'assuming a meeting is missing — it may be on a shared or family calendar. Calendars you do ' +
    'not own belong to someone else: read them, never write to them.',
  input: input({}),
  run: async (_args, ctx) => {
    const body = await call(ctx, '/users/me/calendarList?minAccessRole=reader');
    const items = (body.items ?? []) as { id?: string; summary?: string; primary?: boolean; accessRole?: string; timeZone?: string }[];
    const mine = calendarId();
    return items.map((item) => ({
      id: item.id,
      name: item.summary,
      mine: item.id === mine || (mine === 'primary' && item.primary === true),
      access: item.accessRole,
      timezone: item.timeZone,
    }));
  },
});

export const agenda = defineTool<{ from: string; to: string; calendar?: string }>({
  name: 'agenda',
  description:
    'Events in a window, oldest first. Times are RFC3339 with an offset ' +
    '(2026-08-13T09:00:00-04:00). Read this before proposing anything. Every event comes back with ' +
    'has_guests: true means only reschedule or cancel may touch it, false means hold may. ' +
    'Cancelled events are filtered out; recurring ones are expanded, so an id addresses one ' +
    'occurrence and changing it leaves the rest of the series alone.',
  input: input({
    from: { type: 'string', description: 'Start of the window, RFC3339.' },
    to: { type: 'string', description: 'End of the window, RFC3339.' },
    calendar: { type: 'string', description: 'Calendar id from `calendars`. Defaults to his own.', optional: true },
  }),
  run: async (args, ctx) =>
    (await listEvents(ctx, args.calendar ?? calendarId(), args.from, args.to)).map(shape),
});

export const freebusy = defineTool<{ from: string; to: string; calendars?: string[] }>({
  name: 'freebusy',
  description:
    'Busy blocks across several calendars at once, merged. This is the double-booking check: run ' +
    'it across every calendar that can make him busy — work, shared, family — before claiming a ' +
    'slot is free. It returns only opaque busy ranges, so events marked free and all-day events ' +
    'do not appear. A calendar that could not be read comes back with a reason, not as free.',
  input: input({
    from: { type: 'string', description: 'Start of the window, RFC3339.' },
    to: { type: 'string', description: 'End of the window, RFC3339.' },
    calendars: {
      type: 'array',
      items: 'string',
      description: 'Calendar ids from `calendars`. Defaults to his own.',
      optional: true,
    },
  }),
  run: async (args, ctx) => {
    const ids = args.calendars?.length ? args.calendars : [calendarId()];
    const body = await call(ctx, '/freeBusy', {
      method: 'POST',
      body: JSON.stringify({ timeMin: args.from, timeMax: args.to, items: ids.map((id) => ({ id })) }),
    });
    const table = (body.calendars ?? {}) as Record<string, { busy?: unknown[]; errors?: { reason?: string }[] }>;
    return Object.entries(table).map(([id, value]) => ({
      calendar: id,
      busy: value.busy ?? [],
      // A calendar that errored is not a calendar that is free. Say so loudly.
      unreadable: value.errors?.map((error) => error.reason) ?? null,
    }));
  },
});

/* ---------------------------------------------------------------- his own time */

export const hold = defineTool<{
  action: string;
  title?: string;
  start?: string;
  end?: string;
  event_id?: string;
  notes?: string;
  anyway?: boolean;
}>({
  name: 'hold',
  description:
    'Create, move or release a block on his own time — focus, deep work, prep, a travel buffer, an ' +
    'errand. This is the one calendar tool that does not ask, because a block with no attendees ' +
    'notifies nobody. It refuses any event that has attendees, and it refuses to create a clash: ' +
    'if the slot is taken it fails and tells you what is there, so check `freebusy` and pick ' +
    'another. Never use it to work around an approval — an event with someone else on it belongs ' +
    'to reschedule or cancel.',
  input: input({
    action: {
      type: 'string',
      enum: ['create', 'move', 'release'],
      description: 'create a new block, move an existing one, or release (delete) it.',
    },
    title: { type: 'string', description: 'What the block is, as he reads it at a glance. Required to create.', optional: true },
    start: { type: 'string', description: 'RFC3339 with offset. Required to create or move.', optional: true },
    end: { type: 'string', description: 'RFC3339 with offset. Required to create or move.', optional: true },
    event_id: { type: 'string', description: 'From `agenda`. Required to move or release.', optional: true },
    notes: { type: 'string', description: 'Body text, for the version of him who sees this in three days.', optional: true },
    anyway: {
      type: 'boolean',
      description: 'Book over an existing event regardless. Only when he explicitly asked for the overlap — never to get past a refusal.',
      optional: true,
    },
  }),
  run: async (args, ctx) => {
    const id = calendarId();

    if (args.action === 'release') {
      if (!args.event_id) throw new Error('release needs an event_id.');
      const event = await mineAlone(ctx, args.event_id);
      await call(ctx, `/calendars/${encodeURIComponent(id)}/events/${args.event_id}`, { method: 'DELETE' });
      return `released "${event.summary ?? args.event_id}"`;
    }

    if (!args.start || !args.end) throw new Error(`${args.action} needs both start and end.`);
    if (new Date(args.end) <= new Date(args.start)) throw new Error('end must be after start.');

    if (!args.anyway) {
      const taken = await clash(ctx, args.start, args.end, args.event_id);
      if (taken) {
        throw new Error(
          `"${taken.summary ?? taken.id}" already occupies ${when(taken.start)} → ${when(taken.end)}.`,
        );
      }
    }

    if (args.action === 'move') {
      if (!args.event_id) throw new Error('move needs an event_id.');
      const event = await mineAlone(ctx, args.event_id);
      await call(ctx, `/calendars/${encodeURIComponent(id)}/events/${args.event_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ start: { dateTime: args.start }, end: { dateTime: args.end } }),
      });
      return `moved "${event.summary ?? args.event_id}" to ${span(args.start, args.end)}`;
    }

    if (!args.title) throw new Error('create needs a title.');
    const created = await call(ctx, `/calendars/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: args.title,
        description: args.notes,
        start: { dateTime: args.start },
        end: { dateTime: args.end },
        // Marked, so a later read can tell his own blocks from the agent's and
        // a cleanup never touches something he put there himself.
        extendedProperties: { private: { heldBy: 'calendar-agent' } },
      }),
    });
    return { id: created.id, held: `${args.title} ${span(args.start, args.end)}` };
  },
});

/* ----------------------------------------------------------- other people */

export const book = defineTool<{
  title: string;
  start: string;
  end: string;
  attendees: string[];
  notes?: string;
  location?: string;
}>({
  name: 'book',
  description:
    'Create a meeting and invite people. Everyone listed gets mail the moment this runs, which is ' +
    'why it asks. Check `freebusy` first and propose inside his working hours. For a block with ' +
    'nobody else on it, use `hold` — this tool requires at least one attendee.',
  effect: 'write',
  input: input({
    title: { type: 'string', description: 'What it is, as the attendees will read it in their inbox.' },
    start: { type: 'string', description: 'RFC3339 with offset.' },
    end: { type: 'string', description: 'RFC3339 with offset.' },
    attendees: {
      type: 'array',
      items: 'string',
      description: 'Email addresses. At least one — this tool is for meetings with people.',
    },
    notes: { type: 'string', description: 'Description body. Agenda, context, a link.', optional: true },
    location: { type: 'string', description: 'Room, address, or a call link.', optional: true },
  }),
  preview: (args) => `book "${args.title}" ${span(args.start, args.end)} and invite ${args.attendees.join(', ')}`,
  run: async (args, ctx) => {
    if (!args.attendees.length) throw new Error('book is for meetings with people. Use hold for a block of his own time.');
    if (new Date(args.end) <= new Date(args.start)) throw new Error('end must be after start.');
    const taken = await clash(ctx, args.start, args.end);
    if (taken) {
      throw new Error(`"${taken.summary ?? taken.id}" already occupies that slot. Nothing was sent. Pick another time.`);
    }
    const created = await call(ctx, `/calendars/${encodeURIComponent(calendarId())}/events?sendUpdates=all`, {
      method: 'POST',
      body: JSON.stringify({
        summary: args.title,
        description: args.notes,
        location: args.location,
        start: { dateTime: args.start },
        end: { dateTime: args.end },
        attendees: args.attendees.map((email) => ({ email })),
      }),
    });
    return { id: created.id, invited: args.attendees.length };
  },
});

export const reschedule = defineTool<{
  event_id: string;
  title: string;
  start: string;
  end: string;
  why: string;
}>({
  name: 'reschedule',
  description:
    'Move a meeting that has other people on it. Every attendee is notified of the new time, so it ' +
    'asks. For a block of his own time, `hold` does this without asking. On a recurring meeting ' +
    'this moves the one occurrence, not the series.',
  effect: 'write',
  input: input({
    event_id: { type: 'string', description: 'From `agenda`.' },
    title: { type: 'string', description: 'The event title, so the approval block says what is moving.' },
    start: { type: 'string', description: 'New start, RFC3339 with offset.' },
    end: { type: 'string', description: 'New end, RFC3339 with offset.' },
    why: { type: 'string', description: 'One line, so he can judge it without opening the calendar.' },
  }),
  preview: (args) => `move "${args.title}" to ${span(args.start, args.end)} and tell everyone on it — ${args.why}`,
  run: async (args, ctx) => {
    if (new Date(args.end) <= new Date(args.start)) throw new Error('end must be after start.');
    const taken = await clash(ctx, args.start, args.end, args.event_id);
    if (taken) {
      throw new Error(`"${taken.summary ?? taken.id}" already occupies that slot. Nothing was moved.`);
    }
    await call(ctx, `/calendars/${encodeURIComponent(calendarId())}/events/${args.event_id}?sendUpdates=all`, {
      method: 'PATCH',
      body: JSON.stringify({ start: { dateTime: args.start }, end: { dateTime: args.end } }),
    });
    return `moved "${args.title}" to ${span(args.start, args.end)} and notified everyone on it`;
  },
});

export const cancel = defineTool<{ event_id: string; title: string; why: string }>({
  name: 'cancel',
  description:
    'Cancel a meeting. Everyone invited is told it is off, and it cannot be undone from here. ' +
    'Always asks. To clear one of his own blocks, use `hold` with action release.',
  effect: 'write',
  input: input({
    event_id: { type: 'string', description: 'From `agenda`.' },
    title: { type: 'string', description: 'The event title, so the approval block says what is being cancelled.' },
    why: { type: 'string', description: 'Reason, in one line.' },
  }),
  preview: (args) => `cancel "${args.title}" and tell everyone on it — ${args.why}`,
  run: async (args, ctx) => {
    await call(ctx, `/calendars/${encodeURIComponent(calendarId())}/events/${args.event_id}?sendUpdates=all`, {
      method: 'DELETE',
    });
    return `cancelled "${args.title}"`;
  },
});

export const rsvp = defineTool<{ event_id: string; response: string; title: string; note?: string }>({
  name: 'rsvp',
  description:
    'Answer an invitation on his behalf. The organiser sees the response with his name on it, so ' +
    'it always asks — this is him speaking, not you.',
  effect: 'write',
  input: input({
    event_id: { type: 'string', description: 'From `agenda`.' },
    response: {
      type: 'string',
      enum: ['accepted', 'declined', 'tentative'],
      description: 'The answer to send.',
    },
    title: { type: 'string', description: 'The event title, for the approval block.' },
    note: { type: 'string', description: 'A line back to the organiser. Optional, and they will read it.', optional: true },
  }),
  preview: (args) =>
    `reply "${args.response}" to "${args.title}" as him${args.note ? ` — "${args.note}"` : ''}`,
  run: async (args, ctx) => {
    const event = await getEvent(ctx, calendarId(), args.event_id);
    const me = (event.attendees ?? []).find((attendee) => attendee.self);
    if (!me) throw new Error(`he is not an attendee on "${args.title}" — there is nothing to respond to.`);
    // Patching `attendees` replaces the whole array, so the others have to go
    // back unchanged or the invitation loses them.
    const attendees = (event.attendees ?? []).map((attendee) =>
      attendee.self
        ? { ...attendee, responseStatus: args.response, comment: args.note }
        : attendee,
    );
    await call(ctx, `/calendars/${encodeURIComponent(calendarId())}/events/${args.event_id}?sendUpdates=all`, {
      method: 'PATCH',
      body: JSON.stringify({ attendees }),
    });
    return `replied "${args.response}" to "${args.title}"`;
  },
});
