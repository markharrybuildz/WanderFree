// Client error log — operational diagnostics for runtime errors.
//
// Writes to the append-only `public.client_errors` table (insert-only RLS; see
// supabase/migrations/20260720120000_client_errors.sql). Reads happen in
// Metabase via analytics.errors_recent / errors_daily, never from the app.
//
// Deliberately NOT gated by the analytics opt-out: error diagnostics are
// operational, not behavioral analytics, so we capture them regardless of the
// "Share anonymous usage data" toggle (the privacy notice discloses this).
//
// Design mirrors lib/analytics.ts (buffered, fire-and-forget, AsyncStorage
// persistence, batch flush, client-uuid idempotency) so the two behave the
// same on flaky networks — but this module is self-contained and always-on.
//
// Recursion guard: flush() talks to Supabase; if that INSERT itself fails we
// swallow it silently and never call logError() from inside the flush/persist
// paths, so a broken sink can't spiral into an infinite error-logging loop.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";

import { SESSION_ID, uuidv4 } from "./analytics";
import { supabase } from "./supabase";

const BUFFER_KEY = "wanderfree-error-buffer";
const FLUSH_INTERVAL_MS = 20_000;
const MAX_BATCH = 20;
// Hard cap so a persistent error storm can't grow storage unboundedly; oldest
// errors drop first.
const MAX_BUFFER = 100;
const MAX_MESSAGE = 4096;
const MAX_STACK = 8192;

export type ErrorSource = "global" | "boundary" | "query" | "mutation" | "manual";

type PendingError = {
  id: string;
  source: ErrorSource;
  error_type: string | null;
  message: string;
  stack: string | null;
  fatal: boolean;
  occurred_at: string;
  session_id: string;
  platform: string | null;
  app_version: string | null;
  context: Record<string, unknown>;
};

const APP_VERSION: string | null = Constants.expoConfig?.version ?? null;
const PLATFORM: string | null = (["ios", "android", "web"] as string[]).includes(
  Platform.OS,
)
  ? Platform.OS
  : null;

let buffer: PendingError[] = [];
let flushing = false;
let started = false;

/** Pull a human string + type + stack out of whatever was thrown. RN can throw
 *  non-Error values, so handle strings/objects defensively. */
function describe(err: unknown): {
  message: string;
  error_type: string | null;
  stack: string | null;
} {
  if (err instanceof Error) {
    return {
      message: (err.message || err.name || "Unknown error").slice(0, MAX_MESSAGE),
      error_type: err.name || err.constructor?.name || null,
      stack: err.stack ? err.stack.slice(0, MAX_STACK) : null,
    };
  }
  // The DB constraint requires message length >= 1, so every branch below
  // falls back to a placeholder — an empty thrown string or an object that
  // stringifies to "" would otherwise be rejected and silently dropped.
  if (typeof err === "string") {
    return {
      message: err.slice(0, MAX_MESSAGE) || "Unknown error",
      error_type: null,
      stack: null,
    };
  }
  try {
    return {
      message: JSON.stringify(err).slice(0, MAX_MESSAGE) || "Unknown error",
      error_type: null,
      stack: null,
    };
  } catch {
    return {
      message: String(err).slice(0, MAX_MESSAGE) || "Unknown error",
      error_type: null,
      stack: null,
    };
  }
}

/** Heuristic: a transient connectivity failure (offline, DNS, timeout, dropped
 *  socket) rather than an app bug. RN's fetch rejects these with recognizable
 *  messages and Supabase-js surfaces them verbatim, so we can match on the
 *  message/name. Used to drop the burst of background-refetch failures an
 *  offline cold launch produces — those are expected and non-actionable. */
function isTransientNetworkError(err: unknown): boolean {
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
    m.includes("connection") ||
    m.includes("unable to resolve host") ||
    m.includes("internet connection appears to be offline")
  );
}

/** Record an error. Safe to call from anywhere — all I/O is deferred, and it
 *  never throws (a logging failure must not mask the original error). */
export function logError(
  err: unknown,
  opts: {
    source?: ErrorSource;
    fatal?: boolean;
    context?: Record<string, unknown>;
  } = {},
): void {
  try {
    const source = opts.source ?? "manual";
    // Background data-layer refetches (source "query") fail in bursts when the
    // device is offline — e.g. a cold launch with no connectivity retries every
    // query, then logs each one after retries are exhausted. Those network
    // failures are expected and non-actionable, so drop them for this source to
    // keep the error log signal-heavy. User-initiated (mutation), fatal
    // (global/boundary), and explicit (manual) logs are kept even when network-
    // related, because there a connectivity failure is genuinely worth seeing.
    if (source === "query" && isTransientNetworkError(err)) return;
    const { message, error_type, stack } = describe(err);
    buffer.push({
      id: uuidv4(),
      source,
      error_type,
      message,
      stack,
      fatal: opts.fatal ?? false,
      occurred_at: new Date().toISOString(),
      session_id: SESSION_ID,
      platform: PLATFORM,
      app_version: APP_VERSION,
      context: opts.context ?? {},
    });
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    void persistBuffer();
    if (buffer.length >= MAX_BATCH) void flush();
  } catch {
    // Never let the logger throw into a catch site.
  }
}

async function persistBuffer(): Promise<void> {
  try {
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    // Storage full/unavailable — errors stay in memory for this session.
  }
}

async function flush(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  try {
    const batch = buffer.slice(0, MAX_BATCH);
    const { error } = await supabase.from("client_errors").insert(batch);
    const done = new Set<string>();
    if (!error) {
      for (const e of batch) done.add(e.id);
    } else if (isPermanentError(error.code)) {
      // One bad row fails the whole batched insert. Retry rows individually so
      // only genuinely-invalid rows drop; transient per-row failures re-queue.
      for (const e of batch) {
        const { error: rowErr } = await supabase.from("client_errors").insert(e);
        if (!rowErr || isPermanentError(rowErr.code)) done.add(e.id);
      }
    }
    // else: transient batch error (network, 5xx) — keep everything.
    if (done.size > 0) {
      buffer = buffer.filter((e) => !done.has(e.id));
      await persistBuffer();
    }
  } catch {
    // Network throw — retry on the next interval. Intentionally NOT logged.
  } finally {
    flushing = false;
  }
}

function isPermanentError(code?: string): boolean {
  // 23xxx integrity (incl. 23505 duplicate = already delivered),
  // 42501 insufficient privilege, 22xxx data errors.
  return (!!code && /^(23|22)/.test(code) === true) || code === "42501";
}

/** Restore any persisted errors, install the global uncaught-error handler,
 *  and start the flush loop. Call once from the root layout. Idempotent. */
export function initErrorLog(): void {
  if (started) return;
  started = true;

  void (async () => {
    try {
      const persisted = await AsyncStorage.getItem(BUFFER_KEY);
      const restored = persisted ? (JSON.parse(persisted) as PendingError[]) : [];
      buffer = [...restored, ...buffer].slice(-MAX_BUFFER);
      await persistBuffer();
    } catch {
      // Storage unreadable — start with whatever is in memory.
    }
    void flush();
  })();

  // Uncaught JS errors. Wrap the existing handler so RN's red screen (dev) and
  // default crash behavior (prod) still fire after we record the error.
  const g = global as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const eu = g.ErrorUtils;
  if (eu?.setGlobalHandler && eu.getGlobalHandler) {
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((e, isFatal) => {
      logError(e, { source: "global", fatal: !!isFatal });
      // Flush synchronously-ish before the process may die on a fatal crash.
      void flush();
      prev?.(e, isFatal);
    });
  }

  setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  AppState.addEventListener("change", (state) => {
    if (state === "background") void flush();
  });
}
