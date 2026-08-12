import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Box, Text, render, useApp, useInput } from 'ink';
import { useState } from 'react';
import type { Manifest, Setting } from './config.ts';
import { writeEnv } from './config.ts';

/**
 * First run.
 *
 * The wizard's whole job is that nobody has to go read a README to find a
 * token. Every question says why it exists and how to get the answer, and
 * every optional one is one keypress to skip.
 */
export async function onboard(
  root: string,
  manifest: Manifest,
  env: Record<string, string>,
  full: boolean,
): Promise<Record<string, string>> {
  const todo = manifest.settings.filter((s) => !env[s.key] && (full || (!s.optional && !s.default)));
  if (!todo.length) return env;

  const answers = await new Promise<Record<string, string> | null>((done) => {
    const app = render(
      <Wizard
        manifest={manifest}
        settings={todo}
        onDone={(values) => {
          done(values);
          app.unmount();
        }}
      />,
    );
  });

  // Ctrl-C means "not now", not "I have answered everything". Writing a partial
  // config here would mark setup complete and never ask again.
  if (!answers) {
    console.log('setup cancelled — nothing saved.');
    process.exit(0);
  }

  const merged = { ...env, ...answers, TEMPER_ONBOARDED: '1' };
  writeEnv(root, merged);
  return merged;
}

function Wizard({
  manifest,
  settings,
  onDone,
}: {
  manifest: Manifest;
  settings: Setting[];
  onDone: (values: Record<string, string> | null) => void;
}) {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState(settings[0]?.default ?? '');
  const [error, setError] = useState<string | null>(null);

  const setting = settings[index]!;

  const advance = (value: string) => {
    const next = { ...values, ...(value ? { [setting.key]: value } : {}) };
    setValues(next);
    setError(null);
    if (index + 1 >= settings.length) return onDone(next);
    setIndex(index + 1);
    setDraft(settings[index + 1]?.default ?? '');
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onDone(null);
      return exit();
    }
    if (key.return) {
      const value = draft.trim();
      if (!value) {
        if (!setting.optional && !setting.default) return setError('Required.');
        return advance(setting.default ?? '');
      }
      const chosen = setting.choices ? pick(value, setting.choices) : value;
      const problem = check(setting, chosen);
      if (problem) return setError(problem);
      return advance(setting.mountAs ? expand(chosen) : chosen);
    }
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1));
    if (input && !key.ctrl && !key.meta) setDraft((d) => d + input);
  });

  const shown = setting.secret ? '•'.repeat(draft.length) : draft;
  const optional = setting.optional || setting.default;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>{`${manifest.name} — ${manifest.tagline}`}</Text>
      <Text dimColor>{`setting up · ${index + 1} of ${settings.length}`}</Text>

      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text bold color="cyan">
          {setting.label}
        </Text>
        <Box marginTop={1}>
          <Text>{setting.why}</Text>
        </Box>
        {setting.how?.length ? (
          <Box flexDirection="column" marginTop={1}>
            {setting.how.map((step, n) => (
              <Text key={n} dimColor>{`  ${n + 1}. ${step}`}</Text>
            ))}
          </Box>
        ) : null}
        {setting.choices?.length ? (
          <Box marginTop={1}>
            <Text dimColor>{setting.choices.map((choice, n) => `${n + 1} ${choice}`).join('   ')}</Text>
          </Box>
        ) : null}
        {setting.url ? (
          <Box marginTop={1}>
            <Text color="blue" underline>
              {setting.url}
            </Text>
          </Box>
        ) : null}
      </Box>

      <Box marginTop={1}>
        <Text color="cyan">{'› '}</Text>
        <Text>{shown}</Text>
        <Text inverse>{' '}</Text>
      </Box>
      {error ? <Text color="red">{`  ${error}`}</Text> : <Text dimColor>{`  ${optional ? 'enter to skip' : 'required'}`}</Text>}
    </Box>
  );
}

const expand = (value: string) => resolve(value.replace(/^~(?=[/\\]|$)/, homedir()));

const pick = (value: string, choices: string[]) => {
  const index = Number(value) - 1;
  return Number.isInteger(index) && choices[index] !== undefined ? choices[index]! : value;
};

function check(setting: Setting, value: string): string | null {
  if (setting.mountAs && !existsSync(expand(value))) return 'No folder there. Check the path.';
  if (setting.choices && !setting.choices.includes(value)) return `Pick one of: ${setting.choices.join(', ')}`;
  const result = setting.validate?.(value);
  return result === undefined || result === true ? null : result;
}
