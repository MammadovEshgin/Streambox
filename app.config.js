const baseConfig = {
  name: "StreamBox",
  slug: "streambox",
  scheme: "streambox",
  version: "1.1.0",
  // Pinned to "1.0.2" because that's the runtime baked into the APK that all
  // installed users currently have. EAS Update only delivers a bundle to apps
  // running the matching runtime, so every OTA we publish MUST target 1.0.2
  // until a new APK with a bumped runtime ships from the website. Bump this
  // (and rebuild + redistribute the APK) when you intentionally cut a new
  // native release that drops compatibility with older installs.
  runtimeVersion: "1.0.2",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./assets/app-icons/app-icon-1024.png",
  assetBundlePatterns: ["**/*"],
  splash: {
    image: "./assets/app-icons/splash-brand.png",
    resizeMode: "contain",
    backgroundColor: "#000000",
  },
  updates: {
    url: "https://u.expo.dev/0671c444-de91-4f8f-b705-179036f310f3",
    checkAutomatically: "ON_LOAD",
    // Block cold-start render up to 3s while expo-updates checks for and
    // downloads a new bundle. If a fresh OTA is available, the user lands
    // directly on it instead of seeing the old bundle first. If the network
    // is slow or there's no update, we fall back to cache after 3s — so the
    // cold-start cost is bounded.
    fallbackToCacheTimeout: 3000,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.streambox.app",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/app-icons/adaptive-foreground.png",
      monochromeImage: "./assets/app-icons/adaptive-monochrome.png",
      backgroundColor: "#FFFFFF",
    },
    package: "com.streambox.app",
    allowBackup: false,
  },
  web: {
    favicon: "./assets/app-icons/app-icon-1024.png",
  },
  plugins: [
    "expo-asset",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#000000",
        image: "./assets/app-icons/splash-brand.png",
        imageWidth: 220,
      },
    ],
    "@react-native-community/datetimepicker",
    "expo-video",
    "expo-font",
    "expo-web-browser",
    "@react-native-google-signin/google-signin",
  ],
  extra: {
    eas: {
      projectId: "0671c444-de91-4f8f-b705-179036f310f3",
    },
  },
};

function hasPlugin(plugins, name) {
  return plugins.some((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name
  );
}

module.exports = () => {
  const plugins = (baseConfig.plugins ?? []).filter((plugin) =>
    Array.isArray(plugin)
      ? plugin[0] !== "@react-native-google-signin/google-signin"
      : plugin !== "@react-native-google-signin/google-signin"
  );
  const iosUrlScheme = process.env.GOOGLE_AUTH_IOS_URL_SCHEME?.trim();
  const iosBundleIdentifier = process.env.STREAMBOX_IOS_BUNDLE_IDENTIFIER?.trim();
  const androidPackage = process.env.STREAMBOX_ANDROID_PACKAGE?.trim();

  if (iosUrlScheme) {
    plugins.push([
      "@react-native-google-signin/google-signin",
      {
        iosUrlScheme,
      },
    ]);
  } else if (!hasPlugin(plugins, "@react-native-google-signin/google-signin")) {
    plugins.push("@react-native-google-signin/google-signin");
  }

  return {
    expo: {
      ...baseConfig,
      plugins,
      ios: {
        ...(baseConfig.ios ?? {}),
        ...(iosBundleIdentifier ? { bundleIdentifier: iosBundleIdentifier } : {}),
      },
      android: {
        ...(baseConfig.android ?? {}),
        ...(androidPackage ? { package: androidPackage } : {}),
      },
    },
  };
};
