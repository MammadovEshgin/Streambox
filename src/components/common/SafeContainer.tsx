import { PropsWithChildren } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled from "styled-components/native";

const Root = styled.View<{ $topInset: number; $bottomInset: number }>`
  flex: 1;
  padding-top: ${({ $topInset }) => $topInset}px;
  padding-bottom: ${({ $bottomInset }) => $bottomInset}px;
  background-color: ${({ theme }) => theme.colors.background};
`;

type SafeContainerProps = PropsWithChildren<{
  /**
   * When true, also pads the bottom by the system inset (home-indicator on
   * notched iOS, gesture handle on Android). Opt-in to avoid regressing screens
   * that already account for the bottom area in their own layout (e.g. screens
   * with a tab bar or footer that sits below SafeContainer).
   */
  includeBottomInset?: boolean;
}>;

export function SafeContainer({ children, includeBottomInset = false }: SafeContainerProps) {
  const insets = useSafeAreaInsets();
  return (
    <Root $topInset={insets.top} $bottomInset={includeBottomInset ? insets.bottom : 0}>
      {children}
    </Root>
  );
}
