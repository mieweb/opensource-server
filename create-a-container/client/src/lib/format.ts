/**
 * Shared display formatters for byte sizes and counts.
 */

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;
const TiB = GiB * 1024;

/** Human-readable byte size using binary units labelled with familiar suffixes. */
export function formatBytes(bytes: number): string {
  if (bytes >= TiB) return `${(bytes / TiB).toFixed(1)} TB`;
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} GB`;
  if (bytes >= MiB) return `${Math.round(bytes / MiB)} MB`;
  if (bytes >= KiB) return `${Math.round(bytes / KiB)} KB`;
  return `${bytes} B`;
}
