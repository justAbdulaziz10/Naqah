export interface LabPricing {
  textInput: number;
  textCached: number;
  textOutput: number;
  audioInput: number;
  audioCached: number;
  audioOutput: number;
  transcribeInput: number;
  transcribeOutput: number;
}

export const NO_USAGE = { textInput: 0, textCached: 0, textOutput: 0, audioInput: 0, audioCached: 0, audioOutput: 0, transcribeInput: 0, transcribeOutput: 0 };
export type LabUsage = typeof NO_USAGE;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const obj = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** OpenAI counts cached tokens inside the text and audio totals; they are billed at their own rate. */
export function addResponseUsage(total: LabUsage, usage: unknown): LabUsage {
  const input = obj(obj(usage).input_token_details);
  const output = obj(obj(usage).output_token_details);
  const cached = obj(input.cached_tokens_details);
  return {
    ...total,
    textInput: total.textInput + Math.max(0, num(input.text_tokens) - num(cached.text_tokens)),
    textCached: total.textCached + num(cached.text_tokens),
    audioInput: total.audioInput + Math.max(0, num(input.audio_tokens) - num(cached.audio_tokens)),
    audioCached: total.audioCached + num(cached.audio_tokens),
    textOutput: total.textOutput + num(output.text_tokens),
    audioOutput: total.audioOutput + num(output.audio_tokens),
  };
}

export function addTranscribeUsage(total: LabUsage, usage: unknown): LabUsage {
  const data = obj(usage);
  return { ...total, transcribeInput: total.transcribeInput + num(data.input_tokens), transcribeOutput: total.transcribeOutput + num(data.output_tokens) };
}

export const totalTokens = (usage: LabUsage) => Object.values(usage).reduce((sum, value) => sum + value, 0);

export function estimateUsd(usage: LabUsage, price: LabPricing): number {
  return (Object.keys(usage) as (keyof LabUsage)[]).reduce((sum, key) => sum + (usage[key] * price[key]) / 1_000_000, 0);
}
