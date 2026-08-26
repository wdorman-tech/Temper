// The wire between your terminal (host) and the agent (container).
// One JSON object per line, both directions, over the container's stdio.
//
// This is also the lifeline: when your terminal closes, stdin closes, and the
// runtime exits. No daemon, no orphans, no agent running behind your back.

export type State =
  | 'booting'
  | 'idle'
  | 'thinking'
  | 'working'
  | 'waiting' // waiting on you
  | 'blocked' // stuck, needs a decision or a credential
  | 'error';

/**
 * What the dashboard shows. Deliberately loose: `detail` and `metrics` are
 * whatever your agent decides matters. A triage agent puts "12 unread" here;
 * a trading agent puts its position. Set it with the `status` tool.
 */
export type Status = {
  state: State;
  detail: string;
  metrics: Record<string, string>;
  since: number;
  next?: { name: string; at: number } | null;
};

export type Activity = {
  id: string;
  kind: 'command' | 'file' | 'tool' | 'search' | 'think' | 'note';
  text: string;
  status: 'running' | 'ok' | 'failed';
};

/**
 * Where a turn came from.
 *
 * `room` and `peer` are both group chats and they are deliberately not one
 * source. `room` is the human talking in a room, so the answer goes back into
 * that room the way a reply on the phone goes back to the phone. `peer` is
 * another agent talking, and a turn it woke replies to nobody unless the agent
 * decides to — two agents each answering the other's answer never stops.
 */
export type Source = 'terminal' | 'phone' | 'room' | 'peer' | 'schedule' | 'system';

/**
 * Why the human is being asked.
 *
 * A `question` may be answered in prose, and silence is survivable — the agent
 * is told to work around it. An `approval` gates an effect, so it is answered by
 * choosing one of the options that was offered and by nothing else: silence is a
 * refusal, and so is a sentence.
 */
export type AskKind = 'question' | 'approval';

export type Msg = {
  id: string;
  role: 'you' | 'agent' | 'system';
  text: string;
  source: Source;
  at: number;
};

export type ToHost =
  | { k: 'ready'; name: string }
  | { k: 'status'; status: Status }
  | { k: 'msg'; msg: Msg }
  | { k: 'activity'; activity: Activity }
  | { k: 'ask'; id: string; question: string; options?: string[]; kind?: AskKind; tool?: string }
  | { k: 'resolved'; id: string } // an ask was answered elsewhere (your phone)
  | { k: 'login'; lines: string[] } // device-auth output, passed through verbatim
  | { k: 'notice'; level: 'info' | 'warn' | 'error'; text: string };

export type ToAgent =
  /**
   * Always first. Carries everything we refuse to put in the container's
   * environment, because the agent's own shell can read `env`: your Codex
   * credentials, the token that speaks to your phone, and any secret marked
   * `gated` in the manifest. These live in the supervisor's memory only.
   */
  | {
      k: 'hello';
      authJson?: string;
      agentUpdateToken?: string;
      secrets?: Record<string, string>;
      tz?: string;
      /**
       * Proves an `answer` came from your terminal rather than from the sandbox.
       * The supervisor and the agent's shell run as the same uid in the same
       * container, so the shell can write to the supervisor's stdin through
       * /proc — which, without this, is a forged approval. Minted per run by the
       * host, held only in the supervisor's memory, never journalled, never in
       * the environment.
       */
      answerToken?: string;
    }
  /**
   * Settings changed on disk. Sent whenever .env or agent/ changes, so a model
   * swap or a new credential lands on the next turn instead of on a restart.
   */
  | { k: 'config'; env: Record<string, string>; secrets: Record<string, string>; agentUpdateToken?: string }
  | { k: 'say'; text: string }
  /** A standing order. Outlives every session arc. */
  | { k: 'correct'; text: string }
  | { k: 'answer'; id: string; value: string; token?: string }
  | { k: 'interrupt' }
  | { k: 'ping' };

/**
 * The one way an option becomes an answer: an exact match, or its number.
 *
 * Shared by the terminal and the effect gate so the two cannot disagree about
 * what the human said. Deliberately strict — substring matching is how "not
 * allowed" becomes an approval.
 */
export function resolveChoice(answer: string, options?: string[]): string | null {
  if (!options?.length) return null;
  const text = answer.trim();
  const index = Number(text);
  if (Number.isInteger(index) && options[index - 1] !== undefined) return options[index - 1]!;
  return options.find((option) => option.toLowerCase() === text.toLowerCase()) ?? null;
}

/** Split a byte stream into whole JSON lines. Tolerates partial chunks. */
export function lineReader<T>(onValue: (value: T) => void) {
  let buffer = '';
  return (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let cut: number;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      try {
        onValue(JSON.parse(line) as T);
      } catch {
        // Not our protocol (a stray log line). Dropping it is correct.
      }
    }
  };
}

export const encode = (value: unknown) => `${JSON.stringify(value)}\n`;
