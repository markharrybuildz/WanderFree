import { isTransientNetworkError } from "./transientError";

// isTransientNetworkError decides whether a background-query failure is an
// expected connectivity blip (dropped, to keep the error log signal-heavy) or
// a real, actionable error (kept). The danger is the matcher SILENTLY
// BROADENING — e.g. back to a bare "connection" substring — and swallowing
// genuine errors. These cases pin both sides of that boundary.

describe("isTransientNetworkError", () => {
  it.each([
    ["RN fetch reject", new Error("Network request failed")],
    ["web fetch reject", new Error("Failed to fetch")],
    ["generic network error", new Error("Network Error")],
    ["iOS lost connection", new Error("The network connection was lost.")],
    ["socket reset", new Error("read ECONNRESET: connection reset by peer")],
    ["socket refused", new Error("connect ECONNREFUSED: Connection refused")],
    ["socket closed", new Error("connection closed before message completed")],
    ["socket aborted", new Error("connection aborted")],
    ["DNS failure", new Error('Unable to resolve host "x.supabase.co"')],
    ["offline", new Error("The Internet connection appears to be offline.")],
    ["timed out", new Error("Request timed out")],
    ["timeout", new Error("timeout exceeded")],
    ["AbortError name", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["TimeoutError name", Object.assign(new Error("x"), { name: "TimeoutError" })],
    ["thrown string", "Network request failed"],
  ])("transient: %s", (_label, err) => {
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it.each([
    // The regression guard: these mention "connect"/"connection" but are real,
    // actionable failures that must still be logged.
    ["pg pool exhausted", new Error("connection pool exhausted")],
    ["server misconfig", new Error("could not connect to the server")],
    ["pg slots reserved", new Error("remaining connection slots are reserved")],
    // Unrelated app / data errors.
    ["unique violation", new Error("duplicate key value violates unique constraint")],
    ["rls denied", new Error("permission denied for table client_errors")],
    ["schema drift", new Error('column "foo" does not exist')],
    ["app bug", new TypeError("undefined is not a function")],
    ["plain string", "Something unexpected happened"],
    ["undefined", undefined],
    ["null", null],
  ])("actionable: %s", (_label, err) => {
    expect(isTransientNetworkError(err)).toBe(false);
  });
});
