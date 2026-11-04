/**
 * Message typing. Write the English object first, then type Arabic as
 * `Translation<typeof en>` so both languages always have the same keys.
 * Values may be strings or functions returning strings (for interpolation).
 */
export type Translation<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => string
      ? (...args: A) => string
      : T[K] extends readonly (infer U)[]
        ? readonly Translation<U>[]
        : Translation<T[K]>;
};

export function defineMessages<T>(m: { en: T; ar: Translation<T> }) {
  return m as { en: Translation<T>; ar: Translation<T> };
}
