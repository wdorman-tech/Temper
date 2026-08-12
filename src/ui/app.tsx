import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { resolveChoice, type Activity, type AskKind, type Msg, type Status, type ToAgent, type ToHost } from '../protocol.ts';
import { GUTTER, box, color, label, since, stateColor, until } from './theme.ts';

/**
 * The dashboard.
 *
 * One screen: what the agent is doing at the top, the conversation in the
 * middle, your cursor at the bottom. The status strip is deliberately
 * content-free — `detail` and `metrics` are whatever this particular agent
 * decided you should see. Change the agent, not this file.
 */
export type Bridge = {
  send: (message: ToAgent) => void;
  subscribe: (listener: (message: ToHost) => void) => () => void;
};

type Entry =
  | { key: string; kind: 'msg'; msg: Msg }
  | { key: string; kind: 'activity'; activity: Activity }
  | { key: string; kind: 'notice'; level: 'info' | 'warn' | 'error'; text: string };

type Ask = { id: string; question: string; options?: string[]; kind?: AskKind; tool?: string };

const FEED_LIMIT = 400;

export function Dashboard({ bridge, name: initialName, project }: { bridge: Bridge; name: string; project: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<Status>({ state: 'booting', detail: 'starting the container', metrics: {}, since: Date.now(), next: null });
  const [feed, setFeed] = useState<Entry[]>([]);
  /**
   * A queue, not a slot. The supervisor runs asks concurrently on purpose (see
   * bus.ts), so a second one arriving must not paint over the first: the human
   * would answer a block they never read, and the one underneath would go
   * unanswerable until it timed out an hour later.
   */
  const [asks, setAsks] = useState<Ask[]>([]);
  const [signIn, setSignIn] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  /** Which block was on screen when this draft was started. */
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [recall, setRecall] = useState(-1);
  const [, tick] = useState(0);

  // Durations in the header have to keep counting even when nothing arrives.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () =>
      bridge.subscribe((message) => {
        switch (message.k) {
          case 'ready':
            setName(message.name);
            setSignIn([]);
            break;
          case 'status':
            setStatus(message.status);
            break;
          case 'msg':
            setFeed((f) => cap([...f, { key: message.msg.id, kind: 'msg', msg: message.msg }]));
            break;
          case 'activity':
            setFeed((f) => upsertActivity(f, message.activity));
            break;
          case 'notice':
            setFeed((f) => cap([...f, { key: crypto.randomUUID(), kind: 'notice', level: message.level, text: message.text }]));
            break;
          case 'ask':
            setAsks((queued) =>
              queued.some((a) => a.id === message.id)
                ? queued
                : [...queued, { id: message.id, question: message.question, options: message.options, kind: message.kind, tool: message.tool }],
            );
            break;
          case 'resolved':
            setAsks((queued) => queued.filter((a) => a.id !== message.id));
            break;
          case 'login':
            setSignIn((lines) => [...lines, ...message.lines].slice(-12));
            break;
        }
      }),
    [bridge],
  );

  const ask = asks[0] ?? null;
  const askStale = ask !== null && draft !== '' && draftFor !== ask.id;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit();
    if (key.escape) return bridge.send({ k: 'interrupt' });

    if (key.upArrow || key.downArrow) {
      const next = key.upArrow ? Math.min(recall + 1, history.length - 1) : Math.max(recall - 1, -1);
      setRecall(next);
      setDraft(next === -1 ? '' : (history[next] ?? ''));
      setDraftFor(ask?.id ?? null);
      return;
    }
    if (key.return) {
      const text = draft.trim();
      if (!text) return;
      setDraft('');
      setDraftFor(null);
      setRecall(-1);
      setHistory((h) => [text, ...h].slice(0, 100));
      // `/correct` is the one command worth having: a standing order outlives
      // every session arc, so it must not be phrased as a passing remark.
      const correction = /^\/correct\s+([\s\S]+)/i.exec(text);
      if (correction) return bridge.send({ k: 'correct', text: correction[1]! });
      // Only answer the block this text was actually typed at. If the visible
      // one changed underneath them — the queue moved on, the phone answered
      // first — the keystrokes were aimed at something else, and a "1" meant
      // for one approval must never land on the next one. It goes up as chat.
      if (ask && draftFor === ask.id) {
        // A number picks an option; anything else goes as typed, and the
        // supervisor refuses to read prose as a yes. That is the point.
        return bridge.send({ k: 'answer', id: ask.id, value: resolveChoice(text, ask.options) ?? text });
      }
      return bridge.send({ k: 'say', text });
    }
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1));
    if (input && !key.ctrl && !key.meta) {
      if (!draft) setDraftFor(ask?.id ?? null);
      setDraft((d) => d + input);
    }
  });

  const width = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;
  const askHeight = ask ? 4 + (ask.options?.length ? 1 : 0) + (ask.kind === 'approval' || askStale ? 1 : 0) : 0;
  const signInHeight = signIn.length ? signIn.length + 2 : 0;
  const budget = Math.max(3, rows - 7 - askHeight - signInHeight);
  const visible = useMemo(() => fit(feed, width - GUTTER, budget), [feed, width, budget]);

  return (
    <Box flexDirection="column" width={width}>
      <Header name={name} project={project} status={status} width={width} />
      <StatusStrip status={status} />

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {visible.map((entry) => (
          <Line key={entry.key} entry={entry} name={name} width={width} />
        ))}
      </Box>

      {signIn.length > 0 && (
        <Box flexDirection="column" borderStyle={box.style} borderColor={color.accent} paddingX={box.paddingX}>
          <Text color={color.accent}>sign in to Codex</Text>
          {signIn.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Box>
      )}

      {ask && <AskBox ask={ask} queued={asks.length} stale={askStale} />}

      <Box marginTop={1}>
        <Text color={color.accent}>{'› '}</Text>
        <Text>{draft}</Text>
        <Text inverse>{' '}</Text>
      </Box>
      <Text dimColor>
        {`  enter send · /correct <rule> standing order · esc interrupt · ctrl-c quit${
          ask ? (ask.kind === 'approval' ? ' · type a number to decide above' : ' · answering the question above') : ''
        }`}
      </Text>
    </Box>
  );
}

/** The agent's name owns the header, then the folder it was started in. */
function Header({ name, project, status, width }: { name: string; project: string; status: Status; width: number }) {
  const state = label[status.state];
  const left = ` ${name}`;
  const where = `  ${project}`;
  const right = `${state} · ${since(status.since)} `;
  const gap = Math.max(1, width - left.length - where.length - right.length - 2);
  return (
    <Box>
      <Text bold>{left}</Text>
      <Text dimColor>{where}</Text>
      <Text>{' '.repeat(gap)}</Text>
      <Text color={stateColor[status.state]}>{'● '}</Text>
      <Text color={stateColor[status.state]}>{right}</Text>
    </Box>
  );
}

/** Free-form by design: the agent decides what belongs here. */
function StatusStrip({ status }: { status: Status }) {
  const metrics = Object.entries(status.metrics).map(([key, value]) => `${key} ${value}`);
  const next = status.next ? `next: ${status.next.name} ${until(status.next.at)}` : null;
  return (
    <Box>
      <Text dimColor>{'  '}</Text>
      <Text>{status.detail || '—'}</Text>
      {metrics.length > 0 && <Text dimColor>{`  ·  ${metrics.join('  ')}`}</Text>}
      {next && <Text dimColor>{`  ·  ${next}`}</Text>}
    </Box>
  );
}

/**
 * A question and an approval look alike and mean different things, so they must
 * not read alike. The header names the tool that is waiting, and the footer says
 * the thing nobody can infer: doing nothing here is a no.
 *
 * `stale` is the one that stops an accident. If the block changed while they were
 * mid-word, what is in the input was aimed at something else, and enter will send
 * it as chat rather than as a decision — so say so before they press it.
 */
function AskBox({ ask, queued, stale }: { ask: Ask; queued: number; stale: boolean }) {
  const gating = ask.kind === 'approval';
  const more = queued > 1 ? `  ·  1 of ${queued}` : '';
  return (
    <Box flexDirection="column" borderStyle={box.style} borderColor={color.warn} paddingX={box.paddingX}>
      <Text color={color.warn}>{`${gating ? `approve${ask.tool ? ` · ${ask.tool}` : ''}` : 'needs you'}${more}`}</Text>
      <Text>{ask.question}</Text>
      {ask.options?.length ? (
        <Text dimColor>{ask.options.map((option, index) => `${index + 1} ${option}`).join('   ')}</Text>
      ) : null}
      {stale ? (
        <Text color={color.warn}>this replaced what you were answering — clear the line to decide on it</Text>
      ) : gating ? (
        <Text dimColor>pick one · no reply means no · also on your phone</Text>
      ) : null}
    </Box>
  );
}

function Line({ entry, name, width }: { entry: Entry; name: string; width: number }) {
  const pad = (text: string) => text.padEnd(GUTTER - 2).slice(0, GUTTER - 2);
  const body = width - GUTTER;

  if (entry.kind === 'activity') {
    const tone =
      entry.activity.status === 'failed' ? color.danger : entry.activity.status === 'running' ? color.accent : undefined;
    return (
      <Box>
        <Text dimColor>{`  ${pad('·')}`}</Text>
        <Text dimColor color={tone}>
          {entry.activity.text}
        </Text>
      </Box>
    );
  }

  if (entry.kind === 'notice') {
    return (
      <Box>
        <Text color={entry.level === 'error' ? color.danger : entry.level === 'warn' ? color.warn : color.muted}>
          {`  ${pad('!')}${entry.text}`}
        </Text>
      </Box>
    );
  }

  const { msg } = entry;
  const from = msg.role === 'you' ? 'you' : msg.role === 'agent' ? name : '';
  const tag = msg.source === 'phone' ? ' (phone)' : msg.source === 'room' ? ' (room)' : '';
  return (
    <Box>
      <Text bold={msg.role === 'you'} color={msg.role === 'you' ? color.text : color.accent}>
        {`  ${pad(from)}`}
      </Text>
      <Box width={body}>
        <Text dimColor={msg.role === 'system'}>
          {msg.text}
          {tag && <Text dimColor>{tag}</Text>}
        </Text>
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------------ plumbing

const cap = (entries: Entry[]) => (entries.length > FEED_LIMIT ? entries.slice(-FEED_LIMIT) : entries);

/** An activity line updates in place as it runs, then settles. */
function upsertActivity(feed: Entry[], activity: Activity): Entry[] {
  const key = `act-${activity.id}`;
  const index = feed.findIndex((entry) => entry.key === key);
  if (index === -1) return cap([...feed, { key, kind: 'activity', activity }]);
  const next = [...feed];
  next[index] = { key, kind: 'activity', activity };
  return next;
}

/** Take entries from the end until the screen is full. Long messages wrap. */
function fit(feed: Entry[], width: number, budget: number): Entry[] {
  const columns = Math.max(20, width);
  const height = (entry: Entry) => {
    const text =
      entry.kind === 'msg' ? entry.msg.text : entry.kind === 'activity' ? entry.activity.text : entry.text;
    // Agent replies are markdown. Counting characters and ignoring newlines
    // undercounts a bulleted list by an order of magnitude, and the frame
    // overflows the alt screen.
    return text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / columns)), 0);
  };
  const shown: Entry[] = [];
  let used = 0;
  for (let index = feed.length - 1; index >= 0; index--) {
    const entry = feed[index]!;
    used += height(entry);
    if (used > budget) break;
    shown.unshift(entry);
  }
  return shown;
}
