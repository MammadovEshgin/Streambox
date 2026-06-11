import { Platform } from "react-native";

export function isTvBuild(): boolean {
  return process.env.EXPO_PUBLIC_STREAMBOX_TV_BUILD === "1" || Platform.isTV === true;
}

