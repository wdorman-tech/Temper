import type { State, Status } from '../../src/protocol.ts';

/**
 * Everything you need to write a tool.
 *
 * A tool is a plain object: a name, a sentence of description, an input shape,
 * and a `run`. Drop a file in this folder, export it from `index.ts`, restart.
 * That is the whole extension model.
 *
 * Tools execute inside the supervisor, not inside the tool server, so `ctx` is
 * a direct call — there is no channel a shell could reach to get at these
 * capabilities without going through the same gate the model does.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export type Field = {
  type: FieldType;
  description: string;
  optional?: true;
  enum?: string[];
  items?: FieldType;
  /** Escape hatch: a raw JSON Schema fragment, for the rare structured argument. */
  schema?: Record<string, unknown>;
};

/** Turns a readable field map into the JSON Schema the model actually sees. */
export function input(fields: Record<string, Field>) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    properties[name] = field.schema ?? {
      type: field.type,
      description: field.description,
      ...(field.enum ? { enum: field.enum } : {}),
      ...(field.items ? { items: { type: field.items } } : {}),
    };
    if (!field.optional) required.push(name);
  }
  return { type: 'object' as const, properties, required, additionalProperties: false };
}

export type Tool<Args = any> = {
  name: string;
  description: string;
  input: ReturnType<typeof input>;
  /**
   * `write` means it changes something outside this container — sends mail,
   * moves money, posts to an API, touches a mounted folder. Those tools stop
   * and put an approval block in front of the human, in the terminal and on
   * their phone, and run only if they choose to allow it. Talking to the human
   * is not an effect; acting on the world is.
   */
  effect?: 'read' | 'write';
  /**
   * Offer "allow for the whole session" when approving. Only set this when
   * repeating the action with *different arguments* is still something the
   * human would say yes to — a blanket yes to `send_email` is not that.
   */
  repeatable?: true;
  /**
   * One line, shown in the approval block — in the terminal and on a phone lock
   * screen, where it is the only context there is. Write the sentence someone
   * needs in order to say yes or no: `invoice acme for $4,200`, not the tool
   * name and a blob of JSON.
   */
  preview?: (args: Args) => string;
  run: (args: Args, ctx: Ctx) => Promise<unknown>;
};

export const defineTool = <Args>(tool: Tool<Args>): Tool<Args> => tool;

export type Ctx = {
  /** Ask the human and wait. Reaches the terminal and their phone. */
  ask(question: string, options?: string[]): Promise<string>;
  /** Tell the human something. Does not wait. */
  notify(text: string): Promise<void>;
  /** Update the dashboard. Any subset. */
  status(patch: Partial<Pick<Status, 'detail' | 'metrics'>> & { state?: State }): Promise<void>;
  remember(note: { id: string; title?: string; body: string; tags?: string[] }): Promise<unknown>;
  recall(query: string): Promise<unknown>;
  forget(id: string): Promise<unknown>;
  /** The agent's own history, newest first. Pass a kind to filter. */
  history(limit: number, kind?: string): Promise<unknown>;
  schedules: {
    list(): Promise<unknown>;
    upsert(s: { id?: string; name: string; cron: string; prompt: string; tz?: string }): Promise<unknown>;
    remove(id: string): Promise<unknown>;
  };
  rooms: {
    list(): Promise<unknown>;
    send(roomId: string, text: string): Promise<unknown>;
  };
  /**
   * A credential the container is not trusted to hold. The host keeps it and
   * hands it over only inside an approved tool call, so it never appears in
   * the environment the agent's shell can read. Let it throw — a declined
   * credential means the human said no.
   */
  secret(name: string): Promise<string>;
  /** Write a line to the journal. Shows up in history, not in chat. */
  note(kind: string, data?: unknown): Promise<void>;
};
