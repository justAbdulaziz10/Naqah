import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyTwilioSignature(signature, publicUrl, authToken) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{27}=$/.test(signature)) return false;
  const supplied = Buffer.from(signature, 'base64');
  return [publicUrl, `${publicUrl}/`].some((url) => {
    const expected = createHmac('sha1', authToken).update(url).digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

export function internalHeaders(rawBody, voiceSecret, timestamp = Date.now().toString()) {
  const key = createHmac('sha256', voiceSecret).update('naqah-bridge-internal').digest();
  return {
    'content-type': 'application/json',
    'x-naqah-bridge-timestamp': timestamp,
    'x-naqah-bridge-signature': createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('hex'),
  };
}

export function verifyInternalSignature(headers, body, secret, now = Date.now()) {
  const timestamp = headers['x-naqah-bridge-timestamp'];
  const signature = headers['x-naqah-bridge-signature'];
  if (typeof timestamp !== 'string' || !/^\d{1,16}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000
    || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(internalHeaders(body, secret, timestamp)['x-naqah-bridge-signature'], 'hex');
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
