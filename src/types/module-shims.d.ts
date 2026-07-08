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

// Watch Together native modules (runtime 1.2.0). Shimmed so `tsc` stays green
// before `npx expo install react-native-webrtc expo-camera` is run for the
// native build; the real typings replace these once installed.
declare module "react-native-webrtc" {
  export class MediaStream {
    id: string;
    getTracks(): any[];
    getVideoTracks(): any[];
    getAudioTracks(): any[];
    addTrack(track: any): void;
    removeTrack(track: any): void;
    toURL(): string;
  }
  export class RTCPeerConnection {
    constructor(config?: any);
    localDescription: any;
    remoteDescription: any;
    signalingState: string;
    connectionState: string;
    iceConnectionState: string;
    onicecandidate: ((event: any) => void) | null;
    ontrack: ((event: any) => void) | null;
    onconnectionstatechange: ((event: any) => void) | null;
    oniceconnectionstatechange: ((event: any) => void) | null;
    addTrack(track: any, ...streams: any[]): any;
    addTransceiver(trackOrKind: any, init?: any): any;
    createOffer(options?: any): Promise<any>;
    createAnswer(options?: any): Promise<any>;
    setLocalDescription(description: any): Promise<void>;
    setRemoteDescription(description: any): Promise<void>;
    addIceCandidate(candidate: any): Promise<void>;
    getSenders(): any[];
    close(): void;
  }
  export class RTCIceCandidate {
    constructor(init: any);
  }
  export class RTCSessionDescription {
    constructor(init: any);
  }
  export const mediaDevices: {
    getUserMedia(constraints: any): Promise<MediaStream>;
    enumerateDevices(): Promise<any[]>;
  };
  export const RTCView: any;
}

declare module "expo-camera" {
  export type CameraCapturedPicture = {
    uri: string;
    width: number;
    height: number;
    base64?: string;
  };
  export type CameraViewRef = {
    takePictureAsync(options?: any): Promise<CameraCapturedPicture>;
  };
  export const CameraView: any;
  export function useCameraPermissions(): [
    { granted: boolean; status: string } | null,
    () => Promise<{ granted: boolean; status: string }>
  ];
  export function useMicrophonePermissions(): [
    { granted: boolean; status: string } | null,
    () => Promise<{ granted: boolean; status: string }>
  ];
}

declare module "expo-video" {
  export type ContentType = "hls" | "dash" | "progressive" | undefined;
  export type SubtitleTrack = {
    id?: string;
    label?: string;
    language?: string | null;
  };
  export type VideoPlayer = {
    currentTime: number;
    duration: number;
    timeUpdateEventInterval: number;
    play(): void;
    pause(): void;
    addListener(event: string, listener: (ev: any) => void): { remove(): void };
    [key: string]: any;
  };
  export const VideoView: any;
  export function useVideoPlayer(source: any, initializer?: (player: any) => void): VideoPlayer;
}
