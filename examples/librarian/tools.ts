import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { type Ctx, defineTool, input } from '../../agent/tools/_kit.ts';

/**
 * Two tools, because two things this agent does are not shell work: a
 * credential the container must never hold, and a delete that has to be
 * reversible.
 *
 * Everything else — reading pages, grepping for a broken wikilink, rewriting
 * frontmatter, counting orphans — is one shell command away and does not get a
 * tool. See docs/BUILD_GUIDE.md §4.
 */

/** The vault is the folder the human started the agent in. Never a host path. */
const VAULT = '/workspace/project';

/** Where source material lands. Append-only, so nothing here is ever rewritten. */
const RAW_EMAIL = join(VAULT, 'raw', 'email');

/** Gmail ids already written, so running the sync twice writes nothing twice. */
const SEEN = join(VAULT, '.librarian', 'gmail-seen.json');

/**
 * Filename patterns the vault refuses to open, mirrored here.
 *
 * A subject line like "Stripe API key rotation" would otherwise become a
 * filename the agent is forbidden to read — the mail would be saved and
 * invisible, which is worse than not saving it. So the subject leaves the
 * *filename* and the message is still written. This protects availability, not
 * secrecy: the subject is still in the page's frontmatter, and the rule about
 * live keys in a page body takes over from there.
 */
const SECRET_PATTERNS = [
  /key/i,
  /pass/i,
  /login/i,
  /token/i,
  /secret/i,
  /credential/i,
  /recovery code/i,
  /backup code/i,
  /seed phrase/i,
];

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name?: string; value?: string }[];
};

type GmailMessage = { id?: string; threadId?: string; payload?: GmailPart };

/* --------------------------------------------------------------- fetch_mail */

async function accessToken(ctx: Ctx): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: await ctx.secret('GMAIL_CLIENT_ID'),
      client_secret: await ctx.secret('GMAIL_CLIENT_SECRET'),
      refresh_token: await ctx.secret('GMAIL_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    // Only a human can fix a revoked grant, so name the action that fixes it.
    throw new Error(
      `Google refused the saved sign-in (${response.status}). Re-authorise the OAuth client and ` +
        `update GMAIL_REFRESH_TOKEN. ${body.error_description ?? ''}`.trim(),
    );
  }
  return body.access_token;
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`gmail ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const header = (message: GmailMessage, name: string): string =>
  message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

const decode = (data: string): string =>
  Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** Plain text if the message has any, depth first. HTML is stripped only as a fallback. */
function text(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const found = text(child);
    if (found) return found;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decode(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{3,}/g, '\n\n')
      .trim();
  }
  return '';
}

function filename(subject: string, id: string): string {
  const cleaned = subject
    .replace(/[\\/:*?"<>|[\]#^]/g, '')
    .trim()
    .slice(0, 70);
  const safe = SECRET_PATTERNS.some((pattern) => pattern.test(cleaned)) ? 'message' : cleaned;
  return `${(safe || 'message').replace(/\s+/g, ' ')} (${id.slice(-8)}).md`;
}

function page(message: GmailMessage): string {
  const subject = header(message, 'Subject') || '(no subject)';
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(subject)}`,
    `from: ${JSON.stringify(header(message, 'From'))}`,
    `to: ${JSON.stringify(header(message, 'To'))}`,
    `date: ${JSON.stringify(header(message, 'Date'))}`,
    `gmail_id: ${message.id ?? ''}`,
    `gmail_thread: ${message.threadId ?? ''}`,
    'source: gmail',
    '---',
    '',
  ].join('\n');
  return `${frontmatter}# ${subject}\n\n${text(message.payload).trim()}\n`;
}

export const fetchMail = defineTool<{ query?: string; limit?: number }>({
  name: 'fetch_mail',
  description:
    'Pull new mail into raw/email/, one markdown file per message, and nothing else — no filing, ' +
    'no summarising, no judgement. A page written here is indistinguishable from one the human ' +
    'saved by hand, which is the point: one path in for source material rather than two. Messages ' +
    'already written are skipped by id, so running it twice costs nothing. Read-only against ' +
    'Gmail: it cannot send, archive or delete.',
  input: input({
    query: {
      type: 'string',
      description: 'Gmail search. Default "in:inbox -category:promotions -category:social".',
      optional: true,
    },
    limit: { type: 'number', description: 'Messages to consider. Default 50, max 200.', optional: true },
  }),
  run: async (args, ctx) => {
    const query = args.query ?? 'in:inbox -category:promotions -category:social';
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const token = await accessToken(ctx);

    const seen = new Set<string>(
      existsSync(SEEN) ? (JSON.parse(readFileSync(SEEN, 'utf8')) as string[]) : [],
    );
    const list = await gmail<{ messages?: { id?: string }[] }>(
      token,
      `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
    );

    mkdirSync(RAW_EMAIL, { recursive: true });
    mkdirSync(dirname(SEEN), { recursive: true });

    const written: string[] = [];
    for (const stub of list.messages ?? []) {
      if (!stub.id || seen.has(stub.id)) continue;
      const message = await gmail<GmailMessage>(token, `/messages/${stub.id}?format=full`);
      writeFileSync(join(RAW_EMAIL, filename(header(message, 'Subject'), stub.id)), page(message), 'utf8');
      seen.add(stub.id);
      written.push(stub.id);
    }

    // Trimmed, because this is a dedupe set and not a history. The journal is
    // the history.
    writeFileSync(SEEN, JSON.stringify([...seen].slice(-5000)), 'utf8');
    await ctx.note('vault.fetch_mail', { query, written: written.length });
    return { matched: (list.messages ?? []).length, written: written.length };
  },
});

/* -------------------------------------------------------------------- trash */

export const trash = defineTool<{ path: string; why: string }>({
  name: 'trash',
  description:
    'Remove a page by moving it to .librarian/trash/<today>/ with its folder layout kept. This is ' +
    'the only removal path in this vault: rm has no undo, and a page nobody can get back is worse ' +
    'than a page nobody reads. Paths are relative to the vault root. Refuses anything under raw/.',
  effect: 'write',
  input: input({
    path: { type: 'string', description: 'Vault-relative path, e.g. "notes/Old Stub.md".' },
    why: { type: 'string', description: 'One clause. It goes in the approval block and in log.md.' },
  }),
  preview: (args) => `trash ${args.path} — ${args.why}`,
  run: async (args, ctx) => {
    const from = resolve(VAULT, args.path);
    const rel = relative(VAULT, from);
    if (!rel || rel.startsWith('..')) throw new Error(`${args.path} is outside the vault.`);
    // Append-only, enforced here rather than hoped for. An agent that can talk
    // its way past this one has taken away the human's only undo.
    if (rel.split('/')[0] === 'raw') {
      throw new Error(
        'raw/ is append-only. Source material is never removed — write a corrected page elsewhere and link to it.',
      );
    }
    if (!existsSync(from)) throw new Error(`${rel} does not exist.`);

    const day = new Date().toISOString().slice(0, 10);
    const to = join(VAULT, '.librarian', 'trash', day, rel);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    await ctx.note('vault.trash', { path: rel, why: args.why });
    return `moved to .librarian/trash/${day}/${rel}`;
  },
});
