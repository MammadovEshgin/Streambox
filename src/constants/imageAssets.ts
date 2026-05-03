import type { ImageSourcePropType } from "react-native";
import type { AppLanguage } from "../localization/types";
import type { PersonaPresentation } from "../settings/settingsStorage";

export const onboardingPreviewImage = require("../../assets/images/onboarding/app-preview.jpeg");

const watchedStampImages = {
  en: require("../../assets/images/stamps/watched-stamp-eng.png"),
  tr: require("../../assets/images/stamps/watched-stamp-tr.jpg"),
} satisfies Record<AppLanguage, ImageSourcePropType>;

export function getWatchedStampImage(language: AppLanguage) {
  return watchedStampImages[language];
}

export const personaCardImages = {
  male: {
    thrillSeeker: require("../../assets/images/personas/male/The thrill seeker-male.jpg"),
    dreamer: require("../../assets/images/personas/male/The dreamer-male.jpg"),
    romantic: require("../../assets/images/personas/male/The romantic-male.jpg"),
    laughHunter: require("../../assets/images/personas/male/The laugh hunter-male.jpg"),
    detective: require("../../assets/images/personas/male/The detective-male.jpg"),
    cultureBuff: require("../../assets/images/personas/male/The culture buff-male.jpg"),
    horrorFanatic: require("../../assets/images/personas/male/The horror fanatic-male.jpg"),
    blockbusterFan: require("../../assets/images/personas/male/The blockbuster fan-male.jpg"),
    eclecticExplorer: require("../../assets/images/personas/male/The eclectic explorer-male.jpg"),
  },
  female: {
    thrillSeeker: require("../../assets/images/personas/female/The thrill seeker-female.jpg"),
    dreamer: require("../../assets/images/personas/female/The dreamer-female.jpg"),
    romantic: require("../../assets/images/personas/female/The romantic-female.jpg"),
    laughHunter: require("../../assets/images/personas/female/The laugh hunter-female.jpg"),
    detective: require("../../assets/images/personas/female/The detective-female.jpg"),
    cultureBuff: require("../../assets/images/personas/female/The culture buff-female.jpg"),
    horrorFanatic: require("../../assets/images/personas/female/The horror fanatic-female.jpg"),
    blockbusterFan: require("../../assets/images/personas/female/The blockbuster fan-female.jpg"),
    eclecticExplorer: require("../../assets/images/personas/female/The eclectic explorer-female.jpg"),
  },
} satisfies Record<PersonaPresentation, Record<string, ImageSourcePropType>>;

type PersonaCardImageId = keyof typeof personaCardImages.male;

export function getPersonaCardImage(personaId: PersonaCardImageId, presentation: PersonaPresentation) {
  return personaCardImages[presentation][personaId];
}
