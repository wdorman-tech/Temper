# Building Librarian

An agent that keeps an Obsidian vault as a connected set of pages rather than a
pile of summaries. It takes in web clippings, chat exports, PDFs and email,
files them where they belong, keeps the vault clean, and answers questions
about what is in it.

You are a coding agent. This is the whole build, in the order to do it, with
the reasoning that lets you change it when the human's vault is not the one
this was written against. Read [`../../docs/BUILD_GUIDE.md`](../../docs/BUILD_GUIDE.md)
first — this guide assumes its standard and does not repeat it.

---

## 1. Why this job is hard

Filing is easy to automate badly. The obvious build is a pipeline — triage,
file, prune, answer — with a model filling in the text at each stage, and it
fails for a reason worth understanding before you write anything: every branch
has to be written in advance. A null where a list was expected takes the daemon
down. A corrupt index takes it down again. Ambiguity has nowhere to go.

The agent version does not have stages. It has the vault, a shell, and room to
think, so "which folder does this go in" gets worked out the way a person works
it out — read the neighbouring pages, look at how the last twenty were filed,
check what the vault already says about the subject.

That freedom is also the danger. The agent is standing in someone's second
brain with write access, and the failure that matters is not a crash. It is a
page quietly deleted, a credential indexed, or a `[[wikilink]]` to a page that
does not exist — which is worse than an admitted gap, because future work
follows it and finds nothing.

So the job splits cleanly: **judgement gets freedom, destruction gets a gate.**

---

## 2. The interview

BUILD_GUIDE §2 says do not write code before the north star, and the north star
comes from asking. For this agent the answers you need are:

- **Where is the vault, and is it the only thing this agent works on?** If yes,
  the human runs the command inside it and you need no mount at all. Ask this
  first — it decides the whole shape.
- **What already lands in it, and how?** Browser clipper, exports, a script,
  mail. Each one is either "a file appears in a folder" or "you have to go get
  it", and only the second kind needs a tool.
- **Does the vault have a schema?** A `CLAUDE.md` at the root, a folder
  convention, a frontmatter habit. If it does, it outranks anything you write.
- **What must never be deleted?** Get specifics. "Be careful" is a mood.
- **What does it mean for a page to be good here?** For this human it was
  connectedness: a page that does not say what it agrees and disagrees with is
  not filed, it is stored.
- **How often does he want to hear from it?** Almost every filing agent is
  built too chatty and gets muted.

---

## 3. Name it, before the first run

`temper` is the boilerplate's name. Three places, in this order, per
[CLAUDE.md](../../CLAUDE.md):

1. `manifest.name` in `agent/manifest.ts` → `'librarian'`
2. `package.json` → `"name": "librarian"` and `"bin": { "librarian": "dist/src/cli.js" }`
3. `TEMPER_NAME` in `.env`

Then `npm run build && npm link`, and `npm unlink -g temper`. Do it now:
`manifest.name` names the image, the container and the volume, so renaming
after the first run leaves the agent's memory behind in the old one.

---

## 4. The decision that shapes everything: the vault is the folder

Temper gives an agent one folder, mounted writable at `/workspace/project`, and
nothing else on the machine. Anything outside it needs a `mountAs` setting,
which is a real hole in the sandbox: the agent's shell writes straight through
a mount with no gate in front of it.

The obvious build mounts the vault. Do not. **Have the human run the command
inside the vault.**

```sh
cd ~/Documents/vault
librarian
```

Now `/workspace/project` *is* the vault, and three things fall out for free:

- **No mount, so no hole.** The one exception to the sandbox is not used at
  all.
- **The container has nothing else in it.** That is what makes writable access
  to the vault safe: the blast radius is the vault, which is the job.
- **A second vault is a second agent.** `cd` to another vault and run the
  command again; it gets its own container, memory, journal and schedules. The
  two cannot see each other, which is right — filing conventions from one vault
  are wrong in the other.

Write this into `NORTH_STAR.md`, not just into your head. Nothing in
`manifest.ts` reaches the model, and neither does your build plan.

The cost is that `raw/` is inside a writable folder, so append-only cannot be a
mount flag. Section 7 is how it is enforced instead.

---

## 5. The north star

[`NORTH_STAR.md`](NORTH_STAR.md) is the file to read next, and it is the one
that decides every call this agent makes at 3am. Four things in it are doing
real work:

**The four invariants, stated as rules with consequences.** `raw/` is
append-only. Nothing is hard-deleted. Credentials are invisible. Never invent a
link. Each is one sentence of rule and one sentence of why, because a rule
whose reason the model can reconstruct survives a paraphrase and a rule it
cannot does not.

**The credential list is a list, not a principle.** Eleven globs, spelled out:
`*key*`, `*pass*`, `*login*`, `*token*`, `*secret*`, `*credential*`, `*.env*`,
`*private key*`, `*recovery code*`, `*backup code*`, `*seed phrase*`, plus
`secret: true` in frontmatter. "Be careful with sensitive files" would be a
mood. Note that `recovery code` and `backup code` are not covered by any of the
shorter patterns, which is exactly why enumerating beats generalising.

**Ask-once-per-run, with the four forks named.** A naming convention about to
be applied to many pages; whether two pages are the same thing and should
merge; anything destructive beyond one obvious stub; a source that could be
important or noise, where guessing wrong is expensive both ways. Followed
immediately by the harder rule: *do not ask about things you can find out.*
Which folder similar pages live in and whether a page already exists are in the
vault, and looking is the job.

**The vault's conventions outrank yours.** `CLAUDE.md` in the vault root, if it
exists, beats the north star on naming, frontmatter and placement. Otherwise
copy the neighbours. An agent that imposes its own taxonomy on an existing
vault has made every future page harder to find.

---

## 6. Settings

[`settings.ts`](settings.ts) is three entries and they are all one Google
client: id, secret, refresh token. All three are `scope: 'gated'`.

Gated is the point. A refresh token in the container's environment is one `env`
away from the model, and this agent has a shell. Gated means the supervisor
holds it and hands it to a tool only inside a call the human approved, so the
`curl` route around the tools has nothing to authenticate with.

Be precise about the boundary when you explain it: the supervisor runs *inside*
the container, so this stops the shell and the model from reading the value. It
is not protection against the container itself being compromised. It is a good
fence, and for a credential to someone's mail it is the fence that matters.

The scope is `gmail.readonly`. The worst case of a bug in `fetch_mail` is a
page the human did not want, never an email he cannot get back. Ask for the
narrowest scope that does the job and then say so in the `why` — it is the
sentence that gets a nervous person through the wizard.

There is no vault setting, because of §4. There is no `GMAIL_QUERY` setting
either: the tool defaults to `in:inbox -category:promotions -category:social`
and takes a `query` argument, so the human changes it by saying so rather than
by editing `.env`. Every question you delete from the wizard is worth more than
every question you word well.

One honest limitation: the human gets the refresh token from Google's OAuth
playground, which is six clicks in a developer tool. A loopback consent flow
the wizard runs itself would be better and needs a field on `Setting` that the
runtime does not have.

---

## 7. Tools — two, and why not more

Inside the container the agent has a shell, `curl`, `python3`, `git` and the
web. Reading pages, grepping for a broken wikilink, rewriting frontmatter,
counting orphans, diffing two near-duplicate pages — all shell. Wrapping any of
it in a tool would replace a general capability with your guess about how it
would be used.

Two things are not shell work.

### `fetch_mail` — because there is a credential to hold

Pulls new mail into `raw/email/`, one markdown file per message, and does
nothing else. No filing, no summarising, no judgement.

That restraint is the design. A page written by the sync is indistinguishable
from one the human saved by hand, so there is **one path in for source
material** rather than two — the agent notices new files in `raw/` the same way
whatever put them there. Every "and while we're here, let's classify it" you
add to an ingest step is a second code path that will disagree with the first.

Three details worth copying:

- **Idempotent by id.** Seen Gmail ids live in
  `.librarian/gmail-seen.json`, trimmed to the last 5,000. Running the sync
  twice writes nothing twice, so it is safe to schedule and safe to retry.
- **The failure message names the human action.** `Google refused the saved
  sign-in (400). Re-authorise the OAuth client and update
  GMAIL_REFRESH_TOKEN.` A revoked grant cannot be fixed by the agent, so
  saying which person does what is the entire value of the error.
- **A sensitive subject leaves the filename, not the mail.** `SECRET_PATTERNS`
  in the tool mirrors the vault's credential rule. A message titled "Stripe API
  key rotation" would otherwise become a file the agent is forbidden to open —
  saved and invisible, which is worse than not saved. So the subject is
  replaced with `message` in the *filename* and the mail is still written. Be
  clear-eyed that this protects availability, not secrecy: the subject is still
  in the page's frontmatter, and the rule about live keys in a page body takes
  over from there.

`fetch_mail` is **not** `effect: 'write'`. It writes into the project folder,
which is ordinary work, and it cannot send, archive or delete anything at
Google. The gate it needs is the credential gate, and `ctx.secret()` raises
that on its own — one approval block per tool per credential per session.

### `trash` — because there is an effect to gate

Removal is a move to `.librarian/trash/<today>/` with the folder layout kept.
That is the undo path; `rm` has none.

It is `effect: 'write'`, so it stops and puts a block in front of the human in
the terminal and on their phone. The preview is written for a lock screen:

```
trash notes/Old Stub.md — empty since March, superseded by [[Filing]]
```

Not `trash {"path":"notes/Old Stub.md","why":"..."}`. The preview is the whole
security interface for that call, and it is usually read with no thread above
it.

It is not `repeatable`. "Allow all session" on a delete would approve every
future delete with any arguments, which is not what anyone means.

---

## 8. The rules that live in code

Two lines in [`tools.ts`](tools.ts) are the difference between a rule and a
hope.

```ts
if (!rel || rel.startsWith('..')) throw new Error(`${args.path} is outside the vault.`);
```

`resolve` + `relative` is the check. A path argument the model composed —
`../../.ssh/id_rsa`, or an absolute path — resolves outside `/workspace/project`
and `relative` starts with `..`. Do not do this with string prefixes; do it
with the path module.

```ts
if (rel.split('/')[0] === 'raw') {
  throw new Error('raw/ is append-only. Source material is never removed — write a corrected page instead.');
}
```

This is the append-only invariant, enforced rather than requested. It matters
because §4 gave up the ability to enforce it with a read-only mount, and
because an agent that can talk its way past this one has taken away the human's
only undo.

**Be honest about the limit.** The shell can still `rm`. Nothing in the
container stops it, and adding an approval prompt inside the container would
not help — the sandbox is the boundary, and a second layer of asking trains
people to click yes. What the guard actually buys is that the correct path is
also the easy path, that the wrong one is never the one the model reaches for
first, and that every removal is in the journal with a reason attached. Say
this in `NORTH_STAR.md` in plain words rather than implying a guarantee the
runtime does not make.

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

Delete `example.ts` and its `postWebhook` import while you are in here. Paste
the three settings from [`settings.ts`](settings.ts) into
`agent/manifest.ts` — paste, do not import, because `agent/` is mounted into
the container and `examples/` is not — and delete the `WEBHOOK_TOKEN` and
`NOTES_DIR` placeholders.

`agent/` is mounted, so a tool change needs a restart, not a rebuild.

Two edits to `agent/AGENTS.md`. Do not replace the file and do not touch the
voice; add a `## The vault` section that says the folder is a vault, that
`raw/` is append-only, and that removal is the `trash` tool. Then add one
paragraph to `## Memory` naming the notes that earn their place here:
`vault-shape.md`, revised rather than duplicated, and one note per recurring
subject where the human has taken a position.

Consider raising `model_reasoning_effort` to `"high"` in `agent/codex.toml`.
Filing is judgement work done unattended, which is what the higher setting is
for.

---

## 10. Day one

`NORTH_STAR.md`'s `## How it starts` is deliberately a read-only first run:
read the vault, write `memory/vault-shape.md`, show it, propose what it would
fix on its own, and wait for a yes.

Insist on this. An agent that reorganises a second brain on its first afternoon
is a bad afternoon even when every individual move is right, because the human
cannot tell a good reorganisation from a bad one at that volume. Three
proposals he agrees to are worth more than thirty he has to audit.

The other artefact from day one is `log.md` in the vault root — one line per
filing run: what came in, what was written, what was skipped and why. It is how
the human audits the agent without reading every page, and it is the thing that
makes "I skipped 14 newsletters" a fact rather than a claim.

---

## 11. Schedules

The agent writes its own with the `schedule` tool. Two earn their place:

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
        with its neighbours, and near-duplicate pages. Fix what is safe.
        Write a note listing what is not safe and why, and show it.
```

Write the prompt for a future self with no memory of today. Schedules are
timers in this session, not a daemon: with the terminal closed the agent is not
running, and on the next start it is told what came due while it was off and
decides whether catching up still makes sense.

---

## 12. Test it

```sh
npm run check              # types. clean, always.
npm run build
npm start -- setup         # walk the wizard as a new user
cd ~/some/real/vault && librarian
```

Never test from the checkout: `npm start` makes the agent work on Temper's own
source, which is not what any human will do.

Then, specifically for this agent:

- Ask it to trash a page and read the approval block on your phone, not on your
  screen. If you cannot decide from that one line, rewrite the `preview`.
- Ask it to trash something under `raw/`. It must refuse, and the refusal must
  say why.
- Ask it a question the vault has nothing on. It must say the vault has nothing
  on it — a fabricated `[[link]]` here is the failure this design exists to
  prevent, and it is the single best test of whether the north star landed.
- Run `fetch_mail` twice. The second run must write nothing.
- Decline the credential when it asks. The tool must fail, and the agent must
  say it failed rather than reporting mail it did not fetch.

---

## 13. What breaks

**The agent asks about things it could look up.** Almost always a north star
that lists what to ask about without also saying what not to ask about. Both
halves or neither.

**Frontmatter drifts.** The agent invents a schema instead of copying the
neighbours. Fix it in `NORTH_STAR.md` by naming the four things to copy —
frontmatter keys, title casing, wikilink style, folder placement — rather than
saying "match the existing style".

**It gets chatty.** Filing produces a constant stream of small findings and
every one of them feels worth mentioning. The rule that works is a ceiling and
a topic list: a few messages a week, and only a genuine contradiction with a
position the human has recorded, a decision that needs him, or something
arriving repeatedly that suggests a page he does not have yet. Everything else
goes in `log.md`, which he can read when he wants it.

**The vault has a `CLAUDE.md` and the agent ignores it.** Because nothing told
it the file exists. Say so in `NORTH_STAR.md`; the model does not read the
manifest and does not go looking for conventions it was not told to expect.

---

## What to steal from this one

The mount you did not add. Most agents that work on "a folder somewhere" are
better built as agents the human starts *in* that folder, and the `mountAs`
setting is for the second folder, not the first.

---

Built on [Temper](https://github.com/wdorman-tech/Temper).
Reaching a phone is [Agent Update](https://tryagentupdate.com/docs/agents/librarian).
