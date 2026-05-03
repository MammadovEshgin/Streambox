import { memo, useMemo } from "react";
import styled from "styled-components/native";

type FranchiseCollectionArtworkProps = {
  title: string;
  accentColor?: string | null;
  compact?: boolean;
};

const ArtworkFrame = styled.View<{ $backgroundTint: string }>`
  flex: 1;
  overflow: hidden;
  background-color: ${({ $backgroundTint }) => $backgroundTint};
  justify-content: space-between;
  padding: 14px;
`;

const AccentOrb = styled.View<{ $accentColor: string; $size: number; $top: number; $right: number; $opacity: number }>`
  position: absolute;
  width: ${({ $size }) => `${$size}px`};
  height: ${({ $size }) => `${$size}px`};
  border-radius: ${({ $size }) => `${$size / 2}px`};
  top: ${({ $top }) => `${$top}px`};
  right: ${({ $right }) => `${$right}px`};
  background-color: ${({ $accentColor }) => $accentColor};
  opacity: ${({ $opacity }) => $opacity};
`;

const GridLine = styled.View<{ $top: string; $left: string; $width: string; $opacity: number }>`
  position: absolute;
  top: ${({ $top }) => $top};
  left: ${({ $left }) => $left};
  width: ${({ $width }) => $width};
  height: 1px;
  background-color: rgba(255, 255, 255, ${({ $opacity }) => $opacity});
`;

const MonogramWrap = styled.View`
  align-self: flex-start;
  padding: 6px 10px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.08);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.1);
`;

const Monogram = styled.Text<{ $compact: boolean }>`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: ${({ $compact }) => ($compact ? "18px" : "20px")};
  letter-spacing: 1.8px;
  text-transform: uppercase;
`;

const Footer = styled.View`
  gap: 6px;
`;

const Kicker = styled.Text<{ $compact: boolean }>`
  color: rgba(255, 255, 255, 0.74);
  font-family: Outfit_500Medium;
  font-size: ${({ $compact }) => ($compact ? "10px" : "11px")};
  letter-spacing: 1.4px;
  text-transform: uppercase;
`;

const Title = styled.Text<{ $compact: boolean }>`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: ${({ $compact }) => ($compact ? "16px" : "18px")};
  line-height: ${({ $compact }) => ($compact ? "20px" : "22px")};
  letter-spacing: -0.4px;
`;

function hexToRgb(hex: string) {
  const sanitized = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(sanitized)) {
    return null;
  }

  return {
    r: Number.parseInt(sanitized.slice(0, 2), 16),
    g: Number.parseInt(sanitized.slice(2, 4), 16),
    b: Number.parseInt(sanitized.slice(4, 6), 16),
  };
}

function createTintColor(accentColor?: string | null) {
  const parsed = accentColor ? hexToRgb(accentColor) : null;
  if (!parsed) {
    return "rgb(16, 18, 23)";
  }

  const mix = (channel: number, base: number, weight: number) =>
    Math.round(channel * weight + base * (1 - weight));

  return `rgb(${mix(parsed.r, 12, 0.18)}, ${mix(parsed.g, 15, 0.18)}, ${mix(parsed.b, 20, 0.18)})`;
}

function buildMonogram(title: string) {
  const words = title
    .replace(/\s+collection$/i, "")
    .split(/[\s:&\-]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "SB";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function FranchiseCollectionArtworkComponent({
  title,
  accentColor,
  compact = false,
}: FranchiseCollectionArtworkProps) {
  const backgroundTint = useMemo(() => createTintColor(accentColor), [accentColor]);
  const monogram = useMemo(() => buildMonogram(title), [title]);

  return (
    <ArtworkFrame $backgroundTint={backgroundTint}>
      <AccentOrb $accentColor={accentColor ?? "#22C55E"} $size={compact ? 86 : 102} $top={-18} $right={-24} $opacity={0.22} />
      <AccentOrb $accentColor={accentColor ?? "#22C55E"} $size={compact ? 56 : 68} $top={compact ? 74 : 88} $right={compact ? 18 : 20} $opacity={0.13} />
      <GridLine $top="22%" $left="-8%" $width="68%" $opacity={0.08} />
      <GridLine $top="72%" $left="34%" $width="74%" $opacity={0.08} />

      <MonogramWrap>
        <Monogram $compact={compact}>{monogram}</Monogram>
      </MonogramWrap>

      <Footer>
        <Kicker $compact={compact}>StreamBox Collection</Kicker>
        <Title numberOfLines={2} $compact={compact}>
          {title.replace(/\s+Collection$/i, "")}
        </Title>
      </Footer>
    </ArtworkFrame>
  );
}

export const FranchiseCollectionArtwork = memo(FranchiseCollectionArtworkComponent);
