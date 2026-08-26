import { chmodSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encode, lineReader, resolveChoice, type Activity, type AskKind, type Msg, type Source, type State, type Status, type ToAgent, type ToHost } from '../protocol.ts';
import { AgentUpdate, nameOf } from './agentupdate.ts';
import { serve } from './bus.ts';
import { corrections } from './corrections.ts';
import { isAuthFailure, login, loginStatus, logout, writeCodexConfig } from './codex.ts';
import { journal } from './journal.ts';
import { memory } from './memory.ts';
import { schedules } from './schedules.ts';
import { session } from './session.ts';
import { toolHost } from './tools.ts';
import { ensureWorkspace, paths } from './workspace.ts';

/**
 * The supervisor. It owns the human, and everything else asks it for access.
 *
 * Responsibilities, in order of how much they matter:
 *   1. Die when the terminal dies. Nothing runs behind the human's back.
 *   2. Serialise turns, so the agent is never racing itself.
 *   3. Be the single place a question reaches a person and an answer comes back.
 *   4. Survive its own bugs loudly rather than wedging quietly.
 */

const out = (message: ToHost) => process.stdout.write(encode(message));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where an answer came from matters: an approval granted on a phone is not a terminal event. */
type Answer = { text: string; via: 'terminal' | 'phone' };

/**
 * A branch of the race that will never produce anything. Per call, deliberately:
 * a shared module-level promise is a GC root, and resolving with it appends a
 * reaction record that is never drained and never collected, so the "cheap"
 * version is the one that leaks.
 */
const never = <T,>() => new Promise<T>(() => {});

let status: Status = { state: 'booting', detail: 'starting up', metrics: {}, since: Date.now(), next: null };

function setStatus(patch: Partial<Status>) {
  const changed = patch.state !== undefined && patch.state !== status.state;
  status = {
    ...status,
    ...patch,
    since: changed ? Date.now() : status.since,
    next: schedules.upcoming(),
    metrics: { ...(patch.metrics ?? status.metrics), ...(queue.length ? { queued: String(queue.length) } : {}) },
  };
  out({ k: 'status', status });
}

const say = (role: Msg['role'], text: string, source: Source) => {
  const msg: Msg = { id: crypto.randomUUID(), role, text, source, at: Date.now() };
  journal.record('message', msg);
  out({ k: 'msg', msg });
};

/** Timers must never take the process down; a bad schedule is not a fatal error. */
const every = (ms: number, work: () => void | Promise<void>) =>
  setInterval(() => {
    try {
      const result = work();
      if (result) result.catch((error: unknown) => journal.record('tick.failed', { error: String(error) }));
    } catch (error) {
      journal.record('tick.failed', { error: String(error) });
    }
  }, ms);

// ---------------------------------------------------------------- the human

type Waiter = { resolve: (answer: string) => void; reject: (error: Error) => void };
const waiting = new Map<string, Waiter>();
let agentUpdate = new AgentUpdate(undefined);

/**
 * Nudge once, then stop waiting. Not configurable, because the right answer
 * doesn't vary by deployment: an unanswered question should cost the human one
 * extra buzz and cost the agent one hour, and no agent should be able to argue
 * its way to a shorter fuse.
 */
const NUDGE_AFTER = 20 * 60_000;
const GIVE_UP_AFTER = 60 * 60_000;

/**
 * Ask, and wait. The question goes to the terminal and their phone at once, as
 * the same block with the same options; whichever they answer first wins.
 *
 * Returns null when nobody answered in an hour. That is not a default answer —
 * every caller treats silence as "no" for anything with an effect, and only
 * plain questions are allowed to continue without one. A blocked ask used to
 * hold the entire queue: one 3am question and the agent was deaf until morning.
 *
 * `kind` changes nothing about the waiting and everything about the wording. An
 * approval says on the lock screen that ignoring it is a refusal, because that
 * is the one thing a person cannot infer from a notification.
 */
async function askHuman(question: string, options?: string[], meta: { kind?: AskKind; tool?: string } = {}): Promise<Answer | null> {
  const id = crypto.randomUUID();
  const kind: AskKind = meta.kind ?? 'question';
  const gating = kind === 'approval';
  const previous: State = status.state === 'waiting' ? 'working' : status.state;
  out({ k: 'ask', id, question, options, kind, tool: meta.tool });
  setStatus({ state: 'waiting', detail: question });
  journal.record('ask', { id, question, options, kind, tool: meta.tool });

  const fromTerminal = new Promise<string>((resolve, reject) => waiting.set(id, { resolve, reject })).then(
    (text): Answer => ({ text, via: 'terminal' }),
  );
  /**
   * Closing the loop on the phone. An approval answered at the desk otherwise
   * leaves a live, tappable block on their lock screen, and a tap on a settled
   * question resolves nothing and says nothing — they walk away believing they
   * decided something they didn't.
   *
   * Both orders have to work: the post can also land *after* the ask settles,
   * because a human at the terminal answers in three seconds and an HTTP request
   * can take longer than that.
   */
  let posted: string | null = null;
  let closing: string | null = null;
  const closeOnPhone = () => {
    if (posted && closing) void agentUpdate.send(closing);
  };

  const fromPhone = (async () => {
    if (!agentUpdate.enabled) return never<Answer>();
    // One 429 must not cost an approval its only surface for the next hour: the
    // backoff is a minute, and this is the same 2s cadence the answer loop uses.
    const nonce = crypto.randomUUID();
    for (let attempt = 0; posted === null && waiting.has(id) && attempt < 30; attempt++) {
      if (attempt) await sleep(2_000);
      posted = await agentUpdate.ask({ text: question, options, kind, tool: meta.tool, nonce });
    }
    if (posted === null) {
      // Losing the phone costs a question some reach. It costs an approval the
      // only surface the human was likely to be looking at, so say it louder.
      out({
        k: 'notice',
        level: gating ? 'error' : 'warn',
        text: gating
          ? 'could not reach your phone — this approval can only be answered here'
          : 'could not reach your phone — this question is terminal-only',
      });
      return never<Answer>();
    }
    // Settled while the post was in flight: the block is live and already stale.
    if (!waiting.has(id)) {
      closeOnPhone();
      return never<Answer>();
    }
    while (waiting.has(id)) {
      const answer = await agentUpdate.answer(posted);
      if (answer !== null) return { text: answer, via: 'phone' as const };
      // answer() returns immediately while rate-limit backoff is armed, so the
      // sleep is what stops this from starving the event loop.
      await sleep(2_000);
    }
    return never<Answer>();
  })();

  let nudge: NodeJS.Timeout | undefined;
  let giveUp: NodeJS.Timeout | undefined;
  const expiry = new Promise<null>((resolve) => {
    nudge = setTimeout(() => {
      if (waiting.has(id)) {
        void agentUpdate.send(gating ? `still waiting to run this: ${question}` : `still waiting on this: ${question}`);
      }
    }, NUDGE_AFTER);
    giveUp = setTimeout(() => resolve(null), GIVE_UP_AFTER);
  });

  let answer: Answer | null = null;
  try {
    answer = await Promise.race([fromTerminal, fromPhone, expiry]);
    if (answer === null) {
      journal.record('unanswered', { id, question, kind });
      out({
        k: 'notice',
        level: 'warn',
        text: gating
          ? `no answer in an hour — nothing ran: ${question}`
          : `no answer in an hour — the agent will work around it: ${question}`,
      });
    } else {
      journal.record('answered', { id, answer: answer.text, via: answer.via, kind });
      say('you', answer.text, answer.via);
    }
    return answer;
  } finally {
    clearTimeout(nudge);
    clearTimeout(giveUp);
    waiting.delete(id);
    out({ k: 'resolved', id });
    setStatus({ state: previous, detail: 'thinking' });
    if (answer?.via !== 'phone') {
      closing =
        answer === null
          ? `too late to answer — ${gating ? 'nothing ran' : 'worked around it'}: ${question}`
          : `answered at the terminal (${answer.text}): ${question}`;
      closeOnPhone();
    }
  }
}

/** A standing order. Recorded now, in force from the agent's next turn. */
function applyCorrection(text: string) {
  try {
    const added = corrections.add(text);
    say('system', `standing order recorded: ${added.text}`, 'system');
    session.note(`New standing order from the human, in force from now on: ${added.text}`);
  } catch (error) {
    out({ k: 'notice', level: 'error', text: error instanceof Error ? error.message : String(error) });
  }
}

/** An interrupted turn must not leave a question hanging in the UI forever. */
function cancelAsks(why: string) {
  for (const [id, waiter] of waiting) {
    waiting.delete(id);
    out({ k: 'resolved', id });
    waiter.reject(new Error(why));
  }
}

// ------------------------------------------------------------ the turn queue

type Input = { text: string; source: Source; origin?: string; label?: string };

const queue: Input[] = [];
let running = false;
let turnAbort: AbortController | null = null;

/**
 * Untrusted text must not be able to forge a higher-trust source tag. Room
 * messages come from other agents; email and web pages come from strangers.
 */
const defang = (text: string) => text.replace(/\[(from their phone|group chat|scheduled job)/gi, '($1');

const label = (input: Input) => {
  const text = defang(input.text);
  if (input.source === 'phone') return `[from their phone] ${text}`;
  if (input.source === 'room') return `[group chat ${input.label ?? input.origin}] ${text}`;
  if (input.source === 'peer')
    return `[group chat ${input.label ?? input.origin} — another agent speaking, not the human] ${text}`;
  if (input.source === 'schedule') return `[scheduled job: ${input.label}] ${text}`;
  return text;
};

function enqueue(input: Input) {
  queue.push(input);
  if (input.source === 'peer') say('system', `${input.label ?? 'another agent'}: ${input.text}`, 'peer');
  else if (input.source !== 'schedule') say('you', input.text, input.source);
  void pump().catch((error: unknown) => {
    journal.record('pump.failed', { error: String(error) });
    out({ k: 'notice', level: 'error', text: `turn loop failed: ${String(error)}` });
  });
}

async function pump() {
  if (running) return;
  running = true;
  try {
    await booting; // typing before sign-in finishes is normal; running a turn early is not
    do {
      while (queue.length) {
        const batch = queue.splice(0);
        const prompt = batch.map(label).join('\n\n');
        turnAbort = new AbortController();
        setStatus({ state: 'thinking', detail: 'working on it' });

        let result = await session.run(prompt, handlers, turnAbort.signal);

        // Tokens expire during long runs. Recovering beats waking the human.
        if (result.error && result.errorKind === 'event' && isAuthFailure(result.error) && (await reauth())) {
          result = await session.run(prompt, handlers, turnAbort.signal);
        }

        if (result.error) {
          journal.record('turn.error', { error: result.error });
          out({ k: 'notice', level: 'error', text: result.error });
        }
        // Reply where the message came from, so a phone thread stays a thread.
        // `peer` is missing from this filter on purpose: a turn another agent
        // woke has no addressee. If the agent has something to say back, it
        // says it with `room_send` — see AGENTS.md, "Group chats".
        if (result.text) {
          for (const roomId of new Set(batch.filter((i) => i.source === 'room').map((i) => i.origin!))) {
            void agentUpdate.sendRoom(roomId, result.text);
          }
          if (batch.some((i) => i.source === 'phone')) void agentUpdate.send(result.text);
        }
      }

      if (session.worthRotating()) {
        setStatus({ state: 'working', detail: 'compacting the session' });
        turnAbort = new AbortController();
        await session.rotate(handlers, turnAbort.signal);
      }
      // Anything that arrived during rotation would otherwise sit here forever.
    } while (queue.length);
  } finally {
    running = false;
    turnAbort = null;
    setStatus({ state: 'idle', detail: 'waiting' });
  }
}

let agentName = process.env.TEMPER_NAME ?? 'temper';

async function reauth(): Promise<boolean> {
  out({ k: 'notice', level: 'warn', text: 'Codex credentials expired — signing in again' });
  setStatus({ state: 'blocked', detail: 'signing in to Codex' });
  logout();
  const ok = await login((lines) => out({ k: 'login', lines }));
  journal.record('reauth', { ok });
  if (ok) out({ k: 'ready', name: agentName });
  return ok;
}

const handlers = {
  onActivity: (activity: Activity) => {
    out({ k: 'activity', activity });
    // Shell commands are this agent's main capability; a dashboard nobody was
    // watching is not a record.
    if (activity.status !== 'running') journal.record('did', activity);
    if (status.state === 'thinking') setStatus({ state: 'working' });
  },
  onMessage: (text: string) => say('agent', text, 'terminal'),
};

// ------------------------------------------------------------ tools' access

const secrets = new Map<string, string>();

const host = toolHost({
  ask: async (question, options) => (await askHuman(question, options))?.text ?? null,
  // The gate decides what the options mean; this only decides whether they said
  // one of them. Resolution is strict and shared with the terminal, so a reply
  // that merely contains the word "allow" is not an approval.
  approve: async ({ tool, preview, options }) => {
    const answer = await askHuman(preview, options, { kind: 'approval', tool });
    return { chosen: answer ? resolveChoice(answer.text, options) : null, answer: answer?.text ?? null };
  },
  notify: async (text) => {
    say('agent', text, 'system');
    await agentUpdate.send(text);
  },
  status: (patch) => {
    setStatus(patch);
    writeFileSync(paths.state, JSON.stringify(status, null, 2));
  },
  rooms: {
    list: () => agentUpdate.rooms(),
    send: (roomId, text) => agentUpdate.sendRoom(roomId, text),
  },
  secrets,
});

serve({
  'tools.list': async () => host.list(),
  'tools.call': async ({ name, args }: { name: string; args: Record<string, unknown> }) => host.call(name, args),
});

// ----------------------------------------------------------------- lifecycle

let lastPing = Date.now();
let booting: Promise<void> | null = null;
let agentUpdateToken: string | undefined;
/** Memory only. Never journalled, never in the environment, never sent anywhere. */
let answerToken: string | undefined;

/**
 * Settings changed on disk. Everything the runtime reads is read at call time,
 * so a new model, a rotated credential or a different arc ceiling takes effect
 * on the next turn without restarting — and without losing the session.
 */
function applyConfig(update: Extract<ToAgent, { k: 'config' }>) {
  Object.assign(process.env, update.env);
  secrets.clear();
  for (const [name, value] of Object.entries(update.secrets)) secrets.set(name, value);
  if (update.agentUpdateToken !== agentUpdateToken) {
    agentUpdateToken = update.agentUpdateToken;
    agentUpdate = new AgentUpdate(agentUpdateToken);
  }
  journal.record('config.reloaded', { keys: Object.keys(update.env).sort() });
  out({ k: 'notice', level: 'info', text: 'settings reloaded' });
}

const read = lineReader<ToAgent>((message) => {
  switch (message.k) {
    case 'hello':
      // Deliberately not awaited: pings and typing must keep flowing while
      // sign-in waits on a human with a browser open.
      booting ??= boot(message).catch((error: unknown) => {
        out({ k: 'notice', level: 'error', text: `startup failed: ${String(error)}` });
        journal.record('boot.failed', { error: String(error) });
        process.exit(1);
      });
      break;
    case 'config':
      applyConfig(message);
      break;
    case 'say':
      enqueue({ text: message.text, source: 'terminal' });
      break;
    case 'correct':
      applyCorrection(message.text);
      break;
    case 'answer':
      // The one message that can grant an effect, so it is the one message we
      // check the provenance of. Anything in this container can write to our
      // stdin; only the host was given this token.
      if (answerToken && message.token !== answerToken) {
        journal.record('answer.forged', { id: message.id });
        out({ k: 'notice', level: 'error', text: 'an answer arrived without the terminal\'s token and was ignored' });
        break;
      }
      waiting.get(message.id)?.resolve(message.value);
      break;
    case 'interrupt':
      turnAbort?.abort();
      cancelAsks('the human interrupted');
      break;
    case 'ping':
      lastPing = Date.now();
      break;
  }
});

process.stdin.on('data', read);
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));

// Belt and braces: if the terminal is killed hard enough that stdin never
// closes, the missing heartbeat still takes us down.
setInterval(() => {
  if (Date.now() - lastPing > 45_000) process.exit(0);
}, 5_000).unref();

// An agent that dies with a stack trace nobody sees is worse than one that says
// what happened. The host prints this and stops.
for (const fatal of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(fatal, (error: unknown) => {
    try {
      journal.record('crashed', { fatal, error: String(error) });
    } catch {
      // The journal may be exactly what's broken.
    }
    process.stderr.write(`${fatal}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}

async function boot(hello: Extract<ToAgent, { k: 'hello' }>) {
  ensureWorkspace();
  if (hello.tz) process.env.TEMPER_TZ = hello.tz;
  for (const [name, value] of Object.entries(hello.secrets ?? {})) secrets.set(name, value);
  // Never put this in the container's environment: the agent's own shell can
  // read `env`, and this token speaks to the human as the agent.
  agentUpdateToken = hello.agentUpdateToken;
  answerToken = hello.answerToken;
  agentUpdate = new AgentUpdate(agentUpdateToken);

  if (hello.authJson) {
    const file = join(paths.codexHome, 'auth.json');
    writeFileSync(file, hello.authJson);
    chmodSync(file, 0o600);
  }

  for (const file of ['AGENTS.md', 'NORTH_STAR.md']) {
    try {
      copyFileSync(join('/app/agent', file), join(paths.root, file));
    } catch {
      // NORTH_STAR.md is optional until the human writes one.
    }
  }
  writeCodexConfig();
  memory.reindex();
  // Restores the file from the journal, undoing anything the agent did to it.
  corrections.publish();

  if (!(await loginStatus())) {
    setStatus({ state: 'blocked', detail: 'signing in to Codex' });
    const ok = await login((lines) => out({ k: 'login', lines }));
    if (!ok) {
      out({ k: 'notice', level: 'error', text: 'Codex sign-in failed. Run `npm start -- login` and try again.' });
      process.exit(1);
    }
  }

  for (const problem of schedules.load()) out({ k: 'notice', level: 'warn', text: problem });
  const missed = schedules.missed();
  if (missed.length) {
    session.note(`While the terminal was closed these scheduled jobs came due: ${missed.join('; ')}. Decide what is still worth doing.`);
    out({ k: 'notice', level: 'info', text: `${missed.length} scheduled job(s) came due while you were away` });
  }

  // The agent cannot use a folder it doesn't know it has.
  const shared = readdirSync(paths.mounts, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (shared.length) {
    session.note(
      `The human shared these folders with you, and they are real files on their machine: ` +
        `${shared.map((entry) => `mounts/${entry.name}`).join(', ')}. Treat every write there as an effect: ask first.`,
    );
  }

  const who = agentUpdate.enabled ? await agentUpdate.whoami() : null;
  if (agentUpdate.enabled && !who) out({ k: 'notice', level: 'warn', text: 'Agent Update token rejected — phone and group chat are off' });

  agentName = nameOf(who) ?? process.env.TEMPER_NAME ?? 'temper';
  out({ k: 'ready', name: agentName });
  setStatus({ state: 'idle', detail: 'waiting' });
  journal.record('boot', { name: agentName, schedules: schedules.list().length });

  // Poll their phone and group chats. `polling` stops a slow request from
  // stacking up overlapping fetches that would each replay the same messages.
  let polling = false;
  if (agentUpdate.enabled && who) {
    every(15_000, async () => {
      if (polling) return;
      polling = true;
      try {
        for (const message of await agentUpdate.poll()) {
          if (message.role === 'user' && message.body) {
            // A standing order is a standing order wherever you type it.
            const correction = /^\s*[/!]correct\s+([\s\S]+)/i.exec(message.body);
            if (correction) applyCorrection(correction[1]!);
            else {
              enqueue({
                text: message.body,
                source: message.room ? 'room' : 'phone',
                origin: message.room?.id,
                label: message.room?.name ?? message.from ?? undefined,
              });
            }
          } else if (message.room && message.body && message.from !== agentName) {
            // Another agent, in a room the human owns and reads. This used to be
            // polled, marked seen and dropped, which made every group chat
            // one-way: AGENTS.md told the agent to address a peer by name and
            // nothing was ever listening on the other side.
            //
            // It is `peer`, not `room`, and the difference is the whole fix.
            // A turn the human started in a room answers back into that room;
            // a turn a peer started answers nobody unless the agent chooses to
            // call `room_send`. Two agents each replying to the other's reply
            // is a loop with no exit and a bill attached.
            journal.record('room.heard', { from: message.from, room: message.room.name });
            enqueue({
              text: message.body,
              source: 'peer',
              origin: message.room.id,
              label: `${message.room.name} · ${message.from ?? 'another agent'}`,
            });
          }
          agentUpdate.seen(message.id);
        }
      } finally {
        polling = false;
      }
    });
  }

  every(20_000, () => {
    for (const due of schedules.due()) {
      journal.record('schedule.fired', { id: due.id });
      enqueue({ text: due.prompt, source: 'schedule', label: due.name });
    }
  });

  every(600_000, () => journal.compact()).unref();
}
