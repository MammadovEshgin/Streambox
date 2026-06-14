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
  export const VideoView: any;
  export function useVideoPlayer(source: any, initializer?: (player: any) => void): any;
}
