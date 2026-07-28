// Jest via the SDK-aligned jest-expo preset (handles the RN/Expo transform,
// module mocks, and transformIgnorePatterns). We add the "@/" path alias so
// tests resolve imports the same way the app and tsconfig do.
module.exports = {
  preset: "jest-expo",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Colocated *.test.ts(x) files next to the code they cover.
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
};
