import { useEffect, useState } from "react";
import { Image } from "react-native";
import styled from "styled-components/native";

import { resolveProfileAssetUrl } from "../../api/social";

// Circular avatar that resolves a profile-assets path to a short-lived signed
// URL (cached in social.ts), falling back to the display-name initial. Used
// across the social surfaces (profiles, follow lists, activity, notifications).

const Wrap = styled.View<{ $size: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const InitialText = styled.Text<{ $size: number }>`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ $size }) => Math.round($size * 0.4)}px;
  font-weight: 700;
`;

type Props = {
  avatarPath: string | null | undefined;
  avatarVersion?: number;
  displayName?: string;
  size?: number;
};

export function SocialAvatar({ avatarPath, avatarVersion = 0, displayName, size = 44 }: Props) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!avatarPath) {
      setUri(null);
      return;
    }
    void resolveProfileAssetUrl(avatarPath, avatarVersion).then((resolved) => {
      if (!cancelled) setUri(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [avatarPath, avatarVersion]);

  const initial = (displayName ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <Wrap $size={size}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <InitialText $size={size}>{initial}</InitialText>
      )}
    </Wrap>
  );
}
