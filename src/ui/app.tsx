import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import type { Activity, Msg, Status, ToAgent, ToHost } from '../protocol.ts';
import { GUTTER, color, label, since, until } from './theme.ts';

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

type Ask = { id: string; question: string; options?: string[] };

const FEED_LIMIT = 400;

export function Dashboard({ bridge, name: initialName, project }: { bridge: Bridge; name: string; project: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<Status>({ state: 'booting', detail: 'starting the container', metrics: {}, since: Date.now(), next: null });
  const [feed, setFeed] = useState<Entry[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [signIn, setSignIn] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
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
            setAsk({ id: message.id, question: message.question, options: message.options });
            break;
          case 'resolved':
            setAsk((current) => (current?.id === message.id ? null : current));
            break;
          case 'login':
            setSignIn((lines) => [...lines, ...message.lines].slice(-12));
            break;
        }
      }),
    [bridge],
  );

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit();
    if (key.escape) return bridge.send({ k: 'interrupt' });

    if (key.upArrow || key.downArrow) {
      const next = key.upArrow ? Math.min(recall + 1, history.length - 1) : Math.max(recall - 1, -1);
      setRecall(next);
      setDraft(next === -1 ? '' : (history[next] ?? ''));
      return;
    }
    if (key.return) {
      const text = draft.trim();
      if (!text) return;
      setDraft('');
      setRecall(-1);
      setHistory((h) => [text, ...h].slice(0, 100));
      // `/correct` is the one command worth having: a standing order outlives
      // every session arc, so it must not be phrased as a passing remark.
      const correction = /^\/correct\s+([\s\S]+)/i.exec(text);
      if (correction) bridge.send({ k: 'correct', text: correction[1]! });
      else if (ask) bridge.send({ k: 'answer', id: ask.id, value: resolveAnswer(text, ask.options) });
      else bridge.send({ k: 'say', text });
      return;
    }
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1));
    if (input && !key.ctrl && !key.meta) setDraft((d) => d + input);
  });

  const width = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;
  const askHeight = ask ? 4 + (ask.options?.length ? 1 : 0) : 0;
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
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">sign in to Codex</Text>
          {signIn.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Box>
      )}

      {ask && <AskBox ask={ask} />}

      <Box marginTop={1}>
        <Text color="cyan">{'› '}</Text>
        <Text>{draft}</Text>
        <Text inverse>{' '}</Text>
      </Box>
      <Text dimColor>
        {`  enter send · /correct <rule> standing order · esc interrupt · ctrl-c quit${ask ? ' · answering the question above' : ''}`}
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
      <Text color={color[status.state]}>{'● '}</Text>
      <Text color={color[status.state]}>{right}</Text>
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

function AskBox({ ask }: { ask: Ask }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">needs you</Text>
      <Text>{ask.question}</Text>
      {ask.options?.length ? (
        <Text dimColor>{ask.options.map((option, index) => `${index + 1} ${option}`).join('   ')}</Text>
      ) : null}
    </Box>
  );
}

function Line({ entry, name, width }: { entry: Entry; name: string; width: number }) {
  const pad = (text: string) => text.padEnd(GUTTER - 2).slice(0, GUTTER - 2);
  const body = width - GUTTER;

  if (entry.kind === 'activity') {
    const tone = entry.activity.status === 'failed' ? 'red' : entry.activity.status === 'running' ? 'cyan' : undefined;
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
        <Text color={entry.level === 'error' ? 'red' : entry.level === 'warn' ? 'yellow' : 'gray'}>
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
      <Text bold={msg.role === 'you'} color={msg.role === 'you' ? 'white' : 'cyan'}>
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

/** "2" means the second option. Anything else is taken at face value. */
function resolveAnswer(text: string, options?: string[]): string {
  const index = Number(text) - 1;
  return options && Number.isInteger(index) && options[index] !== undefined ? options[index]! : text;
}
