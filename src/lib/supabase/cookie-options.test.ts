import { describe, expect, it } from "vitest";
import { sessionCookieOptions, sessionCookieOptionsFor } from "./config";

describe("session cookie options", () => {
  const at = (url: string) => sessionCookieOptionsFor(new URL(url));
  it("stays Secure on every https origin, production and previews", () => {
    expect(at("https://naqah.vercel.app/ar").secure).toBe(sessionCookieOptions.secure);
    expect(at("https://localhost:3300/ar").secure).toBe(sessionCookieOptions.secure);
  });
  it("drops Secure only for a plain-http loopback preview, which Safari can't otherwise keep", () => {
    expect(at("http://localhost:3300/ar").secure).toBe(false);
    expect(at("http://127.0.0.1:3300/ar").secure).toBe(false);
  });
  it("never drops Secure for plain http on another host", () => {
    expect(at("http://naqah.example/ar").secure).toBe(sessionCookieOptions.secure);
    expect(sessionCookieOptionsFor(null).secure).toBe(sessionCookieOptions.secure);
  });
  it("keeps the other options", () => {
    expect(at("http://localhost:3300/ar")).toMatchObject({ path: "/", sameSite: "lax" });
  });
});
