// LOCAL REHEARSAL ONLY. Reuses the outbound guard and maps Twilio/OpenAI HTTP probes to loopback.
import "../../supabase/local-validation/mock-outbound.mjs";
import { localProviderTarget } from "./local-provider-map.mjs";

const previousFetch = globalThis.fetch;
const openAiOrigin = process.env.NAQAH_TEST_OPENAI_HTTP_ORIGIN ?? "";
const twilioGateway = process.env.NAQAH_TEST_OUTBOUND_GATEWAY ?? "";

globalThis.fetch = (input, init) => {
  const source = input instanceof Request ? input.url : String(input);
  const target = localProviderTarget(source, { openAi: openAiOrigin, twilioGateway, allowTwilio: true });
  return previousFetch(target, init);
};
