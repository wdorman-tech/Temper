# Examples

Three finished agents. Each is a real job worked all the way through: what it
is for, where the line is, and the four or five things it can do that the shell
cannot.

| | The job | The thing worth stealing |
| --- | --- | --- |
| [`librarian/`](librarian) | Keeps an Obsidian vault as connected pages rather than a pile of summaries | Making the vault the folder you start in, so the mount disappears |
| [`calendar/`](calendar) | Owns a calendar: protects deep work, absorbs the scheduling back-and-forth | Splitting one job across a gated tool and an ungated one, on who a change reaches |
| [`quartermaster/`](quartermaster) | Hands work to the other agents and notices when one goes quiet | State as a fold over the journal, so a session rotation cannot lose the ledger |

Each folder has four files:

- `GUIDE.md` — the build, start to finish, with the reasoning. Read this one.
- `NORTH_STAR.md` — what it is for, and where the line is
- `tools.ts` — the handful of things it can do that the shell cannot
- `settings.ts` — the credentials it needs and how a human gets them

## Using one

```sh
cp examples/calendar/NORTH_STAR.md agent/NORTH_STAR.md
cp examples/calendar/tools.ts      agent/tools/calendar.ts
```

In the copied `agent/tools/calendar.ts`, shorten the import to `./_kit.ts`.
Then two edits:

```ts
// agent/tools/index.ts
import { agenda, book, calendars, cancel, freebusy, hold, reschedule, rsvp } from './calendar.ts';
export const tools: Tool[] = [/* ...the built-ins, */ calendars, agenda, freebusy, hold, book, reschedule, cancel, rsvp];
```

```ts
// agent/manifest.ts — paste the entries from examples/calendar/settings.ts
// into the settings array. Paste, don't import: agent/ is mounted into the
// container and examples/ is not.
```

Then `temper setup` — or `<your agent> setup` once you have renamed the
command — asks for whatever is missing.

None of these examples names a folder on your machine, and yours should not
either. Each works on whichever folder the human started it in; anything
outside that folder is a `mountAs` setting they have to name, and two of these
three deliberately need none.

## A word on the shape of these

Notice how few tools each one has. Inside its container the agent already has a
shell, `curl`, `python3`, `git` and the web — it does not need a tool to read a
file or do arithmetic. A tool earns its place when it holds a credential, gates
an effect, or turns a fiddly API into one honest verb. Librarian's whole job
runs on two.

Notice which tools ask. Every tool here that acts on another person — sends,
books, invites, cancels — is `effect: 'write'`, and every `preview` reads like a
sentence you could approve at a glance. That is the whole safety story at this
layer: the agent can think whatever it likes, and the moment it wants to act it
stops and puts a question block in front of you, in the terminal and on your
phone, with the options that count. You pick one. A sentence is not a yes, and
neither is silence; both mean the tool did not run. Write the preview for the
phone, because that is where you will answer it from.

Talking to the human is exempt. `notify` and `room_send` reach them, not the
world, and gating those would only teach you to tap yes. Quartermaster has no
gated tool at all, for exactly that reason, and its guide says so out loud.

Notice last where the rules live. "Never double-book" and "`raw/` is
append-only" are not paragraphs in a prompt hoping to be obeyed — they are a
`throw` inside a tool the agent cannot go around. A promise the model can talk
itself out of is not a promise. Each guide names the two or three lines where
its job actually becomes safe.
