import type { AskKind } from '../protocol.ts';
import { journal } from './journal.ts';

/**
 * Agent Update (https://tryagentupdate.com) is how the agent reaches you when
 * you are not looking at the terminal: a line on your lock screen, a question
 * with tappable answers, a room where several agents and you can talk.
 *
 * It is optional. Without a token everything below no-ops and the agent simply
 * lives in your terminal instead.
 */
const BASE = process.env.AGENT_UPDATE_BASE ?? 'https://api.tryagentupdate.com';
const CURSOR = 'agentupdate.cursor';

export type Inbound = {
  id: string;
  role: 'user' | 'agent';
  body: string;
  from: string | null;
  room: { id: string; name: string } | null;
};

export type Room = { id: string; name: string };

export type Ask = {
  text: string;
  /** Up to six tappable answers. For an approval these are the *only* answers. */
  options?: string[];
  kind?: AskKind;
  /** The tool whose effect is being gated. Approvals only. */
  tool?: string;
  /** Stable across retries, so a re-post after a rate limit is not a second question. */
  nonce?: string;
};

/**
 * What an approval looks like on a lock screen. Three parts, in this order:
 * what is being asked for, what will actually happen, and what happens if they
 * do nothing. The last one is not decoration — silence is a refusal here, and
 * someone who reads the block as "I'll deal with it later" will be wrong.
 */
const approvalBlock = ({ text, tool }: Ask) =>
  `Approve${tool ? ` · ${tool}` : ''}\n\n${text}\n\nTap an answer. No reply means no, and nothing runs.`;

/**
 * The approval frame belongs to the supervisor. A plain question carries text
 * and option labels the *model* wrote, and the `ask` tool is deliberately
 * ungated — so without this it could compose a lock-screen notification
 * indistinguishable from a real gate and collect a "yes" for something that was
 * never gated at all. Bracketing the imitation keeps the words and breaks the
 * costume, the same trick `defang` plays on source tags in main.ts.
 */
const IMITATION = /^[ \t]*(approve[ \t]*·.*|tap an answer\..*)$/gim;
const unframe = (text: string) => text.replace(IMITATION, (line) => `(${line.trim()})`);

/** Collections come back either bare or wrapped depending on the endpoint. */
const list = (result: any, key: string): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.[key]) ? result[key] : [];

/** whoami has moved shape before; take the name from wherever it is. */
export const nameOf = (whoami: any): string | null => whoami?.agent?.name ?? whoami?.name ?? null;

export class AgentUpdate {
  readonly enabled: boolean;
  private token: string;
  private backoffUntil = 0;

  constructor(token: string | undefined) {
    this.token = token ?? '';
    this.enabled = this.token.length > 0;
  }

  private async call(path: string, init: RequestInit = {}): Promise<any> {
    if (!this.enabled || Date.now() < this.backoffUntil) return null;
    try {
      const response = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(75_000),
      });
      if (response.status === 429 || response.status >= 500) {
        // Their limit is 60 messages/min. Backing off is cheaper than retrying.
        this.backoffUntil = Date.now() + 60_000;
        journal.record('agentupdate.backoff', { status: response.status });
        return null;
      }
      if (!response.ok) {
        journal.record('agentupdate.error', { path, status: response.status });
        return null;
      }
      return await response.json();
    } catch (error) {
      journal.record('agentupdate.error', { path, error: String(error) });
      return null;
    }
  }

  whoami = () => this.call('/v1/agent/whoami');

  send = (text: string) =>
    this.call('/v1/agent/messages', {
      method: 'POST',
      body: JSON.stringify({ text: text.slice(0, 8000), nonce: crypto.randomUUID() }),
    });

  /**
   * Posts a question block — text plus tappable options — and returns its id.
   *
   * Approvals are the same block with the stakes spelled out, because the phone
   * is where most of them get answered and a lock screen carries no other
   * context. The wire format stays `kind: 'question'`: the framing lives in the
   * body, which is the part the app renders and the part we can rely on.
   */
  async ask(request: Ask): Promise<string | null> {
    const text = request.kind === 'approval' ? approvalBlock(request) : unframe(request.text);
    const options = request.options?.length
      ? request.options.slice(0, 6).map((o) => (request.kind === 'approval' ? o : unframe(o)).slice(0, 48))
      : null;
    const result = await this.call('/v1/agent/messages', {
      method: 'POST',
      body: JSON.stringify({
        text: text.slice(0, 8000),
        kind: 'question',
        nonce: request.nonce ?? crypto.randomUUID(),
        ...(options ? { options } : {}),
      }),
    });
    return result?.id ?? null;
  }

  /** Long-poll a single question. Resolves to the answer text, or null on timeout. */
  async answer(messageId: string, waitSeconds = 55): Promise<string | null> {
    const result = await this.call(`/v1/agent/messages/${messageId}/answer?wait=${waitSeconds}`);
    return result?.answered ? (result.answer as string) : null;
  }

  rooms = async (): Promise<Room[]> => list(await this.call('/v1/agent/rooms'), 'rooms');

  sendRoom = (roomId: string, text: string) =>
    this.call(`/v1/agent/rooms/${roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: text.slice(0, 8000), nonce: crypto.randomUUID() }),
    });

  /**
   * Everything new since the stored cursor, oldest first. The caller decides
   * what to act on and calls `seen()` per message, so the cursor only advances
   * past work that actually happened — a crash mid-turn replays it.
   */
  async poll(): Promise<Inbound[]> {
    const after = journal.get(CURSOR);
    const result = await this.call(`/v1/agent/messages?limit=50${after ? `&after=${after}` : ''}`);
    return list(result, 'messages').map((m: any) => ({
      id: m.id,
      role: m.role === 'user' ? 'user' : 'agent',
      body: m.body ?? '',
      from: m.from?.name ?? null,
      room: m.room ? { id: m.room.id, name: m.room.name } : null,
    }));
  }

  seen(messageId: string) {
    journal.set(CURSOR, messageId);
  }
}
