import { describe, expect, it } from "vitest";
import { readBoundedJson, readBoundedText } from "./body";

function streamed(body: string, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(body);
  return new Request("https://naqah.test", {
    method: "POST",
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    }),
    // A streamed request body is not automatically marked as duplex by all runtimes.
    duplex: "half",
  } as RequestInit);
}

describe("bounded request body reader", () => {
  it("accepts bodies at the byte limit, including streamed bodies", async () => {
    const request = streamed("12345");
    expect(await readBoundedText(request, 5)).toEqual({ ok: true, text: "12345" });
  });

  it("rejects declared and streamed oversized bodies with 413", async () => {
    const declared = new Request("https://naqah.test", { method: "POST", headers: { "content-length": "6" }, body: "123456" });
    expect(await readBoundedText(declared, 5)).toEqual({ ok: false, status: 413, reason: "too_large" });
    expect(await readBoundedText(streamed("123456"), 5)).toEqual({ ok: false, status: 413, reason: "too_large" });
  });

  it("rejects invalid lengths, malformed UTF-8, and malformed JSON", async () => {
    const invalidLength = new Request("https://naqah.test", { method: "POST", headers: { "content-length": "-1" }, body: "" });
    expect(await readBoundedText(invalidLength, 5)).toEqual({ ok: false, status: 400, reason: "invalid_length" });
    const invalidUtf8 = new Request("https://naqah.test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } }),
      duplex: "half",
    } as RequestInit);
    expect(await readBoundedText(invalidUtf8, 5)).toEqual({ ok: false, status: 400, reason: "invalid_body" });
    expect(await readBoundedJson(new Request("https://naqah.test", { method: "POST", body: "{" }))).toEqual({ ok: false, status: 400, reason: "invalid_json" });
  });
});
