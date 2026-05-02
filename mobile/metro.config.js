// Expo + NativeWind v4 Metro config.
// NativeWind v4 needs `withNativeWind` to wire Tailwind into the bundler.

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
