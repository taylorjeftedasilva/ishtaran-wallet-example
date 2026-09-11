/** Shortens a UUID/address for display in a primary row -- the full value always stays available
 * in a "Technical details" section (product requirement: no raw identifiers as primary UI). */
export function shorten(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
