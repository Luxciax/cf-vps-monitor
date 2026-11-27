/** datetime-local controls display wall time; APIs persist explicit ISO instants. */
export function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function fromLocalDateTime(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}
