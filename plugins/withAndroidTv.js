const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

function upsertUsesFeature(androidManifest, name, required) {
  const manifest = androidManifest.manifest;
  manifest["uses-feature"] = manifest["uses-feature"] ?? [];
  const existing = manifest["uses-feature"].find((feature) => feature.$?.["android:name"] === name);

  if (existing) {
    existing.$["android:required"] = required;
    return;
  }

  manifest["uses-feature"].push({
    $: {
      "android:name": name,
      "android:required": required,
    },
  });
}

function hasIntentCategory(intentFilter, categoryName) {
  return (intentFilter.category ?? []).some((category) => category.$?.["android:name"] === categoryName);
}

function withAndroidTv(config) {
  config = withAndroidManifest(config, (modConfig) => {
    const androidManifest = modConfig.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);

    upsertUsesFeature(androidManifest, "android.software.leanback", "true");
    upsertUsesFeature(androidManifest, "android.hardware.touchscreen", "false");

    application.$["android:banner"] = "@drawable/tv_banner";
    application.$["android:isGame"] = "false";

    mainActivity["intent-filter"] = mainActivity["intent-filter"] ?? [];
    const hasLeanbackLauncher = mainActivity["intent-filter"].some((filter) =>
      hasIntentCategory(filter, "android.intent.category.LEANBACK_LAUNCHER")
    );

    if (!hasLeanbackLauncher) {
      mainActivity["intent-filter"].push({
        action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
        category: [{ $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" } }],
      });
    }

    return modConfig;
  });

  config = withDangerousMod(config, [
    "android",
    (modConfig) => {
      const drawableDir = path.join(modConfig.modRequest.platformProjectRoot, "app", "src", "main", "res", "drawable");
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(
        path.join(drawableDir, "tv_banner.xml"),
        [
          "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
          "<layer-list xmlns:android=\"http://schemas.android.com/apk/res/android\">",
          "  <item>",
          "    <shape android:shape=\"rectangle\">",
          "      <solid android:color=\"#0D100F\" />",
          "      <corners android:radius=\"12dp\" />",
          "    </shape>",
          "  </item>",
          "</layer-list>",
          "",
        ].join("\n")
      );
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withAndroidTv;

