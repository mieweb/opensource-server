/**
 * Minimal leveled logger for the agent.
 *
 * The agent runs as a systemd oneshot, so everything written to stdout/stderr
 * lands in the journal (view with `journalctl -u opensource-agent`). We keep a
 * tiny hand-rolled logger rather than pull in a dependency: levels gate what
 * gets emitted, error/warn go to stderr and info/debug to stdout, and each
 * line is prefixed with its level so journal output is greppable.
 *
 * The active level comes from LOG_LEVEL (case-insensitive; default "info").
 * An unknown value falls back to "info" with a warning so a typo can't
 * silently mute the agent.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let activeLevel: LogLevel = 'info';

/**
 * Set the active level from a raw env string. Returns the level actually
 * applied. Call once at startup from loadConfig(); defaults to "info".
 */
export function setLogLevel(raw: string | undefined): LogLevel {
  if (!raw) {
    activeLevel = 'info';
    return activeLevel;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized in LEVELS) {
    activeLevel = normalized as LogLevel;
  } else {
    activeLevel = 'info';
    log.warn(`Unknown LOG_LEVEL "${raw}", defaulting to "info"`);
  }
  return activeLevel;
}

function emit(level: LogLevel, message: string): void {
  if (LEVELS[level] > LEVELS[activeLevel]) return;
  const line = `[${level}] ${message}`;
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  error: (message: string) => emit('error', message),
  warn: (message: string) => emit('warn', message),
  info: (message: string) => emit('info', message),
  debug: (message: string) => emit('debug', message),
};

/**
 * Format an error's command output (execFileSync attaches captured stdout /
 * stderr to the thrown error when stdio is 'pipe'). Returns a trimmed,
 * human-readable blob or null when there is nothing captured — used to surface
 * the actual reason a command like `nginx -t` rejected a config.
 */
export function commandOutput(err: unknown): string | null {
  const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
  const parts = [e?.stdout, e?.stderr]
    .map((part) => (part == null ? '' : part.toString()).trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('\n') : null;
}
