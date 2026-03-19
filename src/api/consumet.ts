import axios from "axios";

/**
 * Consumet API Wrapper for Movies & TV Series
 * Primarily using FlixHQ as the high-quality, ad-free provider.
 */

const CONSUMET_BASE_URL = process.env.EXPO_PUBLIC_CONSUMET_URL || "https://api.consumet.org";

export type ConsumetSearchResult = {
  id: string;
  title: string;
  url: string;
  image: string;
  releaseDate?: string;
  type: "Movie" | "TV Series";
};

export type ConsumetEpisode = {
  id: string;
  title: string;
  number: number;
  season: number;
};

export type ConsumetMediaInfo = {
  id: string;
  title: string;
  episodes: ConsumetEpisode[];
};

export type ConsumetSource = {
  url: string;
  isM3U8: boolean;
  quality: string;
};

export type ConsumetSubtitle = {
  url: string;
  lang: string;
};

export type ConsumetStream = {
  sources: ConsumetSource[];
  subtitles: ConsumetSubtitle[];
  headers?: Record<string, string>;
};

const client = axios.create({
  baseURL: CONSUMET_BASE_URL,
  timeout: 15000
});

export const consumetApi = {
  /**
   * Search for a movie or TV series
   */
  search: async (query: string): Promise<ConsumetSearchResult[]> => {
    try {
      const { data } = await client.get(`/movies/flixhq/${encodeURIComponent(query)}`);
      return data.results || [];
    } catch (error) {
      console.error("Consumet search error:", error);
      return [];
    }
  },

  /**
   * Get media info including episodes for TV series
   */
  getInfo: async (id: string): Promise<ConsumetMediaInfo | null> => {
    try {
      const { data } = await client.get(`/movies/flixhq/info`, {
        params: { id }
      });
      return data;
    } catch (error) {
      console.error("Consumet info error:", error);
      return null;
    }
  },

  /**
   * Get direct stream links and subtitles
   */
  getStreams: async (episodeId: string, mediaId: string): Promise<ConsumetStream | null> => {
    try {
      const { data } = await client.get(`/movies/flixhq/watch`, {
        params: {
          episodeId,
          mediaId
        }
      });
      return data;
    } catch (error) {
      console.error("Consumet stream error:", error);
      return null;
    }
  }
};
