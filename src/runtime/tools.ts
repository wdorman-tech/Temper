import type { Ctx, Tool } from '../../agent/tools/_kit.ts';
import { tools } from '../../agent/tools/index.ts';
import type { State, Status } from '../protocol.ts';
import { journal } from './journal.ts';
import { memory } from './memory.ts';
import { schedules } from './schedules.ts';

/**
 * Where tools actually run, and where the effect gate lives.
 *
 * This is inside the supervisor on purpose. The tool server is a separate
 * process spawned by Codex, running as the same user as the agent's shell — so
 * anything the tool server could do, the shell could do by talking to it. By
 * keeping capabilities here and exposing only `list` and `call` over the
 * socket, a shell that connects to it gains exactly nothing the model didn't
 * already have: it can invoke a tool, and that tool still has to clear a human.
 *
 * `ctx` is built per call and handed only to `run`, so a credential can only be
 * fetched from inside a tool invocation the human approved.
 */
export type Approval = {
  /** The tool whose effect is gated. Named on the block, so they know what asked. */
  tool: string;
  /** One line they approve or refuse at a glance, on a phone, with no context. */
  preview: string;
  /** The only answers that count. Anything else is a refusal. */
  options: string[];
};

/**
 * What came back from an approval block.
 *
 * `chosen` is one of the offered options or null; `answer` is what they actually
 * said, kept for the journal and so the agent can be told the difference between
 * "nobody is there" and "they replied with a sentence".
 */
export type Decision = { chosen: string | null; answer: string | null };

export type Deps = {
  /** Resolves to null when the human never answered. Never a default answer. */
  ask: (question: string, options?: string[]) => Promise<string | null>;
  /**
   * A decision that gates an effect. Goes out as a question block to the
   * terminal and their phone at once; whichever they answer first wins.
   */
  approve: (request: Approval) => Promise<Decision>;
  notify: (text: string) => Promise<void>;
  status: (patch: Partial<Pick<Status, 'detail' | 'metrics'>> & { state?: State }) => void;
  rooms: { list: () => Promise<unknown>; send: (roomId: string, text: string) => Promise<unknown> };
  /** Held in memory by the supervisor; never in the container's environment. */
  secrets: Map<string, string>;
};

export type Listed = { name: string; description: string; inputSchema: unknown };

/**
 * The only answers an approval accepts, matched exactly and never by substring.
 * They are constants because the option the human taps and the branch taken here
 * must be the same string — a gate that reads its own labels loosely is not one.
 */
const ALLOW_ONCE = 'Allow once';
const ALLOW_SESSION = 'Allow all session';
const ALLOW_CREDENTIAL = 'Yes, this session';
const DECLINE = 'No';

export function toolHost(deps: Deps) {
  const duplicates = tools.map((t) => t.name).filter((name, i, all) => all.indexOf(name) !== i);
  if (duplicates.length) throw new Error(`two tools share a name: ${duplicates.join(', ')}`);

  // Keyed by tool for "allow all session", and by tool+secret for credentials.
  const allowed = new Set<string>();

  /**
   * A preview is one line, and it has to stay one line.
   *
   * Previews interpolate model-written arguments — that is the whole point of
   * them — so newlines in an argument would let the model draw its own headings
   * and footers inside the approval block, on a lock screen, where structure is
   * the only thing telling a human what they are agreeing to.
   */
  const oneLine = (text: string) => {
    const flat = text.replace(/\s*[\r\n]+\s*/g, ' · ').trim();
    return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
  };

  const preview = (tool: Tool, args: Record<string, unknown>) => {
    const custom = tool.preview?.(args);
    if (custom) return oneLine(custom);
    const json = JSON.stringify(args) ?? '{}';
    return oneLine(json.length > 160 ? `${tool.name} ${json.slice(0, 160)}… (${json.length} chars)` : `${tool.name} ${json}`);
  };

  const contextFor = (tool: Tool): Ctx => ({
    // A question is the one place silence can be reported rather than refused —
    // the agent is told to route around it instead of stalling until morning.
    ask: async (question, options) =>
      (await deps.ask(question, options)) ??
      'No answer — they have been away for an hour. Do not wait on this. Do whatever the answer ' +
        'does not change, and leave the question for them.',
    notify: deps.notify,
    status: async (patch) => deps.status(patch),
    remember: async (note) => memory.write(note),
    recall: async (query) => memory.search(query),
    forget: async (id) => memory.forget(id),
    history: async (limit, kind) => journal.recent(Math.min(limit, 200), kind),
    schedules: {
      list: async () => schedules.list(),
      // Push status after either change so the dashboard's "next:" is right
      // the moment the agent sets a schedule, not whenever it next speaks.
      upsert: async (input) => {
        const created = schedules.upsert(input);
        deps.status({});
        return created;
      },
      remove: async (id) => {
        const removed = schedules.remove(id);
        deps.status({});
        return removed;
      },
    },
    rooms: deps.rooms,
    note: async (kind, data) => journal.record(`agent.${kind}`, data),

    async secret(name) {
      const value = deps.secrets.get(name);
      if (value === undefined) {
        throw new Error(`no secret named ${name}. Add it to agent/manifest.ts with scope: 'gated'.`);
      }
      const key = `${tool.name}:${name}`;
      if (!allowed.has(key)) {
        const options = [ALLOW_CREDENTIAL, DECLINE];
        const { chosen, answer } = await deps.approve({
          tool: tool.name,
          preview: `Let ${tool.name} use the ${name} credential for the rest of this session?`,
          options,
        });
        if (chosen === null) {
          throw new Error(
            answer === null
              ? `nobody answered, so ${name} stays sealed. Try again when they are back.`
              : `they replied "${answer}" instead of choosing, so ${name} stays sealed. Ask again and let them pick an option.`,
          );
        }
        if (chosen === DECLINE) throw new Error(`the human declined ${name} to ${tool.name}`);
        allowed.add(key);
      }
      journal.record('secret.used', { tool: tool.name, name });
      return value;
    },
  });

  return {
    list: (): Listed[] =>
      tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.input })),

    async call(name: string, args: Record<string, unknown>): Promise<{ text: string; failed: boolean }> {
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { text: `no such tool: ${name}`, failed: true };

      if (tool.effect === 'write' && !allowed.has(tool.name)) {
        const line = preview(tool, args);
        const options = tool.repeatable ? [ALLOW_ONCE, ALLOW_SESSION, DECLINE] : [ALLOW_ONCE, DECLINE];
        const { chosen, answer } = await deps.approve({ tool: tool.name, preview: line, options });

        // Silence is a refusal here, always — an agent that acts on an unanswered
        // approval has turned "ask first" into "ask, then do it anyway". So is
        // prose: an approval is a choice between the options that were offered,
        // and anything else is a human who has not made one yet.
        if (chosen === null) {
          journal.record('unapproved', { tool: name, preview: line, answer });
          return {
            text:
              answer === null
                ? 'Nobody answered, so this did not run. Do not retry it until they are back and say yes.'
                : `They replied "${answer}" instead of choosing an option, so this did not run. That is not a yes — ` +
                  'read what they said, and if it still needs doing ask again in one line and let them pick.',
            failed: true,
          };
        }
        if (chosen === DECLINE) {
          journal.record('declined', { tool: name, preview: line, answer });
          return { text: 'the human declined. Do not retry without a new instruction from them.', failed: true };
        }
        if (chosen === ALLOW_SESSION) allowed.add(tool.name);
        journal.record('approved', { tool: name, preview: line, scope: chosen === ALLOW_SESSION ? 'session' : 'once' });
      }

      try {
        const result = await tool.run(args, contextFor(tool));
        journal.record('tool', { tool: name, args });
        return { text: typeof result === 'string' ? result : JSON.stringify(result, null, 2), failed: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        journal.record('tool.failed', { tool: name, args, error: message });
        return { text: message, failed: true };
      }
    },
  };
}
