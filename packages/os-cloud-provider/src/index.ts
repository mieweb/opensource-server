/**
 * `@mieweb/os-cloud-provider` — the opensource-server (os.mieweb.org)
 * implementation of the `@mieweb/deploy-contract` DeployProvider.
 *
 * `mieweb deploy --target mieweb` resolves this package from the app's
 * node_modules via `targets.mieweb.provider` and calls `createProvider(env)`.
 *
 * Verbs: deploy, destroy, tail, whoami, login, logout. `deploy` converges the
 * container through the Manager API (skipped when nothing changed) and then
 * syncs the local worktree into it over its published SSH port (pure-JS
 * SSH via `ssh2`; no local rsync/ssh binaries needed).
 *   - `dev` is intentionally omitted: there is no remote analogue; local dev
 *     uses the CLI's own host harness.
 *   - `tail` streams `app.service`'s journal over the container's SSH port
 *     (`-n/--lines N`, `--no-follow`, `--since <time>`).
 *
 * Secrets come only from `env` (MIEWEB_OS_TOKEN, MIEWEB_OS_SECRET_*) or the
 * machine-local login cache, never from the DeployContext.
 */

import type { DeployContext, DeployProvider, DeployTarget, ProviderEnv } from '@mieweb/deploy-contract';
import { login, logout, whoami, type LoginHooks } from './auth.ts';
import { PROVIDER_NAME } from './config.ts';
import { deploy, destroy, tail, type ProviderDeps } from './deploy.ts';
import type { Prompter, waitForSsh } from './ssh.ts';

export { PROVIDER_NAME, DEFAULT_IMAGE, DEFAULT_INSTANCE_URL, DATA_VOLUME, ConfigError } from './config.ts';
export { ManagerApiError } from './client.ts';
export { JobFailedError } from './jobs.ts';

export interface ProviderOptions {
  /** Injected fetch (tests). */
  fetch?: typeof fetch;
  /** Job poll interval in ms (default 2000). */
  pollIntervalMs?: number;
  /** Browser/prompt hooks for `login` (tests). */
  login?: LoginHooks;
  /** Open the sync SSH session (tests). */
  connectSsh?: ProviderDeps['connectSsh'];
  /** Terminal prompt for SSH passphrases/passwords. */
  prompt?: Prompter;
  /** SSH readiness probe (tests). */
  waitForSsh?: typeof waitForSsh;
  /** Total SSH readiness budget in ms (default 60000). */
  sshTimeoutMs?: number;
  /** Delay between SSH attempts in ms (default 2000). */
  sshRetryDelayMs?: number;
}

/** The targets this provider serves. */
export const SUPPORTED_TARGETS: readonly DeployTarget[] = ['mieweb'];

export function createProvider(env: ProviderEnv, options: ProviderOptions = {}): DeployProvider {
  const deps: ProviderDeps = {
    env,
    fetch: options.fetch,
    pollIntervalMs: options.pollIntervalMs,
    connectSsh: options.connectSsh,
    prompt: options.prompt,
    waitForSsh: options.waitForSsh,
    sshTimeoutMs: options.sshTimeoutMs,
    sshRetryDelayMs: options.sshRetryDelayMs,
  };
  return {
    name: PROVIDER_NAME,
    supports: (target: DeployTarget) => SUPPORTED_TARGETS.includes(target),
    deploy: (ctx: DeployContext) => deploy(ctx, deps),
    destroy: (ctx: DeployContext) => destroy(ctx, deps),
    tail: (ctx: DeployContext) => tail(ctx, deps),
    whoami: (ctx: DeployContext) => whoami(ctx, deps),
    login: (ctx: DeployContext) => login(ctx, deps, options.login),
    logout: (ctx: DeployContext) => logout(ctx, deps),
  };
}
