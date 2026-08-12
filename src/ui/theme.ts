import type { State } from '../protocol.ts';

/**
 * One place to change how the whole thing feels.
 *
 * Tokens are semantic, never literal: nothing outside this file knows what
 * colour `danger` is, which is what makes the accent a one-line change. Named
 * colours rather than hex, because hex assumes truecolor and a dark background —
 * a named colour inherits the palette the human already chose.
 */
export const accent = 'cyan';

export const color = {
  accent,
  text: 'white',
  muted: 'gray',
  ok: 'green',
  warn: 'yellow',
  danger: 'red',
} as const;

/** Colour carries meaning; `dimColor` carries hierarchy. Don't mix the two up. */
export const stateColor = {
  booting: color.muted,
  idle: color.muted,
  thinking: color.accent,
  working: color.accent,
  waiting: color.warn,
  blocked: color.danger,
  error: color.danger,
} satisfies Record<State, string>;

/** One border style, everywhere. Two of them reads as two products. */
export const box = { style: 'round', paddingX: 1 } as const;

export const label: Record<State, string> = {
  booting: 'starting',
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  waiting: 'needs you',
  blocked: 'blocked',
  error: 'error',
};

export const GUTTER = 8;

/** "4m", "2h", "just now" — a duration a person reads without doing maths. */
export function since(from: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

/** "in 42m" for a future timestamp. */
export function until(at: number): string {
  const seconds = Math.max(0, Math.round((at - Date.now()) / 1000));
  if (seconds < 60) return 'in <1m';
  if (seconds < 3600) return `in ${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `in ${Math.round(seconds / 3600)}h`;
  return `in ${Math.round(seconds / 86_400)}d`;
}
