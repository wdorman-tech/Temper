import type { Setting } from '../../src/config.ts';

/**
 * One Google client, all of it gated.
 *
 * Gated is the difference between an agent that can edit a calendar and an
 * agent whose shell can. The supervisor holds these and hands one to a tool
 * inside a call the human approved; `env` inside the container shows nothing,
 * so the `curl` route around the tools has nothing to authenticate with.
 *
 * `CALENDAR_ID` is deliberately not gated — it is an address, not a
 * credential, and the model is better off being able to read it.
 */
export const settings: Setting[] = [
  {
    key: 'GOOGLE_CLIENT_ID',
    label: 'Google OAuth client id',
    why: 'Lets the agent read and edit your calendar as you. This is the credential the whole job rests on. The next two questions are on the same screen, so keep the tab open.',
    how: [
      'console.cloud.google.com → new project, call it anything',
      'APIs & Services → Library → search "Google Calendar API" → Enable',
      'APIs & Services → OAuth consent screen → External → add yourself as a test user',
      'Credentials → Create credentials → OAuth client ID → Desktop app',
      'Copy the client id — it ends in .apps.googleusercontent.com',
    ],
    url: 'https://console.cloud.google.com/apis/credentials',
    scope: 'gated',
    validate: (value) =>
      value.includes('.apps.googleusercontent.com') ||
      'That does not look like a client id — it should end in .apps.googleusercontent.com',
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    label: 'Google OAuth client secret',
    why: 'The other half of that client. It is on the same screen you just copied the id from.',
    secret: true,
    scope: 'gated',
  },
  {
    key: 'GOOGLE_REFRESH_TOKEN',
    label: 'Google refresh token',
    why: 'Proof you granted access. Google shows it once, so paste it straight in.',
    how: [
      'developers.google.com/oauthplayground',
      'Gear icon → tick "Use your own OAuth credentials", paste the id and secret',
      'In the left list, select https://www.googleapis.com/auth/calendar',
      'Authorise, then "Exchange authorization code for tokens"',
      'Copy the refresh token, not the access token',
    ],
    url: 'https://developers.google.com/oauthplayground',
    secret: true,
    scope: 'gated',
  },
  {
    key: 'CALENDAR_ID',
    label: 'Which calendar',
    why: 'Leave it as primary unless the real one is a secondary calendar — a work calendar on a personal account, say. The agent can read the others either way; this is the one it writes to.',
    default: 'primary',
    optional: true,
  },
];
