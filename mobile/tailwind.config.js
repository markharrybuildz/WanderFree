/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 needs the preset to translate Tailwind utilities into
  // React Native StyleSheet. The content paths must match every file that
  // contains className strings.
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  // NativeWind v4 on web defaults to `darkMode: 'media'`, which uses the
  // browser's prefers-color-scheme query. That mode conflicts with NativeWind's
  // own class-based dark-variant injection and throws
  // "Cannot manually set color scheme, as dark mode is type 'media'" on boot.
  // Switch to class-based mode (we can still toggle programmatically later).
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
};
