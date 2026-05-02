// Expo + NativeWind v4 babel config.
// NativeWind v4 uses a babel plugin that transforms className → style at build time.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
