# Building Librarian

An agent that keeps an Obsidian vault as a connected set of pages rather than a
pile of summaries. It takes in web clippings, chat exports, PDFs and email,
files them where they belong, keeps the vault clean, and answers questions
about what is in it.

You are a coding agent. This is the build, in order, with the reasoning that
lets you change it when the human's vault is not the one this was written
against. Read [`../../docs/BUILD_GUIDE.md`](../../docs/BUILD_GUIDE.md) first —
this guide assumes its standard and does not repeat it. The interface work in
its §5 and §8 is runtime debt, not part of building an agent; leave it alone
unless you were asked for it.

---

## 1. Why this job is hard

Filing is easy to automate badly. The obvious build is a pipeline — triage,
file, prune, answer — with a model filling in the text at each stage, and it
fails because every branch has to be written in advance. A null where a list was
expected takes the daemon down. Ambiguity has nowhere to go.

The agent version has no stages. It has the vault and a shell, so "which folder
does this go in" is settled by looking: the neighbouring pages, how the last
twenty were filed, what the vault already says about the subject.

The agent is also standing in someone's second brain with write access, and the
failure that matters is not a crash. It is a page quietly deleted, a credential
indexed, or a `[[wikilink]]` to a page that does not exist — which is worse than
an admitted gap, because future work follows it and finds nothing.

So the job splits: **judgement gets freedom, destruction gets a gate.**

---

## 2. The interview

- **Where is the vault, and is it the only thing this agent works on?** If yes,
  the human runs the command inside it and you need no mount. Ask this first —
  it decides the whole shape, and §4 is why.
- **What already lands in it, and how?** Browser clipper, exports, a script,
  mail. Each is either "a file appears in a folder" or "you have to go get it",
  and only the second needs a tool.
- **Does the vault have a schema?** A `CLAUDE.md` at the root, a folder
  convention, a frontmatter habit. If it does, it outranks anything you write.
- **What must never be deleted?** Get filenames and folders, not categories.
- **What does it mean for a page to be good here?** For this human it was
  connectedness: a page that does not say what it agrees and disagrees with is
  not filed, it is stored.
- **How often does he want to hear from it?** Get a ceiling and a topic list.
  Almost every filing agent is built too chatty and gets muted.

---

## 3. Name it, before the first run

CLAUDE.md says three places. It is four, and one of them cannot be done yet.

1. `manifest.name` in `agent/manifest.ts` → `'librarian'`. Names the image, the
   container and the volume.
2. `manifest.settings` — the `TEMPER_NAME` entry ships with
   `default: 'temper'` and the wizard prefills from it, so a human who presses
   enter through setup gets an agent that calls itself `temper` on his phone.
   Set `manifest.tagline` too; it is the line he reads on the first screen.
3. `package.json` → `"name": "librarian"` and
   `"bin": { "librarian": "dist/src/cli.js" }`.
4. `.env` — **written by the wizard on the first run**, so there is nothing to
   edit yet. Fix `TEMPER_NAME` in `.env.example`, which is the reference copy.

Do the first three now: `manifest.name` names the volume, so renaming after the
first run leaves the agent's memory behind in the old one. `npm run build &&
npm link` belongs at the end of §9 — linking now puts a command on `PATH` with
no tools behind it. `npm unlink -g temper` clears the stale link and takes the
name the package was registered under, which is still the old one. Then fix
`README.md`, which carries a dozen `temper` references including the command
table.

---

## 4. The vault is the folder

Temper gives an agent one folder, mounted writable at `/workspace/project`, and
nothing else on the machine. Anything outside it needs a `mountAs` setting,
which is a real hole in the sandbox: the agent's shell writes straight through a
mount with no gate in front of it.

The obvious build mounts the vault. Do not. **Have the human run the command
inside the vault.**

```sh
cd ~/Documents/vault
librarian
```

Now `/workspace/project` *is* the vault, and three things follow:

- **No mount, so no hole.** The one exception to the sandbox goes unused.
- **The container has nothing else in it.** That is what makes writable access
  to the vault safe: the blast radius is the vault, which is the job.
- **A second vault is a second agent.** `cd` to another vault and run the
  command again; it gets its own container, memory, journal and schedules. The
  two cannot see each other, which is right — filing conventions from one vault
  are wrong in the other.

Write this into `NORTH_STAR.md`, not just into your head. Nothing in
`manifest.ts` reaches the model, and neither does your build plan.

**Be honest about what it costs, here rather than later.** `raw/` is now inside
a writable folder, so append-only cannot be a mount flag. What replaces it is a
refusal in the `trash` tool (§8) — which is a well-lit correct path, not a
guarantee. The shell can still `rm`. Say that in the north star in plain words;
an agent told `raw/` is protected will believe it.

Two cases this design does not cover, and you should raise both at interview:

- **A second folder that is not the vault.** A Zotero library, a Downloads
  folder the clipper writes to, a shared drive. That is what `mountAs` is
  actually for — the second folder, never the first.
- **A vault with a symlink in it.** Vaults commonly hold one, and a symlink
  inside the project folder resolves on the *host* side of the bind mount. §8's
  path check uses `realpath` for exactly this reason; a check built on `resolve`
  alone walks straight out of the sandbox while looking like it did not.

---

## 5. Write the north star

`agent/NORTH_STAR.md`, from §2's answers, before any code.
[`NORTH_STAR.md`](NORTH_STAR.md) here is one human's; read it for the shape.
Five things in it do the work:

**The four invariants, as rules with consequences.** `raw/` is append-only.
Nothing is hard-deleted. Credentials are invisible. Never invent a link. One
sentence of rule and one of why, because a rule whose reason the model can
reconstruct survives a paraphrase.

**The credential list is a list, not a principle.** Eleven globs, spelled out.
`recovery code` and `backup code` are covered by none of the shorter patterns,
which is why enumerating beats generalising.

**Ask-once-per-run, with the four forks named.** A naming convention about to be
applied to many pages; whether two pages should merge; anything destructive
beyond one obvious stub; a source that could be important or noise. Then the
inverse: *do not ask about things you can find out.* Which folder similar pages
live in is in the vault, and looking is the job.

**The vault's conventions outrank yours.** `CLAUDE.md` in the vault root, if it
exists, beats the north star on naming, frontmatter and placement. Otherwise
copy the neighbours. An agent that imposes its own taxonomy on an existing vault
has made every future page harder to find.

**A ceiling on speech, with the topics named.** *A few things a week*, and only:
a contradiction with a position he has recorded, a decision that needs him, or a
subject arriving repeatedly with no page yet. Everything else goes in `log.md`.
Without both halves the agent invents its own threshold and gets muted.

Add a `## Status` section — the boilerplate north star has none, and the
dashboard is free-form, so this file decides its content. `detail` is one line
(`filing raw/email · 6 left`); `metrics` is `raw 6 · filed today 14 ·
orphans 3`. Tell it the default `fetch_mail` query here too; the model never
reads `manifest.ts`.

---

## 6. Settings

[`settings.ts`](settings.ts) is three entries and they are one Google client:
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, all
`scope: 'gated'`. Those key strings are what `ctx.secret()` takes in §7, so
paste the entries into `agent/manifest.ts` before you write the tools.

Gated is the point. A refresh token in the container's environment is one `env`
away from the model, and this agent has a shell. It is a good fence, and for a
credential to someone's mail it is the fence that matters — BUILD_GUIDE §3 has
the precise boundary and its limits.

The scope is `gmail.readonly`, which cannot send, archive or delete. The worst
case of a bug in `fetch_mail` is a page the human did not want, never an email
he cannot get back. Ask for the narrowest scope that does the job and say so in
the `why`; it is the sentence that gets a nervous person through the wizard.

**All three are `optional: true`,** and that is load-bearing. The wizard has no
way past a required setting with no default, so three mandatory OAuth fields
would mean a human with a vault and no interest in mail cannot finish setup at
all. Mail is a bonus here; the vault works without it. (Contrast
[`../calendar`](../calendar/GUIDE.md), where the same three fields are required
because that agent does nothing without them.)

The cost of `optional` is that `fetch_mail` can be called with nothing behind
it, and the runtime's own error for a missing gated secret tells the *model* to
edit `agent/manifest.ts` — a file it cannot edit. Catch it and name the human
action instead:

```ts
throw new Error(
  `${name} is not configured, so there is no mail to fetch. Tell the human to run setup again ` +
    'and fill in the three Google fields, or drop it — the vault works without mail.',
);
```

There is no vault setting, because of §4. There is no `GMAIL_QUERY` setting
either: the tool defaults to `in:inbox -category:promotions -category:social`
and takes a `query` argument, so the human changes it by saying so. That only
works if the default is written into `NORTH_STAR.md`, which is why §5 says to.

The refresh token comes from Google's OAuth playground — the same limitation the
[calendar agent](../calendar/GUIDE.md) has, and its §6 explains it.

---

## 7. The tools — two, and why not more

Inside the container the agent has a shell, `curl`, `python3`, `git` and the
web. Reading pages, grepping for a broken wikilink, rewriting frontmatter,
counting orphans, diffing two near-duplicate pages — all shell.

Two things are not, and they go in `agent/tools/librarian.ts`, a new file next
to `_kit.ts`:

| Tool | Effect | Arguments | Returns |
| --- | --- | --- | --- |
| `fetch_mail` | — (credential-gated) | `query?`, `limit?` (default 50, max 200) | `{matched, written}` |
| `trash` | `write` | `path` (vault-relative), `why` | a sentence naming the destination |

### `fetch_mail` — because there is a credential to hold

Pulls new mail into `raw/email/`, one markdown file per message, and does
nothing else. No filing, no summarising, no judgement — so a page written by the
sync is indistinguishable from one the human saved by hand, and there is **one
path in for source material** rather than two. Every "and while we're here,
let's classify it" is a second code path that will disagree with the first.

It is **not** `effect: 'write'`. It writes into the project folder, which is
ordinary work, and it cannot send, archive or delete at Google. The gate it
needs is the credential gate, and `ctx.secret()` raises that on its own — one
approval block per tool per credential per session, so a cold `fetch_mail` costs
three taps and then none.

The API, in the order you need it:

```
POST https://oauth2.googleapis.com/token
     form-encoded: client_id, client_secret, refresh_token, grant_type=refresh_token
     → { access_token }

base: https://gmail.googleapis.com/gmail/v1/users/me
GET  /messages?q={query}&maxResults={limit}    → { messages?: [{ id }] }
GET  /messages/{id}?format=full                → { id, threadId, payload }
```

Five things in there will bite you:

- **`messages` is absent, not empty, on zero hits.** Read it as
  `list.messages ?? []`. This is the exact `null where a list was expected` from
  §1, and it is the one instance you are guaranteed to meet.
- **The body is a MIME part tree with base64url bodies.** Recurse for
  `text/plain`; fall back to stripping tags out of `text/html` only if there is
  none. Decode with `Buffer.from(data.replace(/-/g,'+').replace(/_/g,'/'),
  'base64')`.
- **The filename has to be unique and stable**, because the tool is meant to be
  safe to schedule and safe to retry. Suffix the last eight characters of the
  Gmail id; two messages with the same subject then cannot collide, and a rerun
  writes the same path.
- **A sensitive subject leaves the filename, not the mail.** Mirror the vault's
  credential globs in the tool and substitute `message` for a matching subject.
  Otherwise "Stripe API key rotation" becomes a file the agent is forbidden to
  open — saved and invisible, which is worse than not saved. Be clear-eyed: this
  protects availability, not secrecy. The subject is still in the frontmatter,
  and the rule about live keys in a page body takes over from there.
- **Write the seen-set once, at the end.** `.librarian/gmail-seen.json`, trimmed
  to the last 5,000 ids. Per-message writes cost you nothing on a crash; one
  write at the end loses the record of what was already written. Trim from the
  front — it is a dedupe set, not a history, and the journal is the history.

Frontmatter: `title`, `from`, `to`, `date`, `gmail_id`, `gmail_thread`,
`source: gmail`. Run every header value through `JSON.stringify` — a `From` like
`Ann "The Boss" <ann@example.com>` is not valid YAML unquoted.

### `trash` — because there is an effect to gate

Removal is a move to `.librarian/trash/<today>/` — ISO date — with the folder
layout kept. That is the undo path; `rm` has none.

It is `effect: 'write'`, so it stops and puts a block in front of the human in
the terminal and on their phone. The preview is written for a lock screen:

```
trash notes/Old Stub.md — empty since March, superseded by [[Filing]]
```

Not `trash {"path":"notes/Old Stub.md","why":"…"}`. It is not `repeatable`.

---

## 8. The rules that live in code

Three checks in [`tools.ts`](tools.ts) enforce two of the four invariants.

```ts
const from = realpathSync.native(resolve(VAULT, args.path));
const rel = relative(realpathSync.native(VAULT), from);
if (!rel) throw new Error('That is the vault itself, not a page in it.');
if (rel.startsWith('..')) throw new Error(`${args.path} resolves outside the vault.`);
```

`realpath`, not `resolve` — see §4. `resolve` normalises `..` and an absolute
path but does not follow a symlink, and a vault with one in it is a vault the
agent can walk out of. Note the two branches: an empty `rel` means the vault
root, which is not "outside the vault", and telling the model it is teaches it
something false about its own boundary.

```ts
if (rel.split('/')[0] === 'raw') {
  throw new Error('raw/ is append-only. Source material is never removed — write a corrected page instead.');
}
if (rel.split('/')[0] === '.librarian') {
  throw new Error(".librarian/ is the agent's own state, not a page. Nothing in it is trashed.");
}
```

The first is the append-only invariant, enforced rather than requested, and it
matters because §4 gave up the ability to enforce it with a read-only mount. The
second stops the agent trashing its own trash — that directory is reachable like
anything else, and a removal there is the one delete with nowhere left to go.

Neither stops the shell, and a second approval prompt inside the container would
not help; the sandbox is the boundary. What the guards buy is that the correct
path is the easy one, that the wrong one is never what the model reaches for
first, and that every removal is in the journal with a reason attached.

---

## 9. Wire it up

```ts
// agent/tools/index.ts
import { fetchMail, trash } from './librarian.ts';

export const tools: Tool[] = [
  ask, notify, status,
  remember, recall, forget,
  history,
  schedule, unschedule, schedules,
  rooms, roomSend,
  fetchMail, trash,
];
```

Do §7 first, or `npm run check` is broken in between.

**Paste** the settings from [`settings.ts`](settings.ts) into
`agent/manifest.ts` — never import them. The Dockerfile copies `src/` and
`agent/` into the image and nothing else, so an import from `examples/`
typechecks on your machine and is missing at runtime. Delete the
`WEBHOOK_TOKEN` and `NOTES_DIR` placeholders and `agent/tools/example.ts` in
the same edit; the tool and the setting it uses are a pair. `.env.example` is
that list again, so fix it here too — a reference file that disagrees with
`manifest.ts` is worse than not having one.

Two edits to `agent/AGENTS.md`. Do not replace the file and do not touch the
voice. Add a `## The vault` section saying the folder is a vault, that `raw/` is
append-only, and that removal is the `trash` tool. Then add one paragraph to
`## Memory` naming the notes that earn their place here: `vault-shape.md`,
revised rather than duplicated, and one note per recurring subject where the
human has taken a position.

Raise `model_reasoning_effort` to `"high"` in `agent/codex.toml`. Filing is
judgement work done unattended, which is what the higher setting is for.

Then `npm run build && npm link`, and the command exists.

---

## 10. Day one, and the schedules it writes itself

`## How it starts` is a read-only first run: read the vault, write
`memory/vault-shape.md`, show it, propose what it would fix on its own, and wait
for a yes.

Insist on this. An agent that reorganises a second brain on its first afternoon
costs the human a bad afternoon even when every individual move is right,
because he cannot tell a good reorganisation from a bad one at that volume.
Three proposals he agrees to beat thirty he has to audit.

The other day-one artefact is `log.md` in the vault root — one line per filing
run: what came in, what was written, what was skipped and why. It is how he
audits the agent without reading every page, and it is what makes "I skipped 14
newsletters" a fact rather than a claim.

There is nowhere in `agent/` to seed a schedule, so these go into
`## How it starts` as instructions and the agent creates them with the
`schedule` tool:

```
name:   pull mail
cron:   */30 9-19 * * 1-5
prompt: Call fetch_mail. Then file anything new in raw/, oldest first, using
        the sweep in NORTH_STAR.md. Append one line to log.md. Say nothing
        unless something needs the human.
```

```
name:   vault sweep
cron:   0 18 * * 0
prompt: Check for broken wikilinks, orphan pages, frontmatter that disagrees
        with its neighbours, and near-duplicate pages. Fix what is safe. Write
        a note listing what is not safe and why, and show it.
```

Write each prompt for a future self with no memory of today.

---

## 11. Test it

```sh
npm run check
npm run build
npm start -- setup         # needs Docker running: the preflight is before the wizard
cd ~/some/real/vault && librarian
```

Never test from the checkout — `npm start` makes the agent work on Temper's own
source, which is not what any human does.

Then, for this agent:

- **Ask it to trash something under `raw/`.** It must refuse, and the refusal
  must say why.
- **Put a symlink in the vault pointing outside it and try to trash through
  it.** It must refuse. This is the check that proves §4's claim.
- **Ask it a question the vault has nothing on.** It must say the vault has
  nothing on it. A fabricated `[[link]]` here is the failure this design exists
  to prevent, and it is the best single test of whether the north star landed.
- **Run `fetch_mail` twice.** The second run must write nothing.
- **Send yourself a mail whose subject contains "API key".** It must be saved,
  with the subject in the frontmatter and out of the filename.
- **Skip the Google fields at setup, then ask for mail.** The failure must name
  what the human should do, not what the model should edit.

---

## 12. What breaks

**The agent asks about things it could look up.** A north star that lists what
to ask about without also saying what not to ask about. Both halves or neither.

**Frontmatter drifts.** The agent invents a schema instead of copying the
neighbours. Name the four things to copy — frontmatter keys, title casing,
wikilink style, folder placement — rather than saying "match the existing
style".

**It gets chatty.** Filing produces a constant stream of small findings and
every one feels worth mentioning. The fix is the ceiling plus the topic list
from §5, and `log.md` for everything else.

**The vault has a `CLAUDE.md` and the agent ignores it.** Nothing told it the
file exists. The model does not read the manifest and does not go looking for
conventions it was not told to expect.

---

## What to steal from this one

The mount you did not add. Most agents that work on "a folder somewhere" are
better built as agents the human starts *in* that folder — and when you do that,
the guarantee you gave up moves into a `throw`, so say which one and where.

---

Built on [Temper](https://github.com/wdorman-tech/Temper).
Reaching a phone is [Agent Update](https://tryagentupdate.com/docs/agents/librarian).
