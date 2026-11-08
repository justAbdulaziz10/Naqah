export type DbErrorCode = "not_found" | "conflict" | "limit_reached" | "invalid_input" | "forbidden" | "unavailable" | "plan_required";

/** Safe to return to a client: it carries a code only, never database text. */
export class DbError extends Error {
  constructor(readonly code: DbErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = "DbError";
  }
}

export function fromPostgrest(error: { code?: string; message?: string }): DbError {
  if (error.code === "23514" && /custom questions|Worker limit|Basic plan is below saved data limits/.test(error.message ?? "")) return new DbError("limit_reached");
  if (error.code === "23514" || error.code === "22P02" || error.code === "23502" || error.code === "23503") return new DbError("invalid_input");
  if (error.code === "23505" || error.code === "NQ409") return new DbError("conflict");
  if (error.code === "42501") return new DbError("forbidden");
  if (error.code === "NQ404" || error.code === "PGRST116") return new DbError("not_found");
  return new DbError("unavailable", error.code);
}
