import type { ImageSourcePropType } from "react-native";

export const onboardingPreviewImage = require("./onboarding/app-preview.jpeg");

export const personaCardImages = {
  thrillSeeker: require("./personas/The thrill seeker.png"),
  dreamer: require("./personas/The dreamer.png"),
  romantic: require("./personas/The romantic.png"),
  laughHunter: require("./personas/The laugh hunter.png"),
  detective: require("./personas/The detective.png"),
  cultureBuff: require("./personas/The culture buff.png"),
  horrorFanatic: require("./personas/The horror fanatic.png"),
  blockbusterFan: require("./personas/The blockbuster fan.png"),
  eclecticExplorer: require("./personas/The eclectic explorer.png"),
} satisfies Record<string, ImageSourcePropType>;
