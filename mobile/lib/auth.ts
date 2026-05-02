// Auth helpers + session hook.
//
// The session is reactive: when supabase.auth fires onAuthStateChange,
// useAuthSession's state updates and any consuming component re-renders.
// That's how the auth gate in app/_layout.tsx redirects the user when they
// sign in or sign out.

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

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
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
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
