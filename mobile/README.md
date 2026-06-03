# mobile

Expo / React Native app for WanderFree. Reads from Supabase directly via the
`@supabase/supabase-js` client, with TanStack Query + AsyncStorage caching so
the UI renders instantly from cache on cold launches and refreshes in the
background.

## Stack

| Layer | Choice |
|------|--------|
| Framework | Expo SDK 55 (pinned in `package.json` — bump with `npx expo install --fix` after first setup) |
| Routing | Expo Router (file-based, types-aware) |
| Styling | NativeWind v4 — Tailwind classes from the Figma export work as-is |
| Data | `@supabase/supabase-js` + `@tanstack/react-query` + AsyncStorage persister |
| Auth | Supabase Auth via `supabase.auth.*` |
| Icons | `lucide-react-native` (matches the Figma's `lucide-react`) |

## Getting started

```bash
cd mobile

# Make sure Node matches the repo .nvmrc (20)
nvm use

# Install
npm install

# Pin Expo dependencies to the exact versions your installed Expo SDK expects.
# (The package.json pins are a starting point; this aligns them to your local
#  Expo CLI.)
npx expo install --fix

# Copy + fill in the Supabase env vars
cp .env.example .env
# edit .env with your project URL + anon key

# Start the dev server
npm start
```

Then press `i` for iOS simulator, `a` for Android emulator, or `w` for web.

## Env vars

Variables prefixed with `EXPO_PUBLIC_` are bundled into the JS and accessible
on the client. Two required:

| Var | Where to get it |
|-----|-----------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` `public` key |

**Do NOT put the service role key in this app.** It bypasses RLS. The mobile
app uses the anon key, and per-user data is guarded by RLS policies that
check `portfolio_members` (see `../supabase/README.md`).

## Layout

```
mobile/
├── app/                                 Expo Router file-based routes
│   ├── _layout.tsx                      Root: providers, global query client
│   ├── index.tsx                        Auth gate / redirect
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx                  Email/password sign-in (Supabase Auth)
│   └── (app)/
│       ├── _layout.tsx                  Tab nav (authenticated)
│       ├── benefits.tsx                 Main screen — matches the Figma
│       ├── cards.tsx                    Add/remove the user's cards
│       └── settings.tsx                 Account / sign out
├── components/
│   ├── BenefitCard.tsx
│   └── StatsCard.tsx
├── lib/
│   ├── supabase.ts                      Supabase client (AsyncStorage session)
│   ├── queryClient.ts                   TanStack Query + AsyncStorage persister
│   ├── auth.ts                          Sign-in/sign-up wrappers
│   ├── hooks.ts                         useBenefits, useUserCards, useCurrentPortfolio, etc.
│   └── types.ts                         TS shapes mirroring the Postgres schema
├── app.json                             Expo config
├── babel.config.js                      Expo + NativeWind v4 preset
├── metro.config.js                      withNativeWind wrapper
├── tailwind.config.js                   NativeWind preset + content paths
└── global.css                           Tailwind base/components/utilities
```

## Caching strategy

`lib/queryClient.ts` configures TanStack Query with:

- `staleTime: 1h` for catalog reads (benefits change quarterly, no need to refetch sooner)
- `gcTime: 7d` so cached data survives many app launches
- AsyncStorage persister — cache survives app restarts, not just background→foreground

App start:

1. UI renders immediately from AsyncStorage cache.
2. Query refetches in the background.
3. When fresh data arrives, the UI re-renders smoothly (no spinner).

Offline launches show the most recent cache.

## Porting the Figma export

The Figma export at `AI Draft 2.zip` (in the original conversation) is a Vite
+ React + Tailwind + shadcn/ui web project. Most of the className strings work
verbatim in NativeWind. The general port pattern:

| Web JSX | Mobile equivalent |
|---------|-------------------|
| `<div>` | `<View>` |
| `<p>`, `<span>` | `<Text>` |
| `<button>` | `<Pressable>` |
| `<select>` | Custom or `@react-native-picker/picker` |
| `<input>` | `<TextInput>` |
| `lucide-react` | `lucide-react-native` (same icon names) |
| `useState`, `useEffect` | identical |

Most styles port directly. The few that don't (CSS grid, a few Tailwind
plugins) have NativeWind equivalents documented at https://www.nativewind.dev .
