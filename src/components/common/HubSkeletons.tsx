import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import styled from "styled-components/native";

const SHIMMER_DURATION_MS = 1450;

const ShimmerLayer = styled(Animated.View)`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 96px;
`;

const ShimmerGradient = styled(LinearGradient)`
  flex: 1;
`;

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
  overflow: hidden;
`;

const SkeletonLineWide = styled.View`
  width: 82%;
  height: 14px;
  margin-top: 12px;
  border-radius: 7px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  overflow: hidden;
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

const TitleSkeleton = styled.View`
  width: 112px;
  height: 14px;
  margin-top: 12px;
  border-radius: 7px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  overflow: hidden;
`;

const MetaSkeleton = styled.View`
  width: 52px;
  height: 10px;
  margin-top: 8px;
  border-radius: 5px;
  background-color: ${({ theme }) => theme.colors.glassBorder};
  overflow: hidden;
`;

function Shimmer({ travel = 320 }: { travel?: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-112, travel],
  });

  return (
    <ShimmerLayer style={{ transform: [{ translateX }, { skewX: "-14deg" }] }}>
      <ShimmerGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        colors={[
          "rgba(255,255,255,0)",
          "rgba(255,255,255,0.055)",
          "rgba(255,255,255,0.16)",
          "rgba(255,255,255,0.055)",
          "rgba(255,255,255,0)",
        ]}
        locations={[0, 0.28, 0.5, 0.72, 1]}
      />
    </ShimmerLayer>
  );
}

function SkeletonLineBlock({
  width,
  height,
  muted,
  style,
}: {
  width: number;
  height: number;
  muted?: boolean;
  style?: object;
}) {
  return (
    <SkeletonLine $width={width} $height={height} $muted={muted} style={style}>
      <Shimmer travel={width + 96} />
    </SkeletonLine>
  );
}

export function HubHeroSkeleton() {
  return (
    <HeroSkeletonRoot>
      <HeroSkeletonShade colors={["rgba(255,255,255,0.035)", "rgba(0,0,0,0.42)"]}>
        <SkeletonLineBlock width={88} height={10} />
        <SkeletonLineBlock width={210} height={28} style={{ marginTop: 12 }} />
        <SkeletonLineBlock width={112} height={12} muted style={{ marginTop: 12 }} />
        <SkeletonLineWide>
          <Shimmer travel={420} />
        </SkeletonLineWide>
        <HeroSkeletonChipRow>
          <SkeletonLineBlock width={58} height={22} muted />
          <SkeletonLineBlock width={76} height={22} muted />
          <SkeletonLineBlock width={64} height={22} muted />
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
            <Shimmer travel={240} />
          </PosterSkeleton>
          <TitleSkeleton>
            <Shimmer travel={210} />
          </TitleSkeleton>
          <MetaSkeleton>
            <Shimmer travel={150} />
          </MetaSkeleton>
        </RailSkeletonCard>
      ))}
    </RailSkeletonRoot>
  );
}
