#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, watch } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { manifest } from '../agent/manifest.ts';
import { mounts, readEnv, split } from './config.ts';
import { authVolume, ensureImage, has, idFor, localCodexAuth, start } from './docker.ts';
import { onboard } from './onboarding.tsx';
import { encode, lineReader, type ToAgent, type ToHost } from './protocol.ts';
import { Dashboard, type Bridge } from './ui/app.tsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const name = manifest.name;

/**
 * The folder you ran the command in is the job. It is the only part of your
 * machine the agent can see, and it gets its own container, its own workspace
 * volume and its own memory — so an agent you started in one project knows
 * nothing about another, and the two can run side by side.
 */
const project = resolve(process.cwd());
const id = idFor(name, project);

/**
 * What the human actually types. `temper` is a placeholder — renaming the agent
 * means renaming the `bin` key in package.json, so read the name from there
 * rather than hard-coding one this checkout is meant to grow out of.
 */
const cli = binName() ?? name;

const HELP = `
  ${cli} — ${manifest.tagline}

  ${cli}           start the agent in this folder (this is the one you want)
  ${cli} setup     walk through every setting again
  ${cli} login     forget the Codex login and sign in fresh
  ${cli} build     rebuild the container image
  ${cli} reset     delete this folder's workspace — memory, journal, schedules

  The agent works in the folder you run it in, and nothing else on your
  machine. Run it in another folder and that is a second agent, with its own
  memory and its own container; both can run at once. It runs in Docker and
  lives as long as this terminal does.
`;

function binName(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return Object.keys(pkg.bin ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

const [command = 'up'] = process.argv.slice(2);

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  case 'build':
    await ensureImage(root, name, { force: true });
    console.log('image ready');
    break;
  case 'login':
    // The login volume is shared by every folder, so this signs out everywhere.
    spawnSync('docker', ['run', '--rm', '--entrypoint', 'rm', '-v', `${authVolume(name)}:/codex`, await ensureImage(root, name), '-f', '/codex/auth.json'], { stdio: 'inherit' });
    console.log(`signed out. run \`${cli}\` to sign in again.`);
    break;
  case 'reset':
    await reset();
    break;
  case 'setup':
    await up(true);
    break;
  case 'up':
    await up(false);
    break;
  default:
    console.log(HELP);
    process.exitCode = 1;
}

async function reset() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This deletes the memory, journal and schedules of the agent for ${project}.\n` +
      `Agents you started in other folders, and your files in this one, are untouched.\n` +
      `Type the agent's name to confirm: `,
  );
  rl.close();
  if (answer.trim() !== name) return console.log('left alone.');
  spawnSync('docker', ['rm', '-f', `temper-${id}`], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', `temper-${id}`], { stdio: 'inherit' });
  console.log(`gone. the Codex login is kept — \`${cli} login\` clears that.`);
}

async function up(reconfigure: boolean) {
  if (!has('docker')) {
    console.error('Docker is not installed, and the agent only runs in Docker.\nGet it: https://docs.docker.com/get-docker/');
    process.exit(1);
  }
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    console.error('Docker is installed but not running. Start Docker Desktop and try again.');
    process.exit(1);
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stored = readEnv(root);
  const withDefaults = { TEMPER_TZ: timezone, ...stored };
  const env = await onboard(root, manifest, stored, reconfigure || !stored.TEMPER_ONBOARDED);
  const settings: Record<string, string> = { ...withDefaults, ...env };

  const tag = await ensureImage(root, name);
  const { agent, gated, runtime } = split(manifest, settings);
  // The agent is told where it really is, so it can name a path back to you.
  const child = start({
    root,
    name,
    id,
    project,
    tag,
    env: { ...agent, TEMPER_PROJECT: project, TEMPER_PROJECT_NAME: basename(project) },
    mounts: mounts(manifest, settings),
  });

  // Full-screen, and give the terminal back exactly as we found it.
  process.stdout.write('\x1b[?1049h');
  const restore = () => process.stdout.write('\x1b[?1049l');
  process.on('exit', restore);

  const listeners = new Set<(message: ToHost) => void>();
  const bridge: Bridge = {
    send: (message: ToAgent) => child.stdin?.write(encode(message)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  child.stdout?.on('data', lineReader<ToHost>((message) => listeners.forEach((l) => l(message))));

  // Container stderr is not protocol; keep the tail so a crash is explainable.
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));

  const app = render(<Dashboard bridge={bridge} name={settings.TEMPER_NAME ?? name} project={basename(project)} />, {
    exitOnCtrlC: false,
  });

  const reuseLogin = settings.TEMPER_CODEX_LOGIN === 'reuse' && !settings.OPENAI_API_KEY;
  bridge.send({
    k: 'hello',
    tz: settings.TEMPER_TZ ?? timezone,
    secrets: gated,
    agentUpdateToken: runtime.AGENT_UPDATE_TOKEN,
    ...(reuseLogin ? { authJson: localCodexAuth() ?? undefined } : {}),
  });

  const heartbeat = setInterval(() => bridge.send({ k: 'ping' }), 10_000);

  // Edit .env or anything in agent/ and the change reaches a running agent.
  // Debounced because editors write a file two or three times per save.
  let pending: NodeJS.Timeout | undefined;
  const reload = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const latest = { ...withDefaults, ...readEnv(root) };
      const parts = split(manifest, latest);
      bridge.send({
        k: 'config',
        env: parts.agent,
        secrets: parts.gated,
        agentUpdateToken: parts.runtime.AGENT_UPDATE_TOKEN,
      });
    }, 300);
  };
  // A missing .env or a filesystem that can't watch recursively is not worth
  // refusing to start over; you just lose live reload.
  const observe = (path: string, recursive = false) => {
    try {
      return watch(path, { recursive }, reload);
    } catch {
      return null;
    }
  };
  const watchers = [observe(join(root, '.env')), observe(join(root, 'agent'), true)].filter((w) => w !== null);

  const shutdown = () => {
    clearInterval(heartbeat);
    clearTimeout(pending);
    for (const watcher of watchers) watcher.close();
  };

  child.on('close', (code) => {
    shutdown();
    app.unmount();
    restore();
    if (code) console.error(`\nthe agent stopped (exit ${code})\n${stderr.trim()}`);
    process.exit(code ?? 0);
  });

  await app.waitUntilExit();
  shutdown();
  child.stdin?.end();
}
