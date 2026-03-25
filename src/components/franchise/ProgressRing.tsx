import { memo, useEffect, useRef } from "react";
import { Animated } from "react-native";
import Svg, { Circle } from "react-native-svg";
import styled from "styled-components/native";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const Container = styled.View`
  align-items: center;
  justify-content: center;
`;

const InnerContent = styled.View`
  position: absolute;
  align-items: center;
  justify-content: center;
`;

const CountRow = styled.View`
  flex-direction: row;
  align-items: baseline;
`;

const ProgressNumber = styled.Text<{ $size: "sm" | "md" | "lg" }>`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: ${({ $size }) => ($size === "lg" ? 20 : $size === "md" ? 16 : 14)}px;
  letter-spacing: -0.5px;
  include-font-padding: false;
`;

const PercentSign = styled.Text<{ $size: "sm" | "md" | "lg" }>`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_600SemiBold;
  font-size: ${({ $size }) => ($size === "lg" ? 11 : $size === "md" ? 9 : 8)}px;
  letter-spacing: 0.1px;
  margin-left: 1px;
`;

type ProgressRingProps = {
  progress: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  accentColor?: string;
  variant?: "sm" | "md" | "lg";
};

function ProgressRingComponent({
  progress,
  size = 80,
  strokeWidth = 4,
  accentColor,
  variant = "md",
}: ProgressRingProps) {
  const animatedProgress = useRef(new Animated.Value(0)).current;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.max(0, Math.min(1, progress));

  useEffect(() => {
    Animated.spring(animatedProgress, {
      toValue: clampedProgress,
      useNativeDriver: true,
      tension: 40,
      friction: 8,
    }).start();
  }, [clampedProgress, animatedProgress]);

  const strokeDashoffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const percentage = Math.round(clampedProgress * 100);

  return (
    <Container style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accentColor || "#E23636"}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <InnerContent>
        <CountRow>
          <ProgressNumber $size={variant}>{percentage}</ProgressNumber>
          <PercentSign $size={variant}>%</PercentSign>
        </CountRow>
      </InnerContent>
    </Container>
  );
}

export const ProgressRing = memo(ProgressRingComponent);
