import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { PlayerScreen } from "../screens/PlayerScreen";
import { FranchiseTimelineScreen } from "../screens/FranchiseTimelineScreen";
import { TVDetailScreen } from "../screens/tv/TVDetailScreen";
import { TVHomeScreen } from "../screens/tv/TVHomeScreen";
import { TVSearchScreen } from "../screens/tv/TVSearchScreen";

import type { HomeStackParamList } from "./types";

export type TVStackParamList = HomeStackParamList & {
  TVHome: undefined;
  TVSearch: {
    initialQuery?: string;
  } | undefined;
  TVDetail: {
    mediaType: "movie" | "tv";
    id: string;
  };
};

const Stack = createNativeStackNavigator<TVStackParamList>();

export function TVNavigation() {
  return (
    <Stack.Navigator
      initialRouteName="TVHome"
      screenOptions={{
        headerShown: false,
        animation: "fade",
        contentStyle: { backgroundColor: "#0D100F" },
      }}
    >
      <Stack.Screen name="TVHome" component={TVHomeScreen} />
      <Stack.Screen name="TVSearch" component={TVSearchScreen} />
      <Stack.Screen name="TVDetail" component={TVDetailScreen} />
      <Stack.Screen name="FranchiseTimeline" component={FranchiseTimelineScreen} />
      <Stack.Screen name="Player" component={PlayerScreen} />
    </Stack.Navigator>
  );
}
