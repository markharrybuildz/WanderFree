// Supabase client — module-level singleton.
//
// Two important details for React Native:
//   1. We import 'react-native-url-polyfill/auto' before anything else;
//      supabase-js uses URL/URLSearchParams which RN doesn't ship by default.
//   2. We pass AsyncStorage as the auth storage backend so the user's session
//      survives app restarts (the default uses localStorage, which doesn't exist).

import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly during dev — a missing env var manifests as a 401 from
  // every query otherwise, which is much harder to debug.
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy mobile/.env.example to mobile/.env and fill in your project's values.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // detectSessionInUrl is for OAuth flows in browsers; React Native doesn't
    // need it and leaving it true causes warnings.
    detectSessionInUrl: false,
  },
});
