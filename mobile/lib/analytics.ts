// Behavioral analytics client — privacy-first, opt-out.
//
// Writes to the append-only `analytics_events` table (insert-only RLS; see
// supabase/migrations/20260715120000_analytics_events.sql). Reads happen in
// Metabase via the analytics views, never from the app.
//
// Design:
//   * Fire-and-forget: track() never throws, never blocks UI, and drops
//     events silently when the user has opted out (Account → usage toggle).
//   * Buffered: events accumulate in memory, persist to AsyncStorage (so
//     they survive restarts), and flush in small batches on an interval and
//     when the app backgrounds. Client-generated ids make retries
//     idempotent (PK conflict = already delivered).
//   * No PII: event names and small property bags only. profile_id is NOT
//     sent from the client — the column defaults to auth.uid() server-side,
//     and RLS rejects spoofing someone else's id.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import { supabase } from "./supabase";

const OPT_OUT_KEY = "wanderfree-analytics-opt-out";
const BUFFER_KEY = "wanderfree-analytics-buffer";
const FLUSH_INTERVAL_MS = 15_000;
const MAX_BATCH = 25;
// Hard cap so a long offline stretch can't grow storage unboundedly; oldest
// events drop first (recent behavior is worth more than stale history).
const MAX_BUFFER = 200;

type PendingEvent = {
  id: string;
  event_name: string;
  occurred_at: string;
  session_id: string;
  platform: string | null;
  app_version: string | null;
  portfolio_id: string | null;
  properties: Record<string, unknown>;
};

// Non-crypto v4 is fine here: these are idempotency keys, not secrets, and
// Hermes doesn't ship crypto.randomUUID.
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const SESSION_ID = uuidv4();
const APP_VERSION: string | null = Constants.expoConfig?.version ?? null;
// The table's check constraint only knows these three.
const PLATFORM: string | null = (["ios", "android", "web"] as string[]).includes(
  Platform.OS,
)
  ? Platform.OS
  : null;

// Tri-state: null until the persisted opt-out preference has loaded. Events
// tracked in that window go to `preInit` (memory only, never persisted) and
// are committed or discarded once the preference resolves — otherwise a
// pre-init screen_view could outlive a user's opt-out.
let enabled: boolean | null = null;
let preInit: PendingEvent[] = [];
let buffer: PendingEvent[] = [];
let flushing = false;

/** Queue an event. Safe to call from anywhere, including render paths —
 *  all I/O is deferred. */
export function track(
  eventName: string,
  properties: Record<string, unknown> = {},
  portfolioId?: string | null,
): void {
  if (enabled === false) return;
  const event: PendingEvent = {
    id: uuidv4(),
    event_name: eventName.slice(0, 64),
    occurred_at: new Date().toISOString(),
    session_id: SESSION_ID,
    platform: PLATFORM,
    app_version: APP_VERSION,
    portfolio_id: portfolioId ?? null,
    properties,
  };
  if (enabled === null) {
    preInit.push(event);
    return;
  }
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  void persistBuffer();
  if (buffer.length >= MAX_BATCH) void flush();
}

async function persistBuffer(): Promise<void> {
  try {
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    // Storage full/unavailable — events stay in memory for this session.
  }
}

async function flush(): Promise<void> {
  if (flushing || enabled !== true || buffer.length === 0) return;
  flushing = true;
  try {
    const batch = buffer.slice(0, MAX_BATCH);
    const { error } = await supabase.from("analytics_events").insert(batch);
    const done = new Set<string>();
    if (!error) {
      for (const e of batch) done.add(e.id);
    } else if (isPermanentError(error.code)) {
      // One bad row fails the whole batched insert. Retry rows one at a
      // time so only the actually-invalid ones get dropped — transient
      // per-row failures stay queued for the next flush.
      for (const e of batch) {
        const { error: rowErr } = await supabase
          .from("analytics_events")
          .insert(e);
        if (!rowErr || isPermanentError(rowErr.code)) done.add(e.id);
      }
    }
    // else: transient batch error (network, 5xx) — keep everything.
    if (done.size > 0) {
      buffer = buffer.filter((e) => !done.has(e.id));
      await persistBuffer();
    }
  } catch {
    // Network throw — retry on the next interval.
  } finally {
    flushing = false;
  }
}

function isPermanentError(code?: string): boolean {
  // 23xxx integrity (incl. 23505 duplicate = already delivered),
  // 42501 insufficient privilege, 22xxx data errors.
  return !!code && /^(23|22)/.test(code) === true || code === "42501";
}

// ── Opt-out (Account → "Share anonymous usage data") ────────────────────

export async function setAnalyticsEnabled(value: boolean): Promise<void> {
  enabled = value;
  try {
    if (value) await AsyncStorage.removeItem(OPT_OUT_KEY);
    else {
      await AsyncStorage.setItem(OPT_OUT_KEY, "1");
      buffer = [];
      preInit = [];
      await AsyncStorage.removeItem(BUFFER_KEY);
    }
  } catch {
    // Preference still applies in-memory for this session.
  }
}

/** Toggle state for the Account screen. Reflects persisted opt-out. */
export function useAnalyticsEnabled(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(enabled ?? true);
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(OPT_OUT_KEY).then((optedOut) => {
      if (mounted) setValue(optedOut == null);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const set = (v: boolean) => {
    setValue(v);
    void setAnalyticsEnabled(v);
  };
  return [value, set];
}

// ── Init: restore state, start the flush loop, flush on background ──────

async function init(): Promise<void> {
  try {
    const [optedOut, persisted] = await Promise.all([
      AsyncStorage.getItem(OPT_OUT_KEY),
      AsyncStorage.getItem(BUFFER_KEY),
    ]);
    enabled = optedOut == null;
    if (enabled) {
      const restored = persisted ? (JSON.parse(persisted) as PendingEvent[]) : [];
      // Restored (oldest) → pre-init staging → anything newer.
      buffer = [...restored, ...preInit, ...buffer].slice(-MAX_BUFFER);
      preInit = [];
      await persistBuffer();
    } else {
      // Opted out: discard the pre-init staging queue AND any stale
      // persisted buffer so nothing recorded pre-resolution survives.
      preInit = [];
      buffer = [];
      await AsyncStorage.removeItem(BUFFER_KEY);
    }
  } catch {
    // Storage unreadable — fail open (default-on model) and keep staged events.
    enabled = true;
    buffer = [...preInit, ...buffer].slice(-MAX_BUFFER);
    preInit = [];
  }
  track("app_open");
  void flush();
}

void init();
setInterval(() => void flush(), FLUSH_INTERVAL_MS);
AppState.addEventListener("change", (state) => {
  if (state === "background") void flush();
});
