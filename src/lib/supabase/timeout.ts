/** auth-js retries network failures for up to ~30s, so every server-side call gets its own limit. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Supabase request timed out')), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
