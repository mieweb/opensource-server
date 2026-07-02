/** Link styling shared by the container link components. */
export const linkClass = 'text-(--color-primary,#1d4ed8) hover:underline';

/** Shorten a full image ref to just its name+tag, e.g. ghcr.io/mieweb/base:latest -> base:latest */
export function templateTitle(template: string | null): string {
  if (!template) return '—';
  return template.split('/').pop() || template;
}
