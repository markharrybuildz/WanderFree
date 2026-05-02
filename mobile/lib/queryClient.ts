// TanStack Query client + AsyncStorage persister.
//
// Why this matters: the user said "the app pings the database on app start".
// Without persistence that means a network round-trip + spinner before any
// UI renders on every cold launch. With persistence:
//
//   1. Cold launch → queryClient hydrates from AsyncStorage instantly.
//   2. Components render with the cached data on first paint.
//   3. Queries refetch in the background; updates fade in when fresh data
//      arrives.
//
// Cold launches feel instant; offline launches still show usable data.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Catalog data (benefits, cards) only changes quarterly when the
      // pipeline runs — so 1-hour staleTime is plenty conservative.
      staleTime: 1000 * 60 * 60,

      // Keep cache around for 7 days so cold launches after a long absence
      // still get instant rendering.
      gcTime: 1000 * 60 * 60 * 24 * 7,

      // RN doesn't have window focus the way the web does — disable the
      // refetch-on-focus behavior to avoid unnecessary requests.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  // Namespace the cache key so other AsyncStorage clients don't collide.
  key: "wanderfree-query-cache",
  // Throttle writes so we don't thrash AsyncStorage on every mutation.
  throttleTime: 1000,
});
