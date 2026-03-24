import { memo, useMemo } from "react";
import Svg, { Path, Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";

export type NodeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  isLeft: boolean;
};

type TimelinePathProps = {
  nodeRects: NodeRect[];
  width: number;
  height: number;
  accentColor: string;
  watchedSet: Set<number>;
  /** Current scroll offset for viewport-based culling */
  scrollY?: number;
  /** Visible viewport height for culling */
  viewportHeight?: number;
};

/** Vertical buffer above/below viewport to pre-render path segments */
const CULL_BUFFER = 600;

/**
 * Renders smooth S-curved bezier paths between alternating left/right timeline nodes.
 * Only renders segments near the viewport to prevent crashes from oversized SVGs.
 */
function TimelinePathComponent({
  nodeRects,
  width,
  height,
  accentColor,
  watchedSet,
  scrollY = 0,
  viewportHeight = 900,
}: TimelinePathProps) {
  const { segments, dots } = useMemo(() => {
    if (nodeRects.length === 0) return { segments: [], dots: [] };

    const cullTop = scrollY - CULL_BUFFER;
    const cullBottom = scrollY + viewportHeight + CULL_BUFFER;

    const allDots: Array<{ x: number; y: number; index: number }> = [];
    const allSegments: Array<{ d: string; index: number }> = [];

    for (let i = 0; i < nodeRects.length; i++) {
      const rect = nodeRects[i];
      const cy = rect.top + rect.height / 2;
      const cx = rect.isLeft
        ? rect.left + rect.width / 2
        : rect.left + rect.width / 2;

      // Only add dots within extended viewport
      if (cy >= cullTop && cy <= cullBottom) {
        allDots.push({ x: cx, y: cy, index: i });
      }

      if (i === 0) continue;

      const prev = nodeRects[i - 1];
      const prevCy = prev.top + prev.height / 2;
      const prevCx = prev.isLeft
        ? prev.left + prev.width / 2
        : prev.left + prev.width / 2;

      // Skip segments entirely outside viewport
      const segTop = Math.min(prevCy, cy);
      const segBottom = Math.max(prevCy, cy);
      if (segBottom < cullTop || segTop > cullBottom) continue;

      // Build a smooth S-curve between prev node and current node
      const midY = (prevCy + cy) / 2;

      // Control points create a smooth S-curve
      const d = [
        `M ${prevCx} ${prevCy}`,
        `C ${prevCx} ${midY}, ${cx} ${midY}, ${cx} ${cy}`,
      ].join(" ");

      allSegments.push({ d, index: i });
    }

    return { segments: allSegments, dots: allDots };
  }, [nodeRects, scrollY, viewportHeight]);

  if (nodeRects.length === 0) return null;

  // Compute tight bounding box for visible content
  const allVisibleY = [
    ...dots.map((d) => d.y),
    ...segments.flatMap((s) => {
      const rect = nodeRects[s.index];
      const prev = nodeRects[s.index - 1];
      return [rect.top + rect.height / 2, prev.top + prev.height / 2];
    }),
  ];

  const svgTop = allVisibleY.length > 0
    ? Math.max(0, Math.min(...allVisibleY) - 40)
    : 0;
  const svgBottom = allVisibleY.length > 0
    ? Math.min(height, Math.max(...allVisibleY) + 40)
    : height;
  const svgHeight = Math.max(1, svgBottom - svgTop);

  return (
    <Svg
      width={width}
      height={svgHeight}
      style={{ position: "absolute", top: svgTop, left: 0 }}
      viewBox={`0 ${svgTop} ${width} ${svgHeight}`}
    >
      <Defs>
        <SvgLinearGradient id="curvePathGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accentColor} stopOpacity="0.5" />
          <Stop offset="0.5" stopColor={accentColor} stopOpacity="0.3" />
          <Stop offset="1" stopColor={accentColor} stopOpacity="0.12" />
        </SvgLinearGradient>
        <SvgLinearGradient id="curvePathGlow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={accentColor} stopOpacity="0.15" />
          <Stop offset="1" stopColor={accentColor} stopOpacity="0.04" />
        </SvgLinearGradient>
      </Defs>

      {/* Glow layer behind the main path */}
      {segments.map(({ d, index }) => (
        <Path
          key={`glow-${index}`}
          d={d}
          stroke="url(#curvePathGlow)"
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
        />
      ))}

      {/* Main curved dashed path */}
      {segments.map(({ d, index }) => (
        <Path
          key={`path-${index}`}
          d={d}
          stroke="url(#curvePathGrad)"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="6, 10"
        />
      ))}

      {/* Dots at each node */}
      {dots.map(({ x, y, index }) => {
        const isWatched = watchedSet.has(index);
        return (
          <Circle
            key={`dot-${index}`}
            cx={x}
            cy={y}
            r={isWatched ? 6 : 4}
            fill={isWatched ? accentColor : "rgba(255, 255, 255, 0.1)"}
            stroke={isWatched ? accentColor : "rgba(255, 255, 255, 0.2)"}
            strokeWidth={isWatched ? 2 : 1}
          />
        );
      })}
    </Svg>
  );
}

export const TimelinePath = memo(TimelinePathComponent);
