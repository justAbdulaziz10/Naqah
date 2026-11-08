const gateway = new URL(process.env.NAQAH_TEST_OUTBOUND_GATEWAY ?? "http://invalid");
const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/;
if (gateway.protocol !== "http:" || !loopback.test(gateway.hostname) || gateway.pathname !== "/") {
  throw new Error("NAQAH_TEST_OUTBOUND_GATEWAY must be a loopback HTTP origin");
}
if (process.env.TWILIO_ACCOUNT_SID !== `AC${"0".repeat(32)}` || process.env.TWILIO_AUTH_TOKEN !== "local-test-auth-token") {
  throw new Error("The outbound mock requires fake Twilio credentials");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "https://api.twilio.com") {
    if (input instanceof Request) throw new Error("Unexpected Request object in outbound mock");
    return originalFetch(new URL(`/__test/twilio${url.pathname}`, gateway), options);
  }
  if (!loopback.test(url.hostname)) throw new Error(`Blocked non-loopback fetch: ${url.origin}`);
  return originalFetch(input, options);
};
