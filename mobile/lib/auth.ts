// Auth helpers + session hook.
//
// The session is reactive: when supabase.auth fires onAuthStateChange,
// useAuthSession's state updates and any consuming component re-renders.
// That's how the auth gate in app/_layout.tsx redirects the user when they
// sign in or sign out.

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { queryClient } from "./queryClient";
import { supabase } from "./supabase";

export interface AuthState {
  session: Session | null;
  /** True until the initial getSession() call resolves — different from "logged out". */
  loading: boolean;
}

export function useAuthSession(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Hydrate from any persisted session (AsyncStorage).
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    // 2. Subscribe to future changes — sign in / sign out / token refresh.
    //    On identity changes, clear the ENTIRE query cache so no data from
    //    the previous user can leak on a shared device. User-scoped keys are
    //    varied (["user_portfolios"], ["portfolio", id, ...], ["card", id]),
    //    so a targeted removeQueries misses some; clear() is the safe reset.
    //    The catalog re-fetches on next read (cheap, and not user-private).
    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        queryClient.clear();
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

// ── Imperative wrappers ──────────────────────────────────────────────────

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

/**
 * Permanently delete the signed-in user's account and all their data via the
 * `delete_own_account` RPC (see supabase/migrations). Only ever affects the
 * caller. Returns the RPC error (e.g. the shared-portfolio guard) if any.
 */
export async function deleteAccount() {
  return supabase.rpc("delete_own_account");
}
