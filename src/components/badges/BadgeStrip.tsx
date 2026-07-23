import styled from "styled-components/native";

import type { BadgeId } from "../../constants/badges";
import { BadgeIcon } from "./BadgeArt";

const MAX_VISIBLE_BADGES = 5;
const STRIP_ICON_SIZE = 45;

const StripPressable = styled.Pressable`
  flex-direction: row;
  align-items: center;
`;

const IconWrap = styled.View`
  margin-left: -6px;
`;

const OverflowChip = styled.View`
  min-width: ${STRIP_ICON_SIZE}px;
  height: ${STRIP_ICON_SIZE}px;
  border-radius: ${STRIP_ICON_SIZE / 2}px;
  margin-left: -6px;
  padding-horizontal: 6px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
`;

const OverflowText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_600SemiBold;
  font-size: 11px;
`;

type BadgeStripProps = {
  badgeIds: BadgeId[];
  onPress: () => void;
};

export function BadgeStrip({ badgeIds, onPress }: BadgeStripProps) {
  if (badgeIds.length === 0) {
    return null;
  }

  const visible = badgeIds.slice(0, MAX_VISIBLE_BADGES);
  const overflow = badgeIds.length - visible.length;

  return (
    <StripPressable onPress={onPress} hitSlop={8}>
      {visible.map((id) => (
        <IconWrap key={id}>
          <BadgeIcon id={id} size={STRIP_ICON_SIZE} />
        </IconWrap>
      ))}
      {overflow > 0 && (
        <OverflowChip>
          <OverflowText>+{overflow}</OverflowText>
        </OverflowChip>
      )}
    </StripPressable>
  );
}
