import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID.test(value);

/**
 * Domain ids look like `tsk_k3j9x2ab`; the tables use uuid. New ids map to a stable UUID per
 * farm, so saving or importing the same record twice lands on the same row.
 */
export function toDbId(farmId: string, id: string): string {
  if (isUuid(id)) return id.toLowerCase();
  const bytes = createHash("sha256").update(`${farmId}:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // RFC 9562 version 8 (name-based, custom hash)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
