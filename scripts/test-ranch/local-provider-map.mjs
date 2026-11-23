// LOCAL REHEARSAL ONLY. Maps provider origins to loopback endpoints and blocks all other hosts.
export function localProviderTarget(raw, { openAi = "", twilioGateway = "", allowTwilio = false } = {}) {
  const url = new URL(raw);
  if (allowTwilio && url.origin === "https://api.twilio.com") {
    const target = new URL(twilioGateway);
    const loopback = target.hostname === "localhost" || target.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(target.hostname);
    if (target.protocol !== "http:" || !loopback || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Mock Twilio origin must be loopback HTTP");
    }
    target.pathname = "/__test/twilio" + url.pathname;
    target.search = url.search;
    return target;
  }
  if (url.origin === "https://api.openai.com") {
    const target = new URL(openAi);
    if (target.protocol !== "http:" || !(target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]") || target.pathname !== "/") {
      throw new Error("Mock OpenAI origin must be loopback HTTP");
    }
    target.pathname = url.pathname;
    target.search = url.search;
    return target;
  }
  if (url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)) return url;
  throw new Error("Blocked non-loopback provider request");
}
