/** A parsed JSON object. Arrays and null are rejected. */
export type JsonRecord = Record<string, unknown>;

export function asRecord(v: unknown): JsonRecord | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as JsonRecord) : null;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
