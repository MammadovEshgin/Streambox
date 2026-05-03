const baseConfig = {
  name: "StreamBox",
  slug: "streambox",
  scheme: "streambox",
  version: "1.0.2",
  runtimeVersion: {
    policy: "appVersion",
  },
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./assets/app-icons/app-icon-1024.png",
  assetBundlePatterns: ["**/*"],
  splash: {
    image: "./assets/app-icons/adaptive-foreground.png",
    resizeMode: "contain",
    backgroundColor: "#000000",
  },
  updates: {
    url: "https://u.expo.dev/0671c444-de91-4f8f-b705-179036f310f3",
    checkAutomatically: "ON_ERROR_RECOVERY",
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
      backgroundColor: "#000000",
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
        image: "./assets/app-icons/adaptive-foreground.png",
        imageWidth: 136,
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
