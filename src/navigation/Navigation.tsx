import { Feather, Ionicons } from "@expo/vector-icons";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "styled-components/native";

import { ActorDetailScreen } from "../screens/ActorDetailScreen";
import { AzClassicDetailScreen } from "../screens/AzClassicDetailScreen";
import { DiscoverGridScreen } from "../screens/DiscoverGridScreen";
import { FranchiseCatalogScreen } from "../screens/FranchiseCatalogScreen";
import { FranchiseTimelineScreen } from "../screens/FranchiseTimelineScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { MovieDetailScreen } from "../screens/MovieDetailScreen";
import { MoviesScreen } from "../screens/MoviesScreen";
import { PlayerScreen } from "../screens/PlayerScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { ProfileSeeAllScreen } from "../screens/ProfileSeeAllScreen";
import { ProfileSettingsScreen } from "../screens/ProfileSettingsScreen";
import { SearchResultsScreen } from "../screens/SearchResultsScreen";
import { SeriesDetailScreen } from "../screens/SeriesDetailScreen";
import { SeriesScreen } from "../screens/SeriesScreen";
import { StatsScreen } from "../screens/StatsScreen";

import { WatchedGridScreen } from "../screens/WatchedGridScreen";
import { HomeStackParamList, ProfileStackParamList, RootTabParamList, StatsStackParamList } from "./types";

const Tab = createBottomTabNavigator<RootTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const MoviesStack = createNativeStackNavigator<HomeStackParamList>();
const SeriesStack = createNativeStackNavigator<HomeStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const StatsStack = createNativeStackNavigator<StatsStackParamList>();

function HomeStackScreen() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeFeed" component={HomeScreen} />
      <HomeStack.Screen name="DiscoverGrid" component={DiscoverGridScreen} />
      <HomeStack.Screen name="FranchiseCatalog" component={FranchiseCatalogScreen} />
      <HomeStack.Screen name="FranchiseTimeline" component={FranchiseTimelineScreen} />
      <HomeStack.Screen name="SearchResults" component={SearchResultsScreen} />
      <HomeStack.Screen name="MovieDetail" component={MovieDetailScreen} />
      <HomeStack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
      <HomeStack.Screen name="AzClassicDetail" component={AzClassicDetailScreen} />
      <HomeStack.Screen name="ActorDetail" component={ActorDetailScreen} />
      <HomeStack.Screen name="Player" component={PlayerScreen} />
    </HomeStack.Navigator>
  );
}

function MoviesStackScreen() {
  return (
    <MoviesStack.Navigator screenOptions={{ headerShown: false }}>
      <MoviesStack.Screen name="MoviesFeed" component={MoviesScreen} />
      <MoviesStack.Screen name="DiscoverGrid" component={DiscoverGridScreen} />
      <MoviesStack.Screen name="FranchiseCatalog" component={FranchiseCatalogScreen} />
      <MoviesStack.Screen name="FranchiseTimeline" component={FranchiseTimelineScreen} />
      <MoviesStack.Screen name="SearchResults" component={SearchResultsScreen} />
      <MoviesStack.Screen name="MovieDetail" component={MovieDetailScreen} />
      <MoviesStack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
      <MoviesStack.Screen name="AzClassicDetail" component={AzClassicDetailScreen} />
      <MoviesStack.Screen name="ActorDetail" component={ActorDetailScreen} />
      <MoviesStack.Screen name="Player" component={PlayerScreen} />
    </MoviesStack.Navigator>
  );
}

function SeriesStackScreen() {
  return (
    <SeriesStack.Navigator screenOptions={{ headerShown: false }}>
      <SeriesStack.Screen name="SeriesFeed" component={SeriesScreen} />
      <SeriesStack.Screen name="DiscoverGrid" component={DiscoverGridScreen} />
      <SeriesStack.Screen name="SearchResults" component={SearchResultsScreen} />
      <SeriesStack.Screen name="MovieDetail" component={MovieDetailScreen} />
      <SeriesStack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
      <SeriesStack.Screen name="ActorDetail" component={ActorDetailScreen} />
      <SeriesStack.Screen name="Player" component={PlayerScreen} />
    </SeriesStack.Navigator>
  );
}

function ProfileStackScreen() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileFeed" component={ProfileScreen} />
      <ProfileStack.Screen name="ProfileSeeAll" component={ProfileSeeAllScreen} />
      <ProfileStack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
      <ProfileStack.Screen name="AzClassicDetail" component={AzClassicDetailScreen} />
      <ProfileStack.Screen name="MovieDetail" component={MovieDetailScreen} />
      <ProfileStack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
      <ProfileStack.Screen name="ActorDetail" component={ActorDetailScreen} />
      <ProfileStack.Screen name="Player" component={PlayerScreen} />
    </ProfileStack.Navigator>
  );
}

function StatsStackScreen() {
  return (
    <StatsStack.Navigator screenOptions={{ headerShown: false }}>
      <StatsStack.Screen name="StatsFeed" component={StatsScreen} />
      <StatsStack.Screen name="WatchedGrid" component={WatchedGridScreen} />
      <StatsStack.Screen name="AzClassicDetail" component={AzClassicDetailScreen} />
      <StatsStack.Screen name="MovieDetail" component={MovieDetailScreen} />
      <StatsStack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
      <StatsStack.Screen name="ActorDetail" component={ActorDetailScreen} />
      <StatsStack.Screen name="Player" component={PlayerScreen} />
    </StatsStack.Navigator>
  );
}

const DETAIL_ROUTES = new Set(["MovieDetail", "SeriesDetail", "AzClassicDetail", "ActorDetail", "Player", "SearchResults", "ProfileSeeAll", "FranchiseCatalog", "FranchiseTimeline"]);
const STACK_TABS = new Set<keyof RootTabParamList>(["Discover", "Movies", "Series", "Stats", "Profile"]);

export function Navigation() {
  const currentTheme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarStyle: {
          ...(STACK_TABS.has(route.name) &&
          DETAIL_ROUTES.has(getFocusedRouteNameFromRoute(route) ?? "")
              ? { display: "none" }
            : {
                height: 64,
                paddingTop: 8,
                paddingBottom: 8,
                borderTopWidth: 0,
                elevation: 0,
                backgroundColor: currentTheme.colors.background
              })
        },
        headerShown: false,
        freezeOnBlur: true,
        tabBarActiveTintColor: currentTheme.colors.primary,
        tabBarInactiveTintColor: currentTheme.colors.textSecondary,
        tabBarLabelStyle: {
          fontFamily: currentTheme.typography.MetaSmall.fontFamily,
          fontSize: currentTheme.typography.MetaSmall.fontSize,
          lineHeight: currentTheme.typography.MetaSmall.lineHeight,
          letterSpacing: 0.2
        },
        tabBarIcon: ({ color, focused }) => {
          const ioniconsMap: Partial<Record<keyof RootTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]>> = {
            Movies: ["film-outline", "film"],
            Series: ["tv-outline", "tv"]
          };

          const ionicon = ioniconsMap[route.name];
          if (ionicon) {
            return <Ionicons name={focused ? ionicon[1] : ionicon[0]} size={22} color={color} />;
          }

          const featherMap: Record<string, keyof typeof Feather.glyphMap> = {
            Discover: "compass",
            Stats: "bar-chart-2",
            Profile: "user"
          };

          return <Feather name={featherMap[route.name]} size={20} color={color} />;
        },
        sceneStyle: {
          backgroundColor: currentTheme.colors.background
        }
      })}
    >
      <Tab.Screen name="Discover" component={HomeStackScreen} />
      <Tab.Screen name="Movies" component={MoviesStackScreen} />
      <Tab.Screen name="Series" component={SeriesStackScreen} />
      <Tab.Screen name="Stats" component={StatsStackScreen} />
      <Tab.Screen name="Profile" component={ProfileStackScreen} />
    </Tab.Navigator>
  );
}






