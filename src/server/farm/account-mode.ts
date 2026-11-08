import "server-only";

/** Same build-time contract as the browser. Nothing except the exact value 1 enables account data. */
export function isAccountDataEnabled(): boolean {
  return process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA === "1";
}
