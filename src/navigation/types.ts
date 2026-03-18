import type { DiscoverCollectionSource, MediaType } from "../api/tmdb";
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
    source: DiscoverCollectionSource;
    title: string;
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
  AzClassicDetail: {
    movieId: string;
  };
  Player: {
    mediaType: MediaType,
    tmdbId: string,
    title: string,
    imdbId?: string | null,
    seasonNumber?: number,
    episodeNumber?: number,
    castNames?: string[],
    trailerUrl?: string,
    year?: string | null;
    videoId?: string | null;
    isAzClassic?: boolean;
  };
};

export type ProfileSeeAllSection = "watchlist" | "liked" | "watched";

export type ProfileStackParamList = {
  ProfileFeed: undefined;
  ProfileSeeAll: {
    section: ProfileSeeAllSection;
    filter: "movie" | "tv";
  };
  ProfileSettings: undefined;
  AzClassicDetail: {
    movieId: string;
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
    imdbId?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    castNames?: string[];
    trailerUrl?: string;
    year?: string | null;
    videoId?: string | null;
    isAzClassic?: boolean;
  };
};

export type StatsStackParamList = {
  StatsFeed: undefined;
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
  AzClassicDetail: {
    movieId: string;
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
    imdbId?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    castNames?: string[];
    trailerUrl?: string;
    year?: string | null;
    videoId?: string | null;
    isAzClassic?: boolean;
  };
};

export type RootTabParamList = {
  Discover: NavigatorScreenParams<HomeStackParamList> | undefined;
  Movies: NavigatorScreenParams<HomeStackParamList> | undefined;
  Series: NavigatorScreenParams<HomeStackParamList> | undefined;
  Stats: NavigatorScreenParams<StatsStackParamList> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};


