const baseConfig = {
  name: "StreamBox",
  slug: "streambox",
  scheme: "streambox",
  version: "1.2.0",
  // "1.2.0" is a THIRD, isolated native runtime introduced for the Watch
  // Together feature. It bundles native modules the older fleets do not ship —
  // react-native-webrtc (peer-to-peer camera/mic) and expo-camera (polaroid
  // stills) — on top of everything in 1.1.0. Because EAS Update delivers a
  // bundle only to installs on the matching runtimeVersion, this APK is fully
  // isolated: an OTA published here can NEVER reach the 1.1.0 nav-bar fleet or
  // the 1.0.2 legacy fleet, so those old APKs cannot be broken by Watch
  // Together code that calls native modules they don't have. Publish OTAs for
  // THIS APK with runtime 1.2.0; keep 1.1.0 and 1.0.2 on their own tracks.
  runtimeVersion: "1.2.0",
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
    // Watch Together (runtime 1.2.0 only) — native camera/mic. These add
    // CAMERA / RECORD_AUDIO permissions and iOS usage strings at prebuild.
    [
      "expo-camera",
      {
        cameraPermission:
          "StreamBox uses your camera so you and your watch partner can see each other during a Watch Together session.",
        microphonePermission:
          "StreamBox uses your microphone so you can talk with your watch partner during a Watch Together session.",
        recordAudioAndroid: true,
      },
    ],
    [
      "@config-plugins/react-native-webrtc",
      {
        cameraPermission:
          "StreamBox uses your camera to share your face with your watch partner during a Watch Together session.",
        microphonePermission:
          "StreamBox uses your microphone to share your voice with your watch partner during a Watch Together session.",
      },
    ],
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
