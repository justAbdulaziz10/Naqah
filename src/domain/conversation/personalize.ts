/**
 * Call Lab messages are a plain tree. Functions are the one argument shapes used by the copy:
 * numeric counts or a single string value, always returning display text.
 */
import type { Workspace } from "../types";
import type { Reply, Turn } from "./shared";

export const SAMPLE_NAMES = {
  worker: ["Ahmed", "أحمد"],
  owner: ["Abdullah", "عبدالله"],
} as const;

export type Personalizer = (text: string) => string;
export type MessageTreeFunction = ((value: string) => string) | ((value: number) => string);
export type MessageTreeNode =
  | string
  | number
  | boolean
  | undefined
  | null
  | LocalizedTextNode
  | readonly MessageTreeNode[]
  | MessageTreeObject
  | Turn
  | Reply
  | MessageTreeFunction;
export interface LocalizedTextNode {
  readonly ar: string;
  readonly en: string;
}
export interface MessageTreeObject {
  readonly [key: string]: MessageTreeNode;
}

export function makePersonalizer(ws: Pick<Workspace, "settings"> | null): Personalizer {
  if (!ws) return (text) => text;
  const worker = ws.settings.worker.name.trim();
  const ownerFull = ws.settings.owner.name.trim();
  const owner = ownerFull.split(/\s+/)[0] ?? "";
  // A real name that already contains a sample name ("Ahmed Saleh", "محمد بن عبدالله") would
  // otherwise double up or swap the wrong word, so leave that role alone.
  const mentionsSample = (name: string, samples: readonly string[]) => samples.some((sample) => name.includes(sample));
  const names = new Map<string, string>();
  if (worker && !mentionsSample(worker, SAMPLE_NAMES.worker)) for (const sample of SAMPLE_NAMES.worker) names.set(sample, worker);
  if (owner && !mentionsSample(ownerFull, SAMPLE_NAMES.owner)) for (const sample of SAMPLE_NAMES.owner) names.set(sample, owner);
  if (!names.size) return (text) => text;
  // One pass: a worker named Abdullah must not then be renamed as the owner.
  const samples = new RegExp([...names.keys()].join("|"), "g");
  return (text) => text.replace(samples, (sample, offset, original) => {
    const replacement = names.get(sample) ?? sample;
    // Keep a visible joining stroke between the Arabic preposition and a Latin farm name.
    if (original[offset - 1] === "ب" && !/[\u0600-\u06ff]/u.test(replacement)) return `ـ${replacement}`;
    return replacement;
  });
}

function isPlainMessageObject(value: object): value is MessageTreeObject {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndex(property: string): boolean {
  return /^(0|[1-9]\d*)$/.test(property);
}

function personalizedNode(value: MessageTreeNode, fn: Personalizer, cache: WeakMap<object, MessageTreeNode>): MessageTreeNode {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return typeof value === "string" ? fn(value) : value;
  if (typeof value === "function") {
    const cached = cache.get(value);
    if (cached) return cached;
    const wrapped = new Proxy(value, {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        return typeof result === "string" ? fn(result) : result;
      },
    });
    cache.set(value, wrapped);
    return wrapped;
  }
  if (Array.isArray(value)) {
    const cached = cache.get(value);
    if (cached) return cached;
    const wrapped = new Proxy(value, {
      get(target, property, receiver) {
        const child = Reflect.get(target, property, receiver);
        return typeof property === "string" && isArrayIndex(property)
          ? personalizedNode(child, fn, cache)
          : child;
      },
    });
    cache.set(value, wrapped);
    return wrapped;
  }
  if (!isPlainMessageObject(value)) throw new TypeError("Call Lab messages must use plain objects");
  const cached = cache.get(value);
  if (cached) return cached;
  const wrapped = new Proxy(value, {
    get(target, property, receiver) {
      const child = Reflect.get(target, property, receiver);
      if ("literal" in target && target.literal === true) return child;
      return typeof property === "string" ? personalizedNode(child, fn, cache) : child;
    },
  });
  cache.set(value, wrapped);
  return wrapped;
}

/** Personalize a typed message tree lazily while preserving its exact public shape. */
export function personalizeTree<T extends MessageTreeObject>(value: T, fn: Personalizer): T {
  const cache = new WeakMap<object, MessageTreeNode>();
  const wrapped = new Proxy(value, {
    get(target, property, receiver) {
      const child = Reflect.get(target, property, receiver);
      return typeof property === "string" ? personalizedNode(child, fn, cache) : child;
    },
  });
  cache.set(value, wrapped);
  return wrapped;
}
