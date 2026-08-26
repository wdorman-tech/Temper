import type { Setting } from '../../src/config.ts';

/**
 * The vault is the folder the human starts the agent in, so nothing here names
 * it — no `mountAs`, no path. What is left is one Google client, gated.
 *
 * Gated is the whole point. The agent has a shell in this container and the
 * vault is his company's memory; a refresh token in the environment would be
 * one `env` away from a session-long grant to his mail. Held by the host and
 * handed to `fetch_mail` inside a call he approved, it is reachable by the one
 * tool that needs it and by nothing else.
 */
export const settings: Setting[] = [
  {
    key: 'GMAIL_CLIENT_ID',
    label: 'Google OAuth client id',
    why: 'Lets the agent pull your mail into the vault as source material. Read-only — it can never send, archive or delete.',
    how: [
      'console.cloud.google.com → new project',
      'APIs & Services → Library → enable the Gmail API',
      'Credentials → Create credentials → OAuth client ID → Desktop app',
    ],
    url: 'https://console.cloud.google.com/apis/credentials',
    scope: 'gated',
  },
  {
    key: 'GMAIL_CLIENT_SECRET',
    label: 'Google OAuth client secret',
    why: 'The other half of that client.',
    secret: true,
    scope: 'gated',
  },
  {
    key: 'GMAIL_REFRESH_TOKEN',
    label: 'Google refresh token',
    why: 'Proof you granted access. Google shows it once.',
    how: [
      'developers.google.com/oauthplayground',
      'Gear icon → use your own OAuth credentials, paste the id and secret',
      'Select scope https://www.googleapis.com/auth/gmail.readonly',
      'Authorise, exchange the code, copy the refresh token',
    ],
    url: 'https://developers.google.com/oauthplayground',
    secret: true,
    scope: 'gated',
  },
];
