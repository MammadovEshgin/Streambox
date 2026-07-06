import type { ImageSourcePropType } from "react-native";
import type { AppLanguage } from "../localization/types";
import type { PersonaPresentation } from "../settings/settingsStorage";

export const onboardingPreviewImage = require("../../assets/images/onboarding/app-preview.jpeg");

const franchisePosterFallbackImage = require("../../assets/images/franchise/frenchise-poster-card-v2.jpg");

// Keyed by franchise_collections.slug. Bundled so cards render instantly with
// no network dependency; unknown slugs (added remotely before an app update)
// fall back to the generic card artwork.
const franchisePosterImages = {
  "marvel-cinematic-universe": require("../../assets/images/franchise/posters/marvel-cinematic-universe.webp"),
  "dc-universe": require("../../assets/images/franchise/posters/dc-universe.webp"),
  "x-men-collection": require("../../assets/images/franchise/posters/x-men-collection.webp"),
  "star-wars-collection": require("../../assets/images/franchise/posters/star-wars-collection.webp"),
  "harry-potter-collection": require("../../assets/images/franchise/posters/harry-potter-collection.webp"),
  "middle-earth-collection": require("../../assets/images/franchise/posters/middle-earth-collection.webp"),
  "james-bond-collection": require("../../assets/images/franchise/posters/james-bond-collection.webp"),
  "mission-impossible-collection": require("../../assets/images/franchise/posters/mission-impossible-collection.webp"),
  "the-fast-and-the-furious-collection": require("../../assets/images/franchise/posters/the-fast-and-the-furious-collection.webp"),
  "transformers-collection": require("../../assets/images/franchise/posters/transformers-collection.webp"),
  "jurassic-park-collection": require("../../assets/images/franchise/posters/jurassic-park-collection.webp"),
  "the-twilight-collection": require("../../assets/images/franchise/posters/the-twilight-collection.webp"),
  "rocky-collection": require("../../assets/images/franchise/posters/rocky-collection.webp"),
  "john-wick-collection": require("../../assets/images/franchise/posters/john-wick-collection.webp"),
  "the-bourne-collection": require("../../assets/images/franchise/posters/the-bourne-collection.webp"),
  "dune-collection": require("../../assets/images/franchise/posters/dune-collection.webp"),
  "indiana-jones-collection": require("../../assets/images/franchise/posters/indiana-jones-collection.webp"),
  "the-hunger-games-collection": require("../../assets/images/franchise/posters/the-hunger-games-collection.webp"),
  "saw-collection": require("../../assets/images/franchise/posters/saw-collection.webp"),
  "scream-collection": require("../../assets/images/franchise/posters/scream-collection.webp"),
  "the-conjuring-collection": require("../../assets/images/franchise/posters/the-conjuring-collection.webp"),
  "insidious-collection": require("../../assets/images/franchise/posters/insidious-collection.webp"),
} satisfies Record<string, ImageSourcePropType>;

export function getFranchisePosterImage(slug: string): ImageSourcePropType {
  return franchisePosterImages[slug as keyof typeof franchisePosterImages] ?? franchisePosterFallbackImage;
}

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
