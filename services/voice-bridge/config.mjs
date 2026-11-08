export const REALTIME_MODEL = 'gpt-realtime-2.1';
export const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

export function loadConfig(env = process.env) {
  const required = ['NAQAH_BRIDGE_PUBLIC_URL', 'TWILIO_AUTH_TOKEN', 'NAQAH_VOICE_SECRET', 'OPENAI_API_KEY'];
  for (const name of required) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Missing ${name}`);
  }
  const publicUrl = new URL(env.NAQAH_BRIDGE_PUBLIC_URL);
  if (publicUrl.protocol !== 'wss:' || publicUrl.pathname !== '/voice-bridge/media'
    || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error('NAQAH_BRIDGE_PUBLIC_URL must be wss://host/voice-bridge/media');
  }
  const upstream = new URL(env.NAQAH_BRIDGE_UPSTREAM || 'http://127.0.0.1:3301');
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password
    || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('NAQAH_BRIDGE_UPSTREAM must be an HTTP(S) origin');
  }
  let providerUrl = REALTIME_URL;
  if (env.NAQAH_REALTIME_URL !== undefined) {
    const override = new URL(env.NAQAH_REALTIME_URL);
    const loopback = override.hostname === 'localhost' || override.hostname === '[::1]'
      || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(override.hostname);
    if (override.protocol !== 'ws:' || !loopback || override.username || override.password || override.hash) {
      throw new Error('NAQAH_REALTIME_URL must be a loopback ws:// URL');
    }
    if (override.hostname === 'localhost') override.hostname = '127.0.0.1';
    providerUrl = override.href;
  }
  const port = Number(env.PORT || 3300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {
    port,
    publicUrl: env.NAQAH_BRIDGE_PUBLIC_URL,
    upstream,
    providerUrl,
    authToken: env.TWILIO_AUTH_TOKEN,
    voiceSecret: env.NAQAH_VOICE_SECRET,
    apiKey: env.OPENAI_API_KEY,
  };
}
