# Quickstart — read this first

You are a coding agent configuring this boilerplate into someone's agent. The
runtime works. Your job is judgement, interface and fit.

Two documents. This one is the order of operations. [BUILD_GUIDE.md](BUILD_GUIDE.md)
is the standard the work is held to — especially [The interface](BUILD_GUIDE.md#5-the-interface),
which is where most of this repo's remaining debt lives.

Read both before you touch a file. Then work the steps in order. They are
sequenced on purpose: every one of them is cheap now and expensive later.

---

## 0. Read, in this order

| File | Why |
| --- | --- |
| `README.md` | What the thing is, and the boundaries it promises. |
| `CLAUDE.md` | House rules for this repo. They override your defaults. |
| `agent/AGENTS.md` | The voice. Every word you write for the agent matches it. |
| `examples/<one of them>/GUIDE.md` | A finished agent, built end to end. Pick the closest. |
| `BUILD_GUIDE.md` §5 | The interface standard. Non-negotiable. |

Do not skim the example. Read one `GUIDE.md` end to end. It will save you a
redesign, and it is where the reasoning lives — the three agents differ in
which effects they gate and why, which is the decision you are about to make.

---

## 1. Interview. Write no code.

Ask until you could do the job yourself. Stop when the answers are specific
enough to be wrong out loud.

- What does it do, in one sentence?
- What does a good day look like? A bad one?
- What must it never do without asking? Names, amounts, systems — specifics.
- What does it need access to, and where does each credential come from?
- When does it act alone, and when does it wait?
- What does it need to know that isn't written down anywhere?
- Does the job live in *any* folder, or one specific place?

That last one decides whether you add a mount. Default is any folder. Ask,
don't assume.

**Blocking rule:** no tools, no manifest entries, no UI work until the north
star exists. A tool built before the north star is a guess.

---

## 2. Write `agent/NORTH_STAR.md`, show the draft

This is the only thing between the agent and a bad call at 3am with nobody
watching. Write it, show it, get it corrected before it's load-bearing.

It must answer: what the job is, what "done" looks like, what is never done
without asking, and anything about the environment the model can't discover on
its own — that `mounts/notes` is an Obsidian vault, that a Stripe key exists.

Nothing in `manifest.ts` reaches the model. If the agent needs to know a
setting exists, say so here.

Never write a host path. `/workspace/project` is how you refer to the job.

---

## 3. Name it — before the first run

`temper` is the boilerplate's name and it does not survive this step. If the
agent is called Paul, the human types `paul`.

1. `manifest.name` in `agent/manifest.ts`
2. `name` and `bin` in `package.json` → `"bin": { "paul": "dist/src/cli.js" }`
3. `TEMPER_NAME` in `.env`

Then `npm run build && npm link`, and `npm unlink -g temper` to clear the stale
link. Fix `README.md` and any command you wrote into `NORTH_STAR.md`.

Leave the `TEMPER_*` env keys and the `temper-` container prefix alone. They are
plumbing, not branding.

Renaming after the first run orphans memory, journal and schedules in the old
volume. Do it now.

---

## 4. Settings — `agent/manifest.ts`

Every credential and every folder the agent needs, declared once. The wizard is
the only documentation most people read, so write `why` and `how` for someone
who has never opened that service.

`scope: 'gated'` for anything the container shouldn't hold. `mountAs` for a host
folder, read-only unless there's a reason.

Full field list: the `Setting` type in `src/config.ts`.

---

## 5. Tools — only when they earn it

The agent already has a shell, `curl`, `python3`, `git` and web search. Wrapping
those in tools makes it dumber.

Write a tool when there is **a credential to hold, an effect to gate, or an API
worth making legible**. Nothing else.

`effect: 'write'` for anything that leaves the container. Secrets come from
`ctx.secret()`.

`preview` reads like a sentence a human approves at a glance — it goes out as a
question block to the terminal *and* their phone, and on a lock screen it is the
only context there is. The options offered are the only answers that count:
silence is a refusal and so is prose. See
[the approval block](BUILD_GUIDE.md#the-approval-block).

---

## 6. The interface pass

This is not polish and it is not optional. Four laws, in full in
[BUILD_GUIDE.md §5](BUILD_GUIDE.md#5-the-interface):

1. **One theme.** Every color, glyph, border and spacing constant lives in
   `src/ui/theme.ts`. A raw `"cyan"` anywhere else is a bug.
2. **One frame.** The terminal shows a screen that updates in place. Nothing
   scrolls past. `stdio: 'inherit'` on a build is spam and is banned.
3. **Never a blank wait.** Over 150ms gets an indicator, over 2s gets a named
   phase and elapsed time, over 10s gets steps. A silent terminal reads as hung.
4. **Responsive.** `useWindowSize()`, flexbox, spacers, truncate-end. Never
   character arithmetic. It must survive a live resize drag at 40 columns.

§5 carries the reference implementations — theme tokens, the resize hook, the
loading scene. [§8](BUILD_GUIDE.md#8-where-this-repo-falls-short-today) is the
list of places this repo does not meet its own standard yet, in the order they
hurt. Work that list; it is nine items and none of them touch the runtime.

---

## 7. Test like the human, not like the repo

```sh
npm run check              # types
npm run build
npm start -- setup         # walk the wizard as a new user
cd ~/somewhere/real && paul   # the only test that counts
```

`npm start` runs in the checkout, so the agent works on the checkout. That is
never what the human does. Test from a folder that isn't this one.

Resize the terminal while it works. Drag it narrow. If the frame tears, wraps a
border, or clips the input line, it is not done.

---

## Definition of done

- [ ] `NORTH_STAR.md` written, shown, corrected
- [ ] Named in all three places; `temper` appears nowhere the human sees
- [ ] No host path in any file
- [ ] `npm run check` clean
- [ ] Wizard walked start to finish as a new user
- [ ] Run from a foreign folder, not the checkout
- [ ] Resized live at 40, 80 and 120 columns — no tearing, no clipping
- [ ] No unthemed color string in `src/`
- [ ] No wait over 150ms without an indicator
- [ ] Nothing scrolls past that the human didn't ask for

---

## Never

- Leave it called `temper`.
- Hard-code a host path.
- Add an approval prompt inside the container. The sandbox is the boundary.
- Put secrets in the image or in `agent/`.
- Make the agent chatty. Long messages are a bug.
- Build a daemon. It lives and dies with the terminal, on purpose.
- Add a dependency. There are four. That is the number.
