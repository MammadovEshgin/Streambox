import { Image as ExpoImage, type ImageProps } from "expo-image";
import { forwardRef, useMemo } from "react";
import type { ImageStyle, StyleProp } from "react-native";

import { createRemoteImageSource, normalizeRemoteImageCacheKey } from "../../services/remoteImageCache";

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

  return (
    <ExpoImage
      ref={ref}
      style={style}
      source={createRemoteImageSource(uri)}
      transition={transition}
      cachePolicy={cachePolicy}
      allowDownscaling={allowDownscaling}
      recyclingKey={recyclingKey ?? resolvedCacheKey}
      onLoad={onLoad}
      onError={onError}
      {...rest}
    />
  );
});
