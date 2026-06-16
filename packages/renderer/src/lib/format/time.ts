/**
 * Human-readable relative time for display.
 *
 * The backend persists timestamps as ISO strings (e.g. "2026-06-15T15:07:01.997Z")
 * and exposes epoch-ms fields like `createdAtMs`. The Figma-derived UI, however,
 * was written against mock data that already carried friendly strings such as
 * "12m ago" or "just now". This helper bridges both:
 *
 *  - number              → treated as epoch milliseconds and formatted
 *  - ISO-looking string  → parsed and formatted
 *  - any other string    → passed through unchanged (already friendly)
 */
export function formatRelativeTime(value: string | number | null | undefined): string {
  if (value == null) return "";

  if (typeof value === "number") return relativeFromMs(value);

  const trimmed = value.trim();
  if (!trimmed) return "";

  // Only reformat strings that look like real (ISO) timestamps. Friendly
  // strings like "12m ago", "just now", "yesterday" fail this guard and are
  // returned verbatim.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (!Number.isNaN(ms)) return relativeFromMs(ms);
  }

  return value;
}

function relativeFromMs(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
