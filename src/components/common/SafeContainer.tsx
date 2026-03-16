import { PropsWithChildren } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled from "styled-components/native";

const Root = styled.View<{ $topInset: number }>`
  flex: 1;
  padding-top: ${({ $topInset }) => $topInset}px;
  background-color: ${({ theme }) => theme.colors.background};
`;

type SafeContainerProps = PropsWithChildren;

export function SafeContainer({ children }: SafeContainerProps) {
  const insets = useSafeAreaInsets();
  return <Root $topInset={insets.top}>{children}</Root>;
}
