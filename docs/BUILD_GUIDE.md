# Build guide — the standard the work is held to

You are a coding agent turning this boilerplate into one person's agent. The
runtime is finished and it is not your deliverable. Judgement, interface and fit
are.

[QUICKSTART.md](QUICKSTART.md) is the order of operations. This is the standard.
Read both before you touch a file.

Two things this document is not. It is not a coding lesson — you know how to
write TypeScript, and nothing here explains a hook or a flexbox. And it is not a
description of what the repo currently does; it is what the repo is supposed to
do. Section [8](#8-where-this-repo-falls-short-today) lists the places those two
disagree.

**Contents**

1. [What is custom, and what never is](#1-what-is-custom-and-what-never-is)
2. [The north star](#2-the-north-star)
3. [Settings](#3-settings)
4. [Tools](#4-tools)
5. [The interface](#5-the-interface) ← the section that matters most
6. [Voice](#6-voice)
7. [Testing](#7-testing)
8. [Where this repo falls short today](#8-where-this-repo-falls-short-today)
9. [Never](#9-never)

---

## 1. What is custom, and what never is

Two agents built from this repo share a runtime and share nothing else. The
difference between an inbox triager and a bookkeeper is entirely in `agent/`,
plus one line of `src/ui/theme.ts`.

| Path | Custom per agent | What decides it |
| --- | --- | --- |
| `agent/NORTH_STAR.md` | **Always.** Rewritten from scratch. | The interview. |
| `agent/manifest.ts` | **Always.** | Which credentials and folders the job needs. |
| `agent/tools/` | **Always.** | Which effects need gating, which APIs need a face. |
| `agent/AGENTS.md` | Edited, not replaced. | Job-specific rules. The voice does not change. |
| `agent/codex.toml` | Sometimes. | Reasoning effort against cost. Judgement-heavy jobs earn `high`. |
| `src/ui/theme.ts` | Once, at the top. | The agent's accent colour and glyph set. |
| `src/**` (everything else) | **Never.** | It is the runtime. If you are editing it to ship a feature, you have misread the job. |

The shape of the customisation follows from the job, not from a feature list.
Work it in this order — each one constrains the next:

**The job decides the tools.** A triage agent needs a gate on *send*, so `send`
is a tool and *search* is not — the agent can already curl the API. A
bookkeeping agent needs a gate on *pay*, so reconciliation is shell work and
`pay_invoice` is a tool. Ask what would be unrecoverable if it happened without
asking. That, and only that, is a tool.

**The tools decide the settings.** Every tool that touches a credential adds one
`scope: 'gated'` entry to the manifest. Every job that reaches outside its folder
adds one `mountAs`. Nothing else goes in there.

**The job decides the status strip.** `status.detail` and `status.metrics` are
free-form because the runtime has no opinion about what matters. A triager puts
`unread 12 · drafted 3`. A trading agent puts its position. A build agent puts
the failing suite. Decide this during the interview, write it into
`NORTH_STAR.md`, and the dashboard configures itself.

**The job decides the memory conventions.** `AGENTS.md` says to write notes that
still matter next week. For this agent, say *which* notes: "one file per client,
named for the client" is worth ten paragraphs of general advice.

Everything above holds in a folder you have never seen. The human runs the
command wherever the work is and `cd` is how they get a second copy, so refer to
`/workspace/project`, never to a host path, and never assume what is in the
folder — tell the agent to look.

---

## 2. The north star

`agent/NORTH_STAR.md` is the only thing standing between this agent and a bad
call at 3am with nobody watching. Write it before any code. Show the draft and
get it wrong out loud.

It answers four questions and nothing else:

- What is the job, in one sentence?
- What does done look like? What does a bad day look like?
- What is never done without asking? Names, amounts, systems — specifics beat
  principles. "Never email a client without asking" is a rule. "Be careful with
  communications" is a mood.
- What can the model not discover on its own? That `mounts/notes` is an Obsidian
  vault. That there is a Stripe key it can reach through a tool. That the
  quarter closes on the 15th.

That last one is load-bearing and it is the one people miss. **Nothing in
`manifest.ts` reaches the model.** The wizard is for the human. If the agent
needs to know a setting exists, it learns it here or it never learns it.

---

## 3. Settings

`agent/manifest.ts` is the onboarding script. The full field list is the
`Setting` type in `src/config.ts`; the rules that matter are about the writing,
not the type.

`why` is one sentence in the human's terms, not the system's. `how` is
click-by-click for someone who has never opened that dashboard — the wizard is
the only documentation most people will ever read, and a setting whose `how` is
"get an API key" will be abandoned there.

Scope is a security decision, so make it deliberately:

- `agent` — an environment variable inside the container. The agent's own shell
  can `env` it. Use for things you would not mind it seeing.
- `gated` — never in the container's **environment**, so the agent's own shell
  cannot `env` it. It is held in the supervisor's memory and handed to a tool
  only inside a call the human approved. Be precise about that boundary when you
  explain it to someone: the supervisor runs *inside* the container, so this
  stops the shell and the model from reading the value, not a compromise of the
  container itself. Use it for anything that spends money or speaks to another
  person.
- `runtime` — the supervisor only. Never reaches tools or the shell.

`mountAs` is a hole in the sandbox and it should feel like one. Read-only unless
there is a reason; `writable: true` means the agent's shell writes straight
through to real files with no gate in front of it. If you add one, say so in
`NORTH_STAR.md` too — the model does not read the manifest.

Detect what you can instead of asking. Timezone is already inferred. A local
Codex login is already reused. Every question you delete is worth more than
every question you word well.

---

## 4. Tools

Most things do not need a tool. Inside the container the agent has a shell,
`curl`, `python3`, `git` and the web. Wrapping those makes it dumber, not safer —
you replace a general capability with your guess about how it would be used.

Write a tool when one of three things is true:

1. **There is a credential to hold.** It must come from `ctx.secret()`, and the
   setting must be `scope: 'gated'`, or you have simply moved the key into the
   container with extra steps.
2. **There is an effect to gate.** Anything that leaves the container gets
   `effect: 'write'`. Get this wrong and the agent does something irreversible on
   someone's behalf, once, at 3am.
3. **There is an API worth making legible.** Four calls and a pagination dance
   collapsed into one honest verb.

Split read from write so the gate lands on the smallest possible action. A
calendar agent gets `propose_times` (read, free) and `book` (write, gated) —
never one `manage_calendar` tool that sometimes asks.

`preview` is a sentence the human approves or refuses at a glance, without
context and without expanding anything:

```ts
preview: (args) => `invoice ${args.client} for $${args.amount.toLocaleString()}`
```

Not `send_invoice {"client":"acme","amount":4200}`. The preview is the entire
security interface for that call. Write it as the last line of an email you are
about to send on someone's behalf.

### The approval block

An `effect: 'write'` tool does not run until the human chooses. That choice
happens in a **question block** — a card with tappable options — posted to the
terminal and to Agent Update on their phone at the same moment, with the same
text and the same options. Whichever they answer first wins. The terminal block
disappears; the phone block cannot be withdrawn (the API has no retraction), so
the supervisor posts a follow-up saying how it was settled. Tapping a block that
has already been decided does nothing, which is why it has to say so.

| | Terminal | Phone |
| --- | --- | --- |
| Plain question | `needs you` card. A number, or free text. | Question block. Tap, or reply in the thread. |
| Approval | `approve · <tool>` card. A number, or the exact option. | Question block, framed as a decision, with what silence means spelled out. |

Three rules make that a gate rather than a suggestion. They are enforced in
`src/runtime/tools.ts` and `resolveChoice` in `src/protocol.ts`; you do not
re-implement them per tool, but you do have to design for them.

**The options are the only answers.** An approval resolves by exact match against
the options that were offered, or by their number, and by nothing else. Prose is
not a vote. This is not fussiness: the previous implementation tested
`/allow/i` against the reply, so `"not allowed"` — a refusal — approved the call.
A reply that isn't one of the options is reported to the agent as *did not run*,
along with what the human actually said, and the agent is told to ask again
rather than interpret.

**Silence is a refusal.** A plain question survives going unanswered; the agent
is told to work around it. An approval does not. After an hour it comes back as
no, the tool reports that nothing happened, and the agent is instructed not to
retry until someone actually chooses. The block says this on the lock screen,
because "ignoring it means later" is exactly what a person will assume otherwise.

**The phone is the surface that matters.** Most approvals are answered away from
the desk. So the preview has to stand alone on a lock screen with no thread above
it, the option labels have to be readable at 48 characters, and losing the phone
is loud — an approval that can only be answered in the terminal raises an `error`
notice, not a shrug.

Two structural consequences you inherit rather than implement, worth knowing
because they constrain what you can write:

- **The approval frame is the supervisor's to draw.** Model-authored question
  text is unframed before it goes out, because the `ask` tool is ungated and
  could otherwise compose a notification identical to a real gate. For the same
  reason a `preview` is flattened to one line and capped — an argument with a
  newline in it would be drawing headings inside the block.
- **Answers are authenticated.** The supervisor and the agent's shell run as the
  same uid in the same container, so the shell can write to the supervisor's
  stdin. An `answer` therefore carries a token minted by the host, held in
  supervisor memory and never journalled. Without it, reading a pending ask id
  out of the journal and writing one line to `/proc/<pid>/fd/0` was a complete
  approval.

Two consequences for how you write tools:

- **Split read from write** so the gate lands on the smallest thing. Every
  approval you make the human read is attention you spent; spend it on the send,
  not on the search that preceded it.
- **`repeatable: true` is a real grant.** It offers "Allow all session", which
  approves that tool for *any* arguments until the process dies. Set it only when
  a blanket yes is genuinely what they mean — `refresh_cache`, not `send_email`.

Gated credentials go through the same block: the first time a tool calls
`ctx.secret()`, the human approves that tool holding that credential for the
session. Same strictness, same silence rule.

Descriptions are prompts. Write them for a smart colleague in a hurry: what it
does, what the arguments mean in real units, what it returns, and the one
gotcha. `'Dollars, not cents.'` has prevented more incidents than any type.

Fail loudly. A tool that swallows an error and returns `'ok'` teaches the agent
to report success it did not see, and the agent will pass that on to the human.
Throw with the API's actual message.

Then export it from `agent/tools/index.ts` and restart — `agent/` is mounted, so
there is no rebuild.

---

## 5. The interface

This is where the remaining debt lives, and it is not polish. The interface is
the only evidence the human has that the agent is working; a stale status line or
a torn frame is indistinguishable from a hang, and someone who cannot tell will
kill the terminal in the middle of a write.

Four laws. They apply to the dashboard, the wizard, the preflight, the build, and
every error screen — one product, not a UI plus some scripts.

### 5.1 One theme

Every colour, glyph, border and spacing constant lives in `src/ui/theme.ts`.
A raw `"cyan"` anywhere else in `src/` is a bug, and it is the single most common
one. Grep for it before you call the work done.

Tokens are semantic, not literal. Nothing outside the theme file knows what
colour `danger` is, which is what makes the accent a one-line change:

```ts
// src/ui/theme.ts — the only file that names a colour.
export const accent = 'cyan';                    // the agent's identity. change here, once.

export const color = {
  accent,
  text:   'white',
  muted:  'gray',
  ok:     'green',
  warn:   'yellow',
  danger: 'red',
} as const;

export const state = {
  booting: color.muted,  idle: color.muted,
  thinking: color.accent, working: color.accent,
  waiting: color.warn,   blocked: color.danger, error: color.danger,
} satisfies Record<State, string>;

export const glyph = {
  dot: '●', bullet: '·', prompt: '› ', ok: '✓', fail: '✗', ellipsis: '…',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

export const box   = { style: 'round', paddingX: 1 } as const;   // one border style, everywhere
export const space = { gutter: 8, pad: 1, inset: 2 } as const;
export const size  = { min: { columns: 40, rows: 12 }, narrow: 60, wide: 100 } as const;

export const truncate = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}${glyph.ellipsis}`;
```

Rules that follow from it:

- **One accent.** The wizard's card border, the dashboard's prompt, the spinner
  and the agent's name are the same colour. Two accents read as two products.
- **Named colours only** — `'cyan'`, not `'#00d7ff'`. Hex assumes truecolor and
  assumes a dark background; named colours inherit the terminal's own palette,
  which is the one the human already likes.
- **`dimColor` carries hierarchy, colour carries meaning.** Secondary text is
  dim, not grey-on-purpose. Colour is reserved for state: something needs you,
  something failed, something is running.
- **One border style.** `box.style` everywhere. A round border next to a single
  border is the visual equivalent of two fonts.
- **Never colour a whole block.** A red border and a red heading are enough; red
  body text is unreadable and it shouts.
- **Unicode with an ASCII fallback.** Keep the fallback map next to `glyph` and
  select on `process.env.TERM`/`LANG` once, at startup. Windows terminals that
  cannot draw `⠋` should degrade, not render boxes.

### 5.2 One frame

The terminal shows **one screen that updates in place**. Nothing scrolls past
that the human did not ask for. The alt screen is already entered in `cli.tsx`
and restored on exit — everything after that has to respect it.

While Ink is mounted, it owns stdout. Anything else that writes there tears the
frame, permanently, until the next full repaint. So:

- **`console.log` after mount is banned.** No exceptions, not even for debugging
  — send a `notice` through the protocol and it lands in the feed, themed.
- **`stdio: 'inherit'` on a child process is banned.** Pipe it, parse it, render
  one line of it. Raw `docker build` output is the single worst thing a new user
  can be shown, and right now it is the *first* thing they are shown.
- **Keep the tail, show the summary.** The container's stderr is already handled
  the right way in `cli.tsx`: buffered to 4000 characters, silent while things
  work, printed only if the thing dies. Every subprocess gets that treatment.
- **Pre-mount output is still the product.** Preflight failures happen before Ink
  starts, so `console.error` is technically legal there — it is still wrong.
  Render a themed card with Ink, one screen, then exit. "Docker is not running"
  deserves the same care as the dashboard.
- **Feed entries update in place.** An activity line that is running becomes the
  same line, settled — `upsertActivity` in `app.tsx` is the pattern. Appending a
  second line for the same action is spam with extra steps.

### 5.3 Never a blank wait

A silent terminal reads as hung. Every wait is a state with a visible answer, and
the threshold is far lower than it feels.

| Wait | What the human sees |
| --- | --- |
| **< 150ms** | Nothing. A spinner that flashes is noise. |
| **150ms – 2s** | Spinner and a verb. `⠹ checking docker` |
| **2s – 10s** | Spinner, named phase, elapsed. `⠹ pulling the base image · 4s` |
| **> 10s** | Phases, with the finished ones settled. Elapsed on the current one. |
| **Known length** | A determinate bar. Only when the total is real — a fake percentage that sticks at 90% is worse than none. |
| **Blocked on a human** | Not a wait. A question, in the ask box, with the spinner stopped. |

The long-wait screen — image build, first-run login, a slow API — is a scene, not
a log:

```
  paul  ·  setting up

  ✓  docker ready
  ✓  image layers cached
  ⠹  installing node modules · 34s
     ·  the container is built once. later runs start in a second or two.

     compiling better-sqlite3
```

Three things make that work. The **phase list** tells them how far through they
are. The **elapsed counter** proves the process is alive. The **last meaningful
line** from the subprocess — one line, replaced in place, dim — proves it is
doing something specific. That is the whole point of piping the build instead of
inheriting it: you get all three from the same stream you were about to dump.

Two more rules:

- **Say what will happen, before it takes time.** "first run takes a couple of
  minutes" belongs on the screen while it is taking a couple of minutes, not in a
  line that scrolled away.
- **Elapsed, never estimated.** Counting up is honest. Counting down is a promise
  the process did not make.
- **The spinner is a heartbeat, and it lies if it is not one.** If the frame can
  stall while work happens, the spinner has to be driven by the same clock that
  proves liveness, not by a `setInterval` that keeps ticking after the child has
  hung.

### 5.4 Responsive

The frame must survive a live resize drag — not a restart at a new size, a drag,
while the agent is mid-turn. This is the law most often failed and it is the
cheapest to test: grab the corner and pull.

**Ink does not re-render on resize.** Reading `stdout.columns` during render is
not enough; something has to subscribe. One hook, in the theme layer, and it is
the only place in the codebase that reads a terminal dimension:

```ts
/** Ink does not re-render on resize. This is the only place that knows the size. */
export function useWindowSize() {
  const read = () => ({ columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
  const [dimensions, setDimensions] = useState(read);
  useEffect(() => {
    let frame: NodeJS.Timeout | undefined;
    const onResize = () => {                      // a drag fires this dozens of times a second
      clearTimeout(frame);
      frame = setTimeout(() => setDimensions(read()), 16);
    };
    process.stdout.on('resize', onResize);
    return () => { clearTimeout(frame); process.stdout.off('resize', onResize); };
  }, []);
  return dimensions;
}
```

Then:

- **Flexbox, never character arithmetic.** `' '.repeat(width - a.length - b.length)`
  is wrong at every width and catastrophically wrong at one — it underflows, gets
  floored, and the header wraps into the status strip. Use `<Box flexGrow={1} />`
  as a spacer and let Ink solve the layout.
- **Single-line regions truncate, never wrap.** Header, status strip, previews,
  the input hint. `truncate(text, width)` from the theme. A status detail that
  wraps costs a row that the feed budget already spent.
- **Height is a budget, recomputed every render.** Reserve rows for the input
  line, the hint, the ask box and the sign-in box; give what is left to the feed.
  `fit()` in `app.tsx` is the right idea and it must take its `rows` from the
  hook, not from a stale read.
- **Breakpoints, from `size`:**
  - **≥ 100 columns** — everything. Metrics, next-run, source tags.
  - **60–99** — drop `metrics`, keep `detail` and state.
  - **< 60** — drop the gutter labels to a single glyph, drop the next-run, keep
    the state dot and the input line. The conversation is the last thing to go.
- **Below `size.min`, refuse.** Render one centred line — `terminal too small ·
  40×12 needed` — instead of tearing. A frame that admits it cannot draw is not a
  failure; a frame that draws garbage is.
- **Wrapping text measures newlines.** `fit()` already counts `\n` because agent
  replies are markdown and a bulleted list is ten rows, not one. Any new
  multi-line region does the same or it overflows the alt screen.

### 5.5 Onboarding

The wizard is the first thirty seconds of the product and it is the only
documentation most people read. It is currently functional. Functional is the
floor.

- **One question per screen.** Already true. Keep it true — a wall of fields is
  faster for the person who wrote it and slower for everyone else.
- **Persistent chrome.** The agent's name and tagline at the top, unchanged, so
  the screen has an owner. Progress as both a count and a rail:
  `setting up · 3 of 7` over `━━━━━━━━━░░░░░░`. The count is information; the
  rail is the reassurance.
- **The card answers before it asks.** Label, then `why` in a sentence, then
  numbered `how`, then the URL. Someone who has never opened that dashboard
  should not have to leave the terminal to find out what to paste.
- **The affordance is on screen.** `enter to skip` for optional, `required` for
  the rest. Never make them guess whether enter is safe.
- **Errors are inline and specific.** Under the field, in `danger`, replacing the
  hint — `No folder there. Check the path.` beats `Invalid input.` Validate on
  submit, never mid-keystroke; correcting someone while they type is hostile.
- **Secrets are masked, and say so.** `•••••••` with `hidden` in the hint.
- **Cancel means cancel.** Ctrl-C writes nothing. A partial `.env` marks setup
  complete and the human never gets asked again — this is already handled in
  `onboarding.tsx` and it is the behaviour to preserve.
- **Land somewhere.** The last screen is a summary — what was configured, what
  was skipped and how to change it later, what happens next — and then it hands
  straight to the build scene from [5.3](#53-never-a-blank-wait). The wizard
  finishing into a bare cursor is the moment people think it broke.

### 5.6 Everything the human reads

Copy is interface. Same rules everywhere: wizard, errors, previews, help,
`status.detail`.

- Lower case for chrome, sentence case for prose. No Title Case On Labels.
- A failure says what happened, then the one thing to do about it.
  `Docker is installed but not running. Start Docker Desktop and try again.` is
  the standard — two sentences, no stack trace, no apology.
- Never show an error code without a sentence. Never show a stack trace to a
  human who did not ask for one; keep it in the tail buffer.
- No exclamation marks. No "Oops". No emoji in the frame — glyphs come from the
  theme and they are load-bearing.
- Numbers get units and separators. `$4,200`, `34s`, `12 unread`.
- The status detail is written for the human, in their language, not the
  agent's. `drafting 3 replies`, not `executing draft_reply batch`.
- An approval names the tool, states the effect, and says what doing nothing
  means. `approve · send_invoice` / `invoice acme for $4,200` / `pick one · no
  reply means no`. Never make someone guess whether closing the notification was
  a decision.

---

## 6. Voice

The agent's voice is a product decision, set in `agent/AGENTS.md`, and it is not
yours to soften. Short, direct, not cheerful and not cold. Answer first,
reasoning after and only if it changes what they would do. One or two sentences
is a message; three is a lot.

You match it in everything you write for them — the north star, tool
descriptions, wizard copy, error text, the README you leave behind. Do not make
the agent friendlier. A long message is a bug.

House style for the code, unchanged from `CLAUDE.md`: short files, plain
functions, no classes without state to own, comments that explain *why* because
the code already says what. Simple over clever, readable over compact, fewer
files over more. Abstract at the third concrete use, not the first.

Four dependencies. That is the number.

---

## 7. Testing

```sh
npm run check                  # types. clean, always.
npm run build
npm start -- setup             # walk the wizard as a new user, start to finish
cd ~/somewhere/real && paul    # the only test that counts
```

`npm start` runs in the checkout, so the agent works on the checkout. That is
never what the human does. Link the command and run it from a folder that is not
this one, twice, in two folders, at the same time — that is the product.

Then, with it running and mid-turn:

- Drag the terminal narrow to roughly 40 columns and back out. No tearing, no
  wrapped borders, no clipped input line.
- Watch the status line for a minute. If it goes stale or says nothing useful,
  the problem is `AGENTS.md`, not the UI.
- Trigger a `write` tool and read the preview as if you had not written it.
- Kill Docker and start it again. The error should be one themed screen.

**Definition of done**

- [ ] `NORTH_STAR.md` written, shown to the human, corrected
- [ ] Named in all three places; `temper` appears nowhere the human sees
- [ ] No host path in any file
- [ ] `npm run check` clean
- [ ] Wizard walked start to finish as a new user, including a cancel
- [ ] Run from a foreign folder, and from two at once
- [ ] Resized live at 40, 80 and 120 columns — no tearing, no clipping
- [ ] No unthemed colour string anywhere in `src/`
- [ ] No wait over 150ms without an indicator
- [ ] No `stdio: 'inherit'`, no `console.log` after mount
- [ ] Nothing scrolled past that the human did not ask for

---

## 8. Where this repo falls short today

The runtime is sound. The interface is not finished, and these are the specific
gaps — a work list, in rough order of how much they hurt a first-time user.

1. **`ensureImage` inherits the build log.** `src/docker.ts:70-72` writes a line
   to stdout and then hands `docker build` the terminal. Minutes of raw layer
   output is the first thing a new user sees. Pipe it, keep the tail for failure,
   render the scene in [5.3](#53-never-a-blank-wait). Same fix for the `docker
   run` in `cli.tsx:72`.
2. **No resize subscription.** `src/ui/app.tsx:136` reads `stdout.columns` at
   render and nothing listens for `resize`. The layout only corrects on the next
   one-second tick or keystroke, which reads as a broken frame during a drag.
   Add `useWindowSize()` from [5.4](#54-responsive) and route both dimensions
   through it.
3. **The header does character arithmetic.** `src/ui/app.tsx:185` computes its
   gap from string lengths and floors it at 1, so at narrow widths the header
   runs long and wraps instead of truncating. Spacer plus `truncate`.
4. **The status strip never truncates.** `StatusStrip` takes no width at all
   (`src/ui/app.tsx:198`). A long `detail` plus metrics wraps and steals a row the
   feed budget already allocated.
5. **`onboarding.tsx` is still unthemed.** It names `'cyan'`, `'blue'` and
   `'red'` inline. `src/ui/theme.ts` now carries semantic tokens and `app.tsx`
   uses them; the wizard is the file that never got the sweep. It also has no
   glyph set, no spacing scale and no ASCII fallback — see [5.1](#51-one-theme)
   for the rest of the token list.
6. **No minimum-size guard.** Below roughly 40 columns the ask box border and the
   input line tear. Add the floor.
7. **Preflight failures are bare `console.error`.** `src/cli.tsx:104-111`. They
   are the first thing a user with a stopped Docker sees, and they look like a
   crash rather than a product.
8. **`reset` prompts with raw readline.** `src/cli.tsx:90-95` — an unthemed
   question in the middle of an otherwise composed CLI, and it is the one
   destructive command.
9. **The wizard has no rail and no landing.** Progress is text only, there is no
   completion summary, and it exits into whatever the build prints. See
   [5.5](#55-onboarding).

None of these are runtime changes. All of them are the interface.

### Two holes that are not interface work

Found while reviewing the approval gate, left open because closing either one is
a container-layout decision rather than a fix. Know about them before you promise
anyone the gate is airtight.

**The journal is writable by the agent.** `journal.db` lives in the workspace
volume, which is chowned to the same uid the agent's shell runs as, and
`python3` with `sqlite3` is in the image. The journal is the authoritative copy
of standing orders (`corrections.ts` says so explicitly, on the grounds that a
file the agent can edit is a rule it can repeal) — but the database itself is
such a file. The same applies to the `approved` / `declined` records. Closing it
means moving the journal somewhere root-owned and writing to it through the
supervisor, or accepting that the record is advisory.

**Same-uid process access.** The supervisor, Codex and the agent's shell all run
as uid 1001 in one container. The answer token stops a forged approval arriving
over stdin, but a same-uid process that can attach to the supervisor could read
that token and every gated credential out of its memory. `no-new-privileges` and
the default seccomp profile raise the cost; they are not a partition. If a job
genuinely needs a credential the agent must never reach, the honest answer is to
keep it on the host and never send it in `hello`.

---

## 9. Never

- Leave it called `temper`. That is the boilerplate's name; the agent gets the
  human's, and the command gets the same one.
- Hard-code a host path — not in a tool, not in `NORTH_STAR.md`, not in
  `AGENTS.md`. It is wrong in every folder but one.
- Add an approval prompt inside the container. The sandbox is the boundary; a
  second layer of asking trains people to click yes.
- Put a secret in the image or in `agent/`.
- Ship a tool that wraps something the shell already does.
- Write to stdout while Ink is mounted.
- Make the agent chatty. Long messages are a bug.
- Build a daemon. It lives and dies with the terminal, on purpose.
- Add a dependency. There are four.
