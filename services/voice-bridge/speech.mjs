/** OpenAI recommends marin or cedar. Neither is a Saudi voice; accent is steered in the read instruction. */
export const REALTIME_VOICE = 'marin';

/**
 * The model may only read the server's line. Accent guidance must not add, drop, or rephrase words.
 * The opening clause stays stable so callers can still require a verbatim read.
 */
export function verbatimSpeechInstructions(text) {
  return [
    'Say only the following text verbatim, with no additions or omissions.',
    'If the text is Arabic, speak it in a natural Saudi accent with a light Najdi influence: calm, clear, conversational, and at a moderate pace.',
    'Do not use a news-anchor Modern Standard Arabic delivery, and do not exaggerate the dialect.',
    "Pronounce people's names, numbers, dates, times, and camel-farming words as written.",
    'If the text is not Arabic, read it in clear neutral English at a moderate pace.',
    `Text: ${JSON.stringify(text)}`,
  ].join(' ');
}
