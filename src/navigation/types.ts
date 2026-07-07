import type { DiscoverCollectionSource, MediaItem, MediaType } from "../api/tmdb";
import type { NavigatorScreenParams } from "@react-navigation/native";

export type SearchResultsParams = {
  query?: string;
  filters?: {
    mediaType: string;
    genreIds: number[];
    yearFrom: string;
    yearTo: string;
    ratingMin: number | null;
    sortBy: string;
  };
};

export type HomeStackParamList = {
  HomeFeed: undefined;
  MoviesFeed: undefined;
  SeriesFeed: undefined;
  DiscoverGrid: {
    source?: DiscoverCollectionSource;
    title: string;
    items?: MediaItem[];
  };
  FranchiseCatalog: undefined;
  FranchiseTimeline: {
    franchiseId: string;
    franchiseTitle: string;
    accentColor?: string;
  };
  SearchResults: SearchResultsParams;
  MovieDetail: {
    movieId: string;
  };
  SeriesDetail: {
    seriesId: string;
  };
  ActorDetail: {
    actorId: string;
  };
  Player: {
    mediaType: MediaType,
    tmdbId: string,
    title: string,
    originalTitle?: string,
    imdbId?: string | null,
    seasonNumber?: number,
    episodeNumber?: number,
    castNames?: string[],
    trailerUrl?: string,
    year?: string | null;
    videoId?: string | null;
    resumeAtSeconds?: number;
  };
};

export type ProfileSeeAllSection = "watchlist" | "liked" | "watched";

export type ProfileStackParamList = {
  ProfileFeed: undefined;
  DiscoverGrid: {
    source?: DiscoverCollectionSource;
    title: string;
    items?: MediaItem[];
  };
  ProfileSeeAll: {
    section: ProfileSeeAllSection;
    filter: "movie" | "tv";
  };
  ProfileSettings: undefined;
  MovieDetail: {
    movieId: string;
  };
  SeriesDetail: {
    seriesId: string;
  };
  ActorDetail: {
    actorId: string;
  };
  Player: {
    mediaType: MediaType;
    tmdbId: string;
    title: string;
    originalTitle?: string;
    imdbId?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    castNames?: string[];
    trailerUrl?: string;
    year?: string | null;
    videoId?: string | null;
    resumeAtSeconds?: number;
  };
};

export type StatsStackParamList = {
  StatsFeed: undefined;
  DiscoverGrid: {
    source?: DiscoverCollectionSource;
    title: string;
    items?: MediaItem[];
  };
  WatchedGrid: {
    filter: "movie" | "tv";
    title?: string;
    genre?: string;
    genres?: string[];
    actorId?: number;
    actorName?: string;
    directorId?: number;
    ratingMin?: number;
    ratingMax?: number;
    decadeMin?: number;
    decadeMax?: number;
    monthTimestamp?: number;
    watchedAtMin?: number;
    watchedAtMax?: number;
    ids?: (number | string)[];
  };
  MovieDetail: {
    movieId: string;
  };
  SeriesDetail: {
    seriesId: string;
  };
  ActorDetail: {
    actorId: string;
  };
  Player: {
    mediaType: MediaType;
    tmdbId: string;
    title: string;
    originalTitle?: string;
    imdbId?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    castNames?: string[];
    trailerUrl?: string;
    year?: string | null;
    videoId?: string | null;
    resumeAtSeconds?: number;
  };
};

export type RootTabParamList = {
  Discover: NavigatorScreenParams<HomeStackParamList> | undefined;
  Movies: NavigatorScreenParams<HomeStackParamList> | undefined;
  Series: NavigatorScreenParams<HomeStackParamList> | undefined;
  Stats: NavigatorScreenParams<StatsStackParamList> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};


