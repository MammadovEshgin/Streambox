import { Image as ExpoImage, type ImageErrorEventData, type ImageProps } from "expo-image";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageStyle, StyleProp } from "react-native";

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

  const handleError = useCallback(
    (event: ImageErrorEventData) => {
      onError?.(event);
      const delay = getRemoteImageRetryDelay(uri, attempt, event.error);
      reportRemoteImageFailure(uri, attempt, event.error, delay === null);
      if (delay === null) return;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setRetry({ uri, attempt: attempt + 1 }), delay);
    },
    [attempt, onError, uri]
  );

  return (
    <ExpoImage
      key={attempt}
      ref={ref}
      style={style}
      source={createRemoteImageSource(uri)}
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
