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
  theme: {
    extend: {},
  },
  plugins: [],
};
