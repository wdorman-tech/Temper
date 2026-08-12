# Examples

Three agents built on this runtime. They are here to be read, and to be copied
when one is close to what you want.

Each folder has the same three pieces, which is all an agent is:

- `NORTH_STAR.md` — what it's for, and where the line is
- `tools.ts` — the handful of things it can do that the shell can't
- `settings.ts` — the credentials it needs and how a human gets them

## Using one

```sh
cp examples/email-triage/NORTH_STAR.md agent/NORTH_STAR.md
cp examples/email-triage/tools.ts      agent/tools/inbox.ts
```

In the copied `agent/tools/inbox.ts`, shorten the import to `./_kit.ts`. Then
two edits:

```ts
// agent/tools/index.ts
import { archive, draftReply, searchInbox, sendDraft } from './inbox.ts';
export const tools: Tool[] = [/* ...the built-ins, */ searchInbox, draftReply, sendDraft, archive];
```

```ts
// agent/manifest.ts — paste the entries from examples/email-triage/settings.ts
// into the settings array. Paste, don't import: agent/ is mounted into the
// container and examples/ is not.
```

`temper setup` — or `<your agent> setup` once you've renamed the command — will
then ask for whatever is missing.

None of these examples name a folder on your machine, and yours shouldn't
either. Each one works on whichever folder the human started it in; anything
outside that folder is a `mountAs` setting they have to name.

## A word on the shape of these

Notice how few tools each one has. The agent already has a shell, `curl`,
`python3` and web search inside its container — it does not need a tool to read
a file or do arithmetic. A tool earns its place when it holds a credential,
gates an effect, or turns a fiddly API into something the model can use without
a manual.

Notice also that every tool here that acts on the world — sends, books,
cancels, refunds — is `effect: 'write'`, and every preview reads like a sentence
you could approve at a glance. That is the whole safety story at this layer: the
agent can think whatever it likes, and the moment it wants to act, it stops and
puts a question block in front of you — in the terminal and on your phone — with
the options that count. You pick one. A sentence isn't a yes, and neither is
silence; both mean the tool didn't run. Write the preview for the phone, because
that's where you'll answer it from.

Talking to the human is exempt. `notify` and `room_send` reach them, not the
world, and gating those would just teach you to click yes.
