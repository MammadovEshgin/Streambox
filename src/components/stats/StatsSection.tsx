import type { ReactNode } from "react";
import styled from "styled-components/native";

import { withAlpha } from "../../theme/Theme";

type StatsSectionProps = {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  /** Optional accent glow behind top-right corner */
  accentGlow?: boolean;
};

const SectionWrap = styled.View<{ $flush?: boolean }>`
  padding-horizontal: ${({ $flush }) => ($flush ? 0 : 16)}px;
`;

const Surface = styled.View`
  position: relative;
  overflow: hidden;
  background-color: ${({ theme }) => withAlpha(theme.colors.surfaceRaised, 0.94)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.08)};
  padding: 20px;
`;

/** Soft ambient glow in the top-right of a section card */
const AmbientGlow = styled.View`
  position: absolute;
  top: -40px;
  right: -40px;
  width: 120px;
  height: 120px;
  border-radius: 60px;
  background-color: ${({ theme }) => theme.colors.primary};
  opacity: 0.04;
`;

const Header = styled.View`
  width: 100%;
  align-items: flex-start;
  justify-content: flex-start;
`;

const HeaderCopy = styled.View`
  width: 100%;
  align-items: flex-start;
  justify-content: flex-start;
`;

const ActionRow = styled.View`
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  margin-top: 14px;
`;

export const SectionTitle = styled.Text`
  font-family: Outfit_700Bold;
  font-size: 17px;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.2px;
  text-align: left;
`;

const SectionSubtitle = styled.Text`
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.44)};
  margin-top: 4px;
  text-align: left;
`;

const SectionDivider = styled.View`
  height: 1px;
  background-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.06)};
  margin-vertical: 16px;
`;

const SectionBody = styled.View``;

export const SectionGrid = styled.View<{ $gap?: number }>`
  flex-direction: row;
  align-items: stretch;
  gap: ${({ $gap }) => $gap ?? 10}px;
`;

export const MiniPanel = styled.View`
  flex: 1;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.32)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  padding: 14px;
`;

export const PillRow = styled.View`
  flex-direction: row;
  gap: 8px;
`;

export const FilterChip = styled.Pressable<{ $active: boolean }>`
  min-height: 32px;
  padding: 7px 14px;
  border-radius: 3px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $active, theme }) =>
    $active ? withAlpha(theme.colors.primary, 0.32) : withAlpha(theme.colors.textPrimary, 0.06)};
  background-color: ${({ $active, theme }) =>
    $active ? withAlpha(theme.colors.primary, 0.14) : "transparent"};
`;

export const FilterLabel = styled.Text<{ $active: boolean }>`
  font-family: Outfit_700Bold;
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: ${({ $active, theme }) => ($active ? theme.colors.textPrimary : withAlpha(theme.colors.textPrimary, 0.45))};
`;

export const DataRow = styled.View`
  flex-direction: row;
  align-items: center;
  min-height: 44px;
`;

export const RankPill = styled.View`
  min-width: 20px;
  align-items: flex-start;
  justify-content: center;
  margin-right: 10px;
`;

export const RankText = styled.Text`
  font-family: Outfit_700Bold;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.primary};
`;

export const DataLabel = styled.Text`
  font-family: Outfit_600SemiBold;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

export const DataMeta = styled.Text`
  font-family: Outfit_400Regular;
  font-size: 11px;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.44)};
  margin-top: 2px;
`;

export const EmptyText = styled.Text`
  font-family: Outfit_400Regular;
  font-size: 13px;
  line-height: 19px;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.44)};
  text-align: left;
`;

export function StatsSection({ title, subtitle, action, children, flush, accentGlow }: StatsSectionProps) {
  const hasHeader = Boolean(title || subtitle || action);

  return (
    <SectionWrap $flush={flush}>
      <Surface>
        {accentGlow ? <AmbientGlow /> : null}
        {hasHeader ? (
          <>
            <Header>
              {title || subtitle ? (
                <HeaderCopy>
                  {title ? <SectionTitle>{title}</SectionTitle> : null}
                  {subtitle ? <SectionSubtitle>{subtitle}</SectionSubtitle> : null}
                </HeaderCopy>
              ) : null}
              {action ? <ActionRow>{action}</ActionRow> : null}
            </Header>
            <SectionDivider />
          </>
        ) : null}
        <SectionBody>{children}</SectionBody>
      </Surface>
    </SectionWrap>
  );
}
