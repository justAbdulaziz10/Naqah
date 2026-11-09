import "server-only";

/** Off unless the exact value 1 is set. A deployment without it answers 404 on every Lab request. */
export const voiceLabEnabled = () => process.env.NAQAH_VOICE_LAB === "1";

const owners = () =>
  (process.env.NAQAH_VOICE_LAB_OWNERS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);

/** Every session spends OpenAI credit, so signing in is not enough: the owner must be listed. */
export function isVoiceLabOwner(user: { id: string; email?: string | null; email_confirmed_at?: string | null }): boolean {
  const allowed = owners();
  // An unconfirmed address proves nothing about who holds it.
  return allowed.includes(user.id.toLowerCase()) || Boolean(user.email && user.email_confirmed_at && allowed.includes(user.email.toLowerCase()));
}

export const voiceLabOpenAiKey = () => process.env.OPENAI_API_KEY?.trim() || null;
export const voiceLabSecret = () => process.env.NAQAH_VOICE_SECRET?.trim() || null;
