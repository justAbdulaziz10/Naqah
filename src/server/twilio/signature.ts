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
