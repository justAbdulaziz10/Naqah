export const MAX_FORM_BODY_BYTES = 32 * 1024;
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type BoundedTextResult =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; reason: "invalid_length" | "invalid_body" | "too_large" };

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; reason: "invalid_length" | "invalid_body" | "too_large" | "invalid_json" };

/** Read a request body without buffering more than `maxBytes` bytes. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<BoundedTextResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer");

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, status: 400, reason: "invalid_length" };
    if (Number(contentLength) > maxBytes) return { ok: false, status: 413, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" };

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, reason: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, status: 400, reason: "invalid_body" };
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJson(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<BoundedJsonResult> {
  const body = await readBoundedText(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, status: 400, reason: "invalid_json" };
  }
}
