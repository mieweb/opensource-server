/** Terminal prompts (the `read` package), written to stderr. */

import { read } from 'read';

/** Ask on the terminal; `hidden` suppresses echo. Resolves null when there is no TTY or on Ctrl-C. */
export type Prompter = (question: string, hidden: boolean) => Promise<string | null>;

export const ttyPrompter: Prompter = async (question, hidden) => {
  if (!process.stdin.isTTY) return null;
  try {
    return await read<string>({ prompt: question, silent: hidden, replace: hidden ? '' : undefined, output: process.stderr });
  } catch {
    return null; // canceled (Ctrl-C) or stdin closed
  }
};
