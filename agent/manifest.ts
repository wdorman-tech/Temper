import type { Manifest } from '../src/config.ts';

/**
 * Everything this agent needs to exist, and how a human gets it.
 *
 * This drives onboarding. Add a setting here and the setup wizard will walk the
 * next person through finding it — so write `why` and `how` for someone who has
 * never seen the service before, not for yourself.
 *
 * A setting that names a host folder (`mountAs`) is the only way the agent sees
 * anything outside the folder it was started in. Everything else it touches is
 * that folder, or its own workspace volume.
 *
 * Settings are only ever shown to the human. If the *agent* needs to know
 * something — that a folder is an Obsidian vault, that a key exists — say it in
 * NORTH_STAR.md too. Nothing here reaches the model.
 */
export const manifest: Manifest = {
  // The installation id, and a placeholder. Rename it to whatever this agent is
  // called — an agent named Paul is `name: 'paul'`, with `bin` in package.json
  // renamed to match so the human types `paul`. Do it before the first run: it
  // names the image, the container and the volume, and changing it later leaves
  // the agent's memory behind in the old one. See CLAUDE.md.
  name: 'temper',
  tagline: 'a terse agent that lives in your terminal',

  settings: [
    {
      key: 'TEMPER_NAME',
      label: 'Agent name',
      why: 'Shown on the dashboard and in group chats. Give it a name you would use out loud.',
      default: 'temper',
      optional: true,
    },
    {
      key: 'AGENT_UPDATE_TOKEN',
      label: 'Agent Update token',
      why: 'How the agent reaches you when you are not at the terminal — a line on your lock screen, a question with tappable answers, group chats with your other agents. Skip it and the agent still works, but only while you are watching.',
      how: [
        'Install Agent Update on iPhone and sign in',
        'Tap + → New agent, name it whatever you named this one',
        'Copy the token it shows you (starts with au_live_)',
      ],
      url: 'https://tryagentupdate.com/docs/quickstart',
      secret: true,
      optional: true,
      // Only the supervisor uses this. Keeping it out of the container's
      // environment means the agent's own shell cannot read the token that
      // speaks to you as the agent.
      scope: 'runtime',
      validate: (value) => value.startsWith('au_live_') || 'Agent Update tokens start with au_live_',
    },
    {
      key: 'TEMPER_CODEX_LOGIN',
      label: 'How to sign in to Codex',
      why: 'Device code opens a link, you paste a code, and the agent gets its own session — pick this. Reusing your local login is instant, but Codex rotates refresh tokens, so your machine and your agent will keep signing each other out.',
      choices: ['device', 'reuse'],
      default: 'device',
      optional: true,
    },
    {
      key: 'TEMPER_TZ',
      label: 'Timezone',
      why: "Schedules are written in your local time, not the container's.",
      optional: true,
    },
    {
      key: 'TEMPER_MODEL',
      label: 'Codex model',
      why: 'Leave blank to use the model in agent/codex.toml. Set it to override without a rebuild.',
      optional: true,
    },
    {
      key: 'OPENAI_API_KEY',
      label: 'OpenAI API key',
      why: 'Only if you want to bill the API instead of your ChatGPT plan. Leave blank to sign in with ChatGPT, which is what most people want.',
      secret: true,
      optional: true,
    },

    // ---- Add what your agent needs below. Three shapes to copy: ----

    {
      key: 'WEBHOOK_TOKEN',
      label: 'Webhook token',
      why: 'Used by the example tool. Gated: the container never holds it — the agent has to ask you before it is released, and only for the tool that asked.',
      secret: true,
      optional: true,
      scope: 'gated',
    },
    {
      key: 'NOTES_DIR',
      label: 'Notes folder',
      why: 'A folder on your machine the agent may read, e.g. an Obsidian vault. It is mounted read-only. To let the agent write to it, add `writable: true` here — and read the mounts warning in the README first, because writes through a mount are not gated by anything.',
      mountAs: 'notes',
      optional: true,
    },
  ],
};
