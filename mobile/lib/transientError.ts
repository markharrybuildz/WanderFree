// Transient-network detection, extracted from lib/errorLog.ts so it can be
// unit-tested without importing the error-log module's native dependencies
// (AsyncStorage, the Supabase client). Pure — no imports, no side effects.

/** Heuristic: a transient connectivity failure (offline, DNS, timeout, dropped
 *  socket) rather than an app bug. RN's fetch rejects these with recognizable
 *  messages and Supabase-js surfaces them verbatim, so we can match on the
 *  message/name. Used to drop the burst of background-refetch failures an
 *  offline cold launch produces — those are expected and non-actionable.
 *
 *  Match transport failures NARROWLY: a bare "connection" substring would also
 *  swallow real, actionable errors ("connection pool exhausted", "could not
 *  connect to the server" from a misconfig), so we require a specific dropped-
 *  socket phrase instead. */
export function isTransientNetworkError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = (raw ?? "").toLowerCase();
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    m.includes("network request failed") ||
    m.includes("network error") ||
    m.includes("failed to fetch") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("connection reset") ||
    m.includes("connection refused") ||
    m.includes("connection closed") ||
    m.includes("connection aborted") ||
    m.includes("network connection was lost") ||
    m.includes("unable to resolve host") ||
    m.includes("internet connection appears to be offline")
  );
}
