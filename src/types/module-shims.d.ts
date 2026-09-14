declare module "expo-linear-gradient" {
  export const LinearGradient: any;
}

declare module "expo-blur" {
  export const BlurView: any;
}

declare module "expo-auth-session" {
  const AuthSession: any;
  export = AuthSession;
}

declare module "expo-web-browser" {
  const WebBrowser: any;
  export = WebBrowser;
}

declare module "@react-navigation/native-stack" {
  export type NativeStackScreenProps<
    ParamList extends Record<string, object | undefined> = Record<string, object | undefined>,
    RouteName extends keyof ParamList = keyof ParamList
  > = {
    navigation: any;
    route: {
      key: string;
      name: RouteName;
      params: ParamList[RouteName];
    };
  };

  export function createNativeStackNavigator<ParamList extends Record<string, object | undefined> = Record<string, object | undefined>>(): any;
}

declare module "expo-video" {
  export type ContentType = "hls" | "dash" | "progressive" | undefined;
  export type SubtitleTrack = {
    id?: string;
    label?: string;
    language?: string | null;
  };
  // Mirrors expo-video's own AudioTrack. Provider HLS masters usually omit the
  // LANGUAGE attribute, so `language` is frequently "" or "und" and only
  // `label` ("Turkish" / "Original Audio") identifies the rendition.
  export type AudioTrack = {
    id: string;
    label: string;
    language: string;
  };
  export type VideoPlayer = {
    currentTime: number;
    duration: number;
    timeUpdateEventInterval: number;
    audioTrack: AudioTrack | null;
    readonly availableAudioTracks: AudioTrack[];
    play(): void;
    pause(): void;
    addListener(event: string, listener: (ev: any) => void): { remove(): void };
    [key: string]: any;
  };
  export const VideoView: any;
  export function useVideoPlayer(source: any, initializer?: (player: any) => void): VideoPlayer;
}
