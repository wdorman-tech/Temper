import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything the agent owns lives under one directory, which is a Docker
 * volume. Delete the volume and the agent is factory-new; nothing leaks onto
 * your machine unless you explicitly mounted it.
 */
const root = process.env.TEMPER_WORKSPACE ?? '/workspace';

export const paths = {
  root,
  codexHome: join(root, '.codex'),
  memory: join(root, 'memory'),
  files: join(root, 'files'),
  mounts: join(root, 'mounts'),
  /** The folder the human ran the command in — real files on their machine. */
  project: join(root, 'project'),
  journal: join(root, 'journal.db'),
  schedules: join(root, 'schedules.json'),
  state: join(root, 'state.json'),
  socket: '/tmp/temper.sock',
};

export function ensureWorkspace() {
  // `project` is a mount and already exists; the rest are the agent's own.
  for (const dir of [paths.codexHome, paths.memory, paths.files, paths.mounts]) {
    mkdirSync(dir, { recursive: true });
  }
}
