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
