import { NativeModules } from "react-native";

// react-native-webrtc is a custom native module: it's present in a dev/
// production build but NOT in Expo Go. We detect the native side and only ever
// `require` the library's JS when it exists, so the rest of Watch Together
// (rooms, sync, chat, reactions, polaroid) still runs in Expo Go with the live
// face-cam simply disabled, instead of crashing the bundle.

export const isWebRtcAvailable = Boolean(NativeModules.WebRTCModule);

type WebRtcModule = typeof import("react-native-webrtc");

let cached: WebRtcModule | null | undefined;

export function getWebRtc(): WebRtcModule | null {
  if (!isWebRtcAvailable) return null;
  if (cached === undefined) {
    try {
      // Only reached inside a real build, where the native module exists.
      cached = require("react-native-webrtc") as WebRtcModule;
    } catch {
      cached = null;
    }
  }
  return cached ?? null;
}
