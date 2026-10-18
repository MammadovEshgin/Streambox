import { Image as ExpoImage, type ImageErrorEventData, type ImageProps } from "expo-image";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageStyle, StyleProp } from "react-native";

import { alternateTmdbImageUrl, toProxiedTmdbImageUrl } from "../../api/tmdbImageHost";
import {
  createRemoteImageSource,
  getRemoteImageRetryDelay,
  normalizeRemoteImageCacheKey,
  reportRemoteImageFailure,
} from "../../services/remoteImageCache";

type CachedRemoteImageProps = Omit<ImageProps, "source" | "style"> & {
  uri: string;
  style?: StyleProp<ImageStyle>;
  cacheKey?: string;
};

export const CachedRemoteImage = forwardRef<ExpoImage, CachedRemoteImageProps>(function CachedRemoteImage(
  {
    uri,
    cacheKey,
    transition = 120,
    cachePolicy = "disk",
    allowDownscaling = true,
    recyclingKey,
    onError,
    onLoad,
    style,
    ...rest
  },
  ref
) {
  const resolvedCacheKey = useMemo(
    () => cacheKey ?? normalizeRemoteImageCacheKey(uri),
    [cacheKey, uri]
  );

  // expo-image never asks again for a source that failed: on Android the
  // failed source counts as loaded, so re-renders skip it and the poster stays
  // blank until Glide happens to restart it on a connectivity change. A failed
  // load is retried here by remounting the native view after a short wait.
  const [retry, setRetry] = useState({ uri, attempt: 0 });
  const attempt = retry.uri === uri ? retry.attempt : 0;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, [uri]);

  // A TMDB image is served by our proxy and by TMDB's own CDN; each retry asks
  // the other one, and the first switch happens at once, since a host that
  // refused one connection (see tmdbImageHost) is unlikely to take the next.
  const primaryUri = toProxiedTmdbImageUrl(uri);
  const alternateUri = alternateTmdbImageUrl(primaryUri);
  const sourceUri = attempt % 2 === 1 && alternateUri ? alternateUri : primaryUri;

  const handleError = useCallback(
    (event: ImageErrorEventData) => {
      onError?.(event);
      const backoff = getRemoteImageRetryDelay(sourceUri, attempt, event.error);
      reportRemoteImageFailure(sourceUri, attempt, event.error, backoff === null);
      if (backoff === null) return;
      const delay = attempt === 0 && alternateUri ? 0 : backoff;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setRetry({ uri, attempt: attempt + 1 }), delay);
    },
    [alternateUri, attempt, onError, sourceUri, uri]
  );

  return (
    <ExpoImage
      key={attempt}
      ref={ref}
      style={style}
      source={createRemoteImageSource(sourceUri)}
      transition={transition}
      cachePolicy={cachePolicy}
      allowDownscaling={allowDownscaling}
      recyclingKey={recyclingKey ?? resolvedCacheKey}
      onLoad={onLoad}
      onError={handleError}
      {...rest}
    />
  );
});
