# Working on this repo

You are configuring an agent someone is going to trust with real work. The
runtime is finished. Your job is to make it *this person's* agent.

## Start here, before you write anything

Ask them what they want the agent to do. Not "what features" — what job.
Keep asking until you could do the job yourself:

- What does it actually do, in one sentence?
- What does a good day look like? A bad one?
- What must it never do without asking? Be specific — names, amounts, systems.
- What does it need access to, and where do those credentials come from?
- When should it act on its own, and when should it wait?
- What does it need to know that isn't written down anywhere?

Then write `agent/NORTH_STAR.md`. That file is the only thing standing between
this agent and a bad judgement call at 3am with nobody watching. Vague north
star, vague agent. Show them the draft and get it wrong out loud before you get
it wrong in production.

Do not start building tools before the north star exists.

## Two things about this boilerplate, before the map

**The agent belongs to a folder.** It works on the folder the human ran the
command in, mounted writable at `/workspace/project`. Nothing else on their disk
is reachable, and each folder gets its own container, volume, memory, journal and
schedules — so the same agent started in two folders is two agents that cannot
see each other, running side by side. Design for that; see below.

**`temper` is a placeholder name.** The command is named after the agent you're
building. If they want an agent called Paul, `temper` becomes `paul` — in
`manifest.name`, in `package.json`'s `name` and `bin`, and in every doc you
write for them. Do it early, before the first run, and use their name in the
files you write, not this one's.

## The map

```
agent/               yours — this is the agent
  NORTH_STAR.md      what it's for. write this first.
  AGENTS.md          how it behaves. edit for this job, keep the voice.
  manifest.ts        every setting, and how a human gets it. drives onboarding.
  codex.toml         model and reasoning effort.
  tools/             what it can do. add files here.
    _kit.ts          defineTool, input(), and the Ctx a tool is handed.

examples/            three complete agents — email triage, calendar, business
                     ops. Read one before designing tools; they show the shape.

src/                 the runtime. read it, rarely change it.
  cli.tsx            host entry: preflight, onboarding, container, dashboard
  config.ts          the Setting/Manifest types — the full field list for
                     manifest.ts lives here
  docker.ts          container lifecycle — the sandbox boundary
  onboarding.tsx     the first-run wizard
  protocol.ts        the host ↔ container wire format
  ui/app.tsx         the dashboard
  runtime/           runs inside the container
    main.ts          supervisor: turn queue, the human channel, lifecycle
    tools.ts         where tools run, and where the effect gate lives
    codex.ts         spawns Codex, parses its event stream
    session.ts       thread lifecycle and compaction
    memory.ts        markdown notes
    schedules.ts     recurring work
    journal.ts       sqlite history
    agentupdate.ts   phone + group chats
    bus.ts           socket between the tool server and the supervisor
    mcp.ts           the tool server Codex spawns. a pipe, nothing more.
```

**One thing that will bite you.** `manifest.ts` is shown to the *human*, during
setup. Nothing in it reaches the model. If the agent needs to know a setting
exists — that `mounts/notes` is an Obsidian vault, that there's a Stripe key —
say so in `NORTH_STAR.md`.

## Write it for any folder, not one folder

The human runs the command wherever the work is, and `cd` somewhere else is how
they get a second copy. So everything you write has to hold in a folder you have
never seen:

- Refer to `/workspace/project`. Never write a host path — not in a tool, not in
  `NORTH_STAR.md`, not in `AGENTS.md`. `C:\Users\...\acme` is wrong in every
  folder but one.
- Don't have the agent assume what's in the folder. Tell it to look.
- Memory, journal and schedules are per folder. Something the agent learned in
  `acme` does not exist in `beta`. Don't write instructions that depend on a
  note the other copy wrote.
- Anything outside the folder needs a `mountAs` setting the human names, and
  then it lives at `/workspace/mounts/<name>`. That's the one way out, and it's
  the human's decision, not yours.

The exception is a job that genuinely lives in one place — a specific vault, one
repo, a shared drive. Then say it out loud: add the mount to `manifest.ts`, and
write in `NORTH_STAR.md` that this agent expects it. Ask before you assume that
is what they want; the default is that the folder is the scope.

## Adding a tool

Most things do not need a tool. The agent has a shell, `curl`, `python3`, `git`
and web search inside its container — wrapping those in tools makes it dumber,
not safer. Write a tool when there is a credential to hold, an effect to gate,
or an API worth making legible.

```ts
// agent/tools/invoices.ts
import { defineTool, input } from './_kit.ts';

export const sendInvoice = defineTool<{ client: string; amount: number }>({
  name: 'send_invoice',
  description: 'Send an invoice. Amounts are in dollars.',
  effect: 'write',                                    // asks the human first
  input: input({
    client: { type: 'string', description: 'Client id from the ledger.' },
    amount: { type: 'number', description: 'Dollars, not cents.' },
  }),
  preview: (args) => `invoice ${args.client} for $${args.amount}`,
  run: async (args, ctx) => {
    const key = await ctx.secret('STRIPE_KEY');       // must exist in manifest.ts
    // ...                                            // with scope: 'gated'
    return 'sent';
  },
});
```

Then export it from `agent/tools/index.ts`. Restart — no rebuild, `agent/` is
mounted into the container.

Rules that matter:
- `effect: 'write'` for anything that leaves the container. Get this wrong and
  the agent will do something irreversible on someone's behalf.
- `preview` should read like a sentence the human can approve or refuse at a
  glance. `"invoice acme for $4,200"`, not `"send_invoice {...}"`.
- Descriptions are prompts. Write them for a smart colleague in a hurry.
- Secrets go through `ctx.secret()`, never `process.env`.

## Adding a setting

Put it in `agent/manifest.ts`; the full field list is the `Setting` type in
`src/config.ts`. Write `why` and `how` for someone who has never seen that
service — the wizard is the only documentation most people will read.

- `scope: 'gated'` for a credential the container should not hold.
- `scope: 'runtime'` for something only the supervisor uses.
- `mountAs` shares a host folder. Read-only unless you add `writable: true`,
  and a writable mount is a real hole in the sandbox — see the README.

## Testing your changes

```
npm run check         # types
npm run build         # host CLI
npm start -- setup    # walk the wizard as a new user would
npm start             # run it
```

(`npm link` once and it's just `temper`, `temper setup` — or `paul`,
`paul setup`, once you've named it.)

Test it from a folder that isn't the checkout. `cd` somewhere real and run the
linked command: that is how the human will use it, and it's the only way to see
that the agent works on their folder rather than on this repo.

Watch the dashboard while it works. If the status line goes stale or says
nothing useful, the problem is your `AGENTS.md`, not the UI.

## Naming the agent

`temper` is this boilerplate's name, and it is meant to be replaced with the
agent's. If they've called it Paul, they should be typing `paul`. Three places,
best done before the first run:

1. `manifest.name` — the *installation* id. It names the Docker image, and it is
   the first half of every container and volume name. The second half is the
   folder, because each folder gets its own agent.
2. `package.json` — `name`, and the key in `bin`:
   `"bin": { "paul": "dist/src/cli.js" }`. Then `npm run build && npm link`, and
   the command is `paul`. The old `temper` link is stale; `npm unlink -g temper`
   clears it.
3. `TEMPER_NAME` in `.env` — what it calls itself on the dashboard and on their
   phone. Safe to change any time.

Then fix the docs you leave behind: `README.md`, and any command you wrote into
`NORTH_STAR.md`.

Leave the `TEMPER_*` environment keys alone. They're runtime plumbing read
across `src/`, not branding, and renaming them is a refactor with no payoff. The
same goes for the `temper-` prefix on containers and volumes: it's a namespace,
it lives in `src/docker.ts`, and `docker ps` showing `temper-paul-acme-1f2e3d4`
is the agent named paul, in the folder acme.

Changing `manifest.name` after the agent has run orphans its memory, journal and
schedules in the old volume, and drops the Codex login with them. If you must,
`docker volume ls` and move the data across.

## House style

- Short files, plain functions, no classes unless there is state to own.
- Comments explain *why*. The code already says what.
- No new dependencies without a real reason. There are four.
- Match the voice in `AGENTS.md` — terse, direct, not chirpy. That voice is a
  product decision, not a default. Do not make the agent friendlier.

## Do not

- Do not leave it called `temper`. That's the boilerplate; the agent gets the
  human's name for it, and the command gets the same name.
- Do not hard-code a host path anywhere. The folder is whichever one they ran it
  in, and there will be more than one.
- Do not add approval prompts inside the container. The sandbox is the boundary;
  a second layer of asking just trains people to click yes.
- Do not put secrets in the image or in `agent/`.
- Do not make the agent chatty. Long messages are a bug.
- Do not build a daemon. This agent lives and dies with the terminal, on purpose.
