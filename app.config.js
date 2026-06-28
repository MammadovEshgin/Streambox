const baseConfig = {
  name: "StreamBox",
  slug: "streambox",
  scheme: "streambox",
  version: "1.1.0",
  // "1.1.0" is the runtime for the native release that bundles the
  // expo-navigation-bar module (immersive nav-bar hide during playback). It is
  // DELIBERATELY a different runtime from the legacy "1.0.2" APKs: those don't
  // ship the native module, so an OTA carrying nav-bar code would crash them.
  // EAS Update only delivers a bundle to apps on the matching runtime, so this
  // build is isolated — it never receives the nav-bar-free 1.0.2 OTAs, and the
  // 1.0.2 fleet never receives nav-bar code. Publish OTAs for THIS APK with
  // runtime 1.1.0; keep publishing the legacy fleet's fixes on 1.0.2.
  runtimeVersion: "1.1.0",
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
    // LiveOpsHost owns update checks so every downloaded update is presented
    // with the explicit Restart now / Later modal before reloadAsync runs.
    checkAutomatically: "NEVER",
    fallbackToCacheTimeout: 0,
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
