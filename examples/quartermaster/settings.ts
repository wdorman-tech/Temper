import type { Setting } from '../../src/config.ts';

/**
 * This agent adds no credentials. It changes one.
 *
 * `AGENT_UPDATE_TOKEN` ships in `agent/manifest.ts` as optional, because most
 * agents work fine without a phone. This one does not: the rooms are the only
 * way it reaches the other agents, and a fleet manager that cannot talk to the
 * fleet is not a job. Replace the boilerplate entry with this one rather than
 * adding a second.
 *
 * It stays `scope: 'runtime'`. The supervisor is the only thing that uses it,
 * so keeping it out of the container's environment means the agent's own shell
 * cannot read the token that speaks as the agent.
 */
export const settings: Setting[] = [
  {
    key: 'AGENT_UPDATE_TOKEN',
    label: 'Agent Update token',
    why: 'Not optional for this one. The group chats are the only way it reaches your other agents — without a token it cannot ask any of them anything. It is also how it reaches you when you are away from the terminal.',
    how: [
      'Install Agent Update on iPhone and sign in',
      'Tap + → New agent, name it whatever you named this one',
      'Copy the token it shows you (it starts with au_live_)',
      'In the app, put this agent in a room with each agent it should manage',
    ],
    url: 'https://tryagentupdate.com/docs/quickstart',
    secret: true,
    scope: 'runtime',
    validate: (value) => value.startsWith('au_live_') || 'Agent Update tokens start with au_live_',
  },
];
