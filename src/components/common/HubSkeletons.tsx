import { LinearGradient } from "expo-linear-gradient";
import styled from "styled-components/native";

const HeroSkeletonRoot = styled.View`
  height: 280px;
  border-radius: 18px;
  overflow: hidden;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const HeroSkeletonShade = styled(LinearGradient)`
  flex: 1;
  justify-content: flex-end;
  padding: 18px;
`;

const SkeletonLine = styled.View<{ $width: number; $height: number; $muted?: boolean }>`
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
  border-radius: 6px;
  background-color: ${({ theme, $muted }) => $muted ? theme.colors.surfaceRaised : theme.colors.glassBorder};
`;

const SkeletonLineWide = styled.View`
  width: 82%;
  height: 14px;
  margin-top: 12px;
  border-radius: 7px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const HeroSkeletonChipRow = styled.View`
  flex-direction: row;
  gap: 7px;
  margin-top: 12px;
`;

const RailSkeletonRoot = styled.View`
  height: 282px;
  flex-direction: row;
`;

const RailSkeletonCard = styled.View`
  width: 132px;
  margin-right: 12px;
`;

const PosterSkeleton = styled.View`
  width: 132px;
  height: 198px;
  border-radius: 14px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  overflow: hidden;
`;

const PosterSkeletonGlow = styled(LinearGradient)`
  flex: 1;
`;

const TitleSkeleton = styled.View`
  width: 112px;
  height: 14px;
  margin-top: 12px;
  border-radius: 7px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const MetaSkeleton = styled.View`
  width: 52px;
  height: 10px;
  margin-top: 8px;
  border-radius: 5px;
  background-color: ${({ theme }) => theme.colors.glassBorder};
`;

export function HubHeroSkeleton() {
  return (
    <HeroSkeletonRoot>
      <HeroSkeletonShade colors={["rgba(255,255,255,0.035)", "rgba(0,0,0,0.42)"]}>
        <SkeletonLine $width={88} $height={10} />
        <SkeletonLine $width={210} $height={28} style={{ marginTop: 12 }} />
        <SkeletonLine $width={112} $height={12} $muted style={{ marginTop: 12 }} />
        <SkeletonLineWide />
        <HeroSkeletonChipRow>
          <SkeletonLine $width={58} $height={22} $muted />
          <SkeletonLine $width={76} $height={22} $muted />
          <SkeletonLine $width={64} $height={22} $muted />
        </HeroSkeletonChipRow>
      </HeroSkeletonShade>
    </HeroSkeletonRoot>
  );
}

export function HubRailSkeleton() {
  return (
    <RailSkeletonRoot>
      {[0, 1, 2].map((index) => (
        <RailSkeletonCard key={index}>
          <PosterSkeleton>
            <PosterSkeletonGlow colors={["rgba(255,255,255,0.055)", "rgba(255,255,255,0.015)"]} />
          </PosterSkeleton>
          <TitleSkeleton />
          <MetaSkeleton />
        </RailSkeletonCard>
      ))}
    </RailSkeletonRoot>
  );
}
