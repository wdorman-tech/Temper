# Examples

Three finished agents. Each is a real job worked all the way through: what it
is for, where the line is, and the two to eight things it can do that the shell
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
outside that folder is a `mountAs` setting they have to name, and none of these
three needs one.

## The shape of these

Each one has very few tools. Inside its container the agent already has a shell,
`curl`, `python3`, `git` and the web. A tool earns its place when it holds a
credential, gates an effect, or turns a fiddly API into one honest verb.
Librarian's whole job runs on two.

Every tool here that acts on another person — sends, books, invites, cancels —
is `effect: 'write'`, and every `preview` reads like a sentence you could
approve at a glance. The gate is the whole safety story at this layer; see
BUILD_GUIDE §4. Write the preview for the phone, because that is where you will
answer it from.

Talking to the human is exempt. `notify` and `room_send` reach them, not the
world, and gating those would only teach you to tap yes. Quartermaster has no
gated tool at all, for exactly that reason, and its guide says so out loud.

The rules live in code where they can. "Never double-book" and "`raw/` is
append-only" are a `throw` in the tool rather than a paragraph in a prompt — so
the correct path is also the easy one, and every removal lands in the journal
with a reason attached. The shell can still `rm`: the sandbox is the boundary,
not the tool. Each guide names the two or three lines where its job actually
gets safer, and what they do not cover.
