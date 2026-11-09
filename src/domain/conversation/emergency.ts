import type { Workspace } from "../types";

import { copy, blank, say } from './shared';
import type { EngineResult } from './shared';

export function startEmergency(ws: Workspace, now: Date): EngineResult {
  const categories = ws.settings.emergencies.map((item) => item.label ?? item.kind.replaceAll("_", " "));
  const text = copy(
    "For an emergency, Ahmed calls you directly. NAQAH does not dispatch emergencies. The configured categories are: " +
      (categories.join(", ") || "none configured") +
      ".",
    "في الطوارئ، أحمد يتصل بك مباشرة. ناقة ما ترسل استجابة للطوارئ. الفئات المحددة: " +
      (categories.join("، ") || "ما فيه فئات محددة") +
      ".",
  );
  return {
    session: say(blank("emergency", now), text, now, true),
  };
}
