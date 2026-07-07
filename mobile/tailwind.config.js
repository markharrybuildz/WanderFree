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
    extend: {
      // Semantic colors only — values live as RGB-channel CSS variables in
      // global.css. The rgb(var()/<alpha-value>) form keeps opacity utilities
      // (e.g. bg-overlay/40) working. Tailwind's default palette is still
      // available since we extend rather than replace.
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--surface-muted) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
        "text-subtle": "rgb(var(--text-subtle) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        overlay: "rgb(var(--overlay) / <alpha-value>)",

        primary: "rgb(var(--primary) / <alpha-value>)",
        "primary-strong": "rgb(var(--primary-strong) / <alpha-value>)",
        "primary-press": "rgb(var(--primary-press) / <alpha-value>)",
        "primary-subtle": "rgb(var(--primary-subtle) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-press": "rgb(var(--accent-press) / <alpha-value>)",
        "accent-subtle": "rgb(var(--accent-subtle) / <alpha-value>)",

        error: "rgb(var(--error) / <alpha-value>)",
        "error-text": "rgb(var(--error-text) / <alpha-value>)",
        "error-subtle": "rgb(var(--error-subtle) / <alpha-value>)",
        "error-border": "rgb(var(--error-border) / <alpha-value>)",

        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-fill": "rgb(var(--warning-fill) / <alpha-value>)",
        "warning-subtle": "rgb(var(--warning-subtle) / <alpha-value>)",

        success: "rgb(var(--success) / <alpha-value>)",
        "success-text": "rgb(var(--success-text) / <alpha-value>)",
        "success-subtle": "rgb(var(--success-subtle) / <alpha-value>)",

        "nav-surface": "rgb(var(--nav-surface) / <alpha-value>)",
        "nav-active": "rgb(var(--nav-active) / <alpha-value>)",
        "nav-inactive": "rgb(var(--nav-inactive) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
