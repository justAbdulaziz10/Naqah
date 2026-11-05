import { createHmac, timingSafeEqual } from "node:crypto";

export type TwilioParameters = Record<string, string | string[]>;

export function twilioRequestSignature(url: string, params: TwilioParameters, authToken: string): string {
  const suffix = Object.keys(params)
    .sort()
    .map((key) => {
      const values = Array.isArray(params[key]) ? [...params[key] as string[]].sort() : [params[key] as string];
      return values.map((value) => key + value).join("");
    })
    .join("");
  return createHmac("sha1", authToken).update(url + suffix, "utf8").digest("base64");
}

export function validateTwilioSignature(
  url: string,
  params: TwilioParameters,
  signature: string | null,
  authToken: string,
): boolean {
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioRequestSignature(url, params, authToken));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

function publicRequestUrl(request: Request): string | null {
  const current = new URL(request.url);
  const pathAndQuery = `${current.pathname}${current.search}`;
  const configuredBase = process.env.NAQAH_PUBLIC_BASE_URL?.trim();
  if (configuredBase) {
    try {
      const base = new URL(configuredBase);
      if (base.protocol !== "https:" && base.protocol !== "http:") return null;
      return `${base.origin}${pathAndQuery}`;
    } catch {
      return null;
    }
  }

  const proto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const host = firstForwardedValue(request.headers.get("x-forwarded-host"));
  if (proto && host && (proto === "https" || proto === "http")) {
    try {
      const forwarded = new URL(`${proto}://${host}`);
      return `${forwarded.origin}${pathAndQuery}`;
    } catch {
      return null;
    }
  }
  return request.url;
}

function withOptionalDefaultPort(url: string): string[] {
  const parsed = new URL(url);
  if (parsed.port) return [url];
  const port = parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "";
  if (!port) return [url];
  const explicit = `${parsed.protocol}//${parsed.hostname}:${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
  return [...new Set([url, explicit])];
}

export function twilioRequestSignatureUrls(request: Request): string[] {
  const url = publicRequestUrl(request);
  return url ? withOptionalDefaultPort(url) : [];
}

export function validateTwilioRequestSignature(
  request: Request,
  params: TwilioParameters,
  signature: string | null,
  authToken: string,
): boolean {
  return twilioRequestSignatureUrls(request).some((url) => validateTwilioSignature(url, params, signature, authToken));
}

export function checkTwilioWebhookSignature(request: Request, form: URLSearchParams): { valid: boolean; verified: boolean } {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) return { valid: true, verified: false };
  const valid = validateTwilioRequestSignature(
    request,
    formParameters(form),
    request.headers.get("X-Twilio-Signature"),
    token,
  );
  return { valid, verified: valid };
}

export function formParameters(form: URLSearchParams): TwilioParameters {
  const params: TwilioParameters = {};
  for (const [key, value] of form) {
    const current = params[key];
    if (current === undefined) params[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else params[key] = [current, value];
  }
  return params;
}
