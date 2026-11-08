import type { HealthStatus, Level, ResourceKind } from "@/domain/types";
import { RESOURCE_KINDS } from "@/domain/catalog";

const LEVELS = new Set<Level>(["good", "medium", "low", "critical", "unknown"]);
const HEALTH = new Set<HealthStatus>(["healthy", "watch", "sick", "unknown"]);
const INTENTS = ["answer", "correction", "unknown", "unclear", "confirm", "refuse", "instruction", "inquiry", "unauthorized", "unsupported"] as const;
const INTENT_SET = new Set<string>(INTENTS);

/** JSON Schema sent to Gemini. Parser remains the authority if a field is omitted. */
export const interpretationSchema = {
  type: "object",
  required: ["intent", "facts", "instructions", "reply"],
  properties: {
    intent: { type: "string", enum: [...INTENTS] },
    confirmation: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Only yes, no, or unknown when the utterance confirms or denies the pending point. Omit otherwise.",
    },
    reply: { type: "string", description: "Short reply in the requested language. Never claim a save, a call, or a ticket." },
    facts: {
      type: "array",
      description: "One entry for each fact the speaker actually stated. Omit anything not said.",
      items: {
        type: "object",
        required: ["text", "explicit", "unknown", "allOthersHealthy"],
        properties: {
          questionId: { type: "string", description: "One of the listed question ids, or a task:<id> only if that id was listed." },
          resource: { type: "string", enum: [...RESOURCE_KINDS], description: "Set only when the utterance mentions that resource." },
          level: { type: "string", enum: [...LEVELS], description: "Condition or stock word. Omit when the speaker gave a quantity but no condition. تمام, fine, and plenty are good." },
          quantity: { type: "string", description: "Spoken amount unchanged, such as 5 أكياس. This is not a stock level." },
          camelName: { type: "string", description: "Name the speaker said. Use the registered spelling when it matches. Never invent a camel." },
          health: { type: "string", enum: [...HEALTH], description: "sick when the speaker says the camel is sick or مريضة." },
          taskIndex: { type: "integer", description: "1-based T number from the open-task list. Never invent a task id." },
          taskDone: { type: "boolean", description: "True only when the speaker explicitly says that task is finished." },
          explicit: { type: "boolean", description: "True when the speaker was explicit about this fact." },
          unknown: { type: "boolean", description: "True for ما أدري or I don't know." },
          text: { type: "string", description: "The speaker's words for this fact." },
          allOthersHealthy: { type: "boolean", description: "True only when the speaker says the other camels are well." },
        },
      },
    },
    instructions: {
      type: "array",
      description: "Owner instructions only. One entry each. Leave empty for a worker report.",
      items: {
        type: "object",
        required: ["text", "actionable", "remove"],
        properties: {
          text: { type: "string" },
          actionable: { type: "boolean", description: "False only for information that asks the worker to do nothing." },
          schedule: { type: "string", enum: ["any_time", "later_today", "tomorrow", "date"] },
          date: { type: "string", description: "YYYY-MM-DD when schedule is date." },
          time: { type: "string", description: "HH:MM using 24-hour time." },
          workerText: { type: "string", description: "The same instruction in the worker language. Keep every name and number." },
          remove: { type: "boolean", description: "True when the owner withdraws an earlier instruction." },
        },
      },
    },
  },
} as const;

export interface ParsedFact {
  questionId: string | null;
  resource: ResourceKind | null;
  level: Level | null;
  quantity: string | null;
  camelName: string | null;
  health: HealthStatus | null;
  taskIndex: number | null;
  taskDone: boolean | null;
  explicit: boolean;
  unknown: boolean;
  text: string;
  allOthersHealthy: boolean;
}

export interface ParsedInstruction {
  text: string;
  actionable: boolean;
  schedule: "any_time" | "later_today" | "tomorrow" | "date" | null;
  date: string | null;
  time: string | null;
  workerText: string;
  remove: boolean;
}

export interface Interpretation {
  intent: string;
  facts: ParsedFact[];
  instructions: ParsedInstruction[];
  confirmation: "yes" | "no" | "unknown" | null;
  reply: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function one<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function fact(value: unknown): ParsedFact | null {
  const input = asRecord(value);
  if (!input) return null;
  const resource = one<ResourceKind>(input.resource, new Set(RESOURCE_KINDS));
  return {
    questionId: typeof input.questionId === "string" ? input.questionId.slice(0, 100) : null,
    resource,
    level: one<Level>(input.level, LEVELS),
    quantity: typeof input.quantity === "string" ? input.quantity.slice(0, 200) : null,
    camelName: typeof input.camelName === "string" ? input.camelName.slice(0, 80) : null,
    health: one<HealthStatus>(input.health, HEALTH),
    taskIndex: Number.isInteger(input.taskIndex) ? (input.taskIndex as number) : null,
    taskDone: typeof input.taskDone === "boolean" ? input.taskDone : null,
    explicit: input.explicit === true,
    unknown: input.unknown === true,
    text: typeof input.text === "string" ? input.text.slice(0, 500) : "",
    allOthersHealthy: input.allOthersHealthy === true,
  };
}

function instruction(value: unknown): ParsedInstruction | null {
  const input = asRecord(value);
  if (!input || typeof input.text !== "string" || !input.text.trim()) return null;
  const schedule = input.schedule === "any_time" || input.schedule === "later_today" || input.schedule === "tomorrow" || input.schedule === "date" ? input.schedule : null;
  return {
    text: input.text.trim().slice(0, 1000),
    actionable: input.actionable !== false,
    schedule,
    date: typeof input.date === "string" ? input.date : null,
    time: typeof input.time === "string" ? input.time : null,
    workerText: typeof input.workerText === "string" ? input.workerText.trim().slice(0, 1000) : "",
    remove: input.remove === true,
  };
}

/** Model ids are ignored. Only names, indexes, and catalog ids we already know can be used. */
function jsonBody(raw: string) {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseInterpretation(raw: string): Interpretation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new Error("invalid");
  }
  const input = asRecord(parsed);
  if (!input || !INTENT_SET.has(String(input.intent))) throw new Error("invalid");
  const confirmation = input.confirmation;
  return {
    intent: String(input.intent),
    facts: Array.isArray(input.facts) ? input.facts.map(fact).filter((item): item is ParsedFact => item !== null).slice(0, 20) : [],
    instructions: Array.isArray(input.instructions)
      ? input.instructions.map(instruction).filter((item): item is ParsedInstruction => item !== null).slice(0, 20)
      : [],
    confirmation: confirmation === "yes" || confirmation === "no" || confirmation === "unknown" ? confirmation : null,
    reply: typeof input.reply === "string" ? input.reply.slice(0, 600) : "",
  };
}
