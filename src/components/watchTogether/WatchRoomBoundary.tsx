import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import styled from "styled-components/native";

type Props = {
  children: ReactNode;
  onExit: () => void;
};

type State = {
  failed: boolean;
  retryKey: number;
};

// Room-scoped containment: an invalid native stream or render regression must
// not replace the whole authenticated app. Retrying remounts the room subtree,
// so its channel/media cleanup runs before a fresh session starts.
export class WatchRoomBoundary extends Component<Props, State> {
  state: State = { failed: false, retryKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[WatchRoomBoundary] room render failed:", error, info.componentStack);
  }

  private retry = () => {
    this.setState((state) => ({ failed: false, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (!this.state.failed) {
      return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
    }

    return (
      <RecoveryOverlay accessibilityViewIsModal accessibilityRole="alert">
        <RecoveryCard>
          <RecoveryTitle>Watch Together paused</RecoveryTitle>
          <RecoveryBody>The room hit a problem. Retry or leave the player.</RecoveryBody>
          <RecoveryActions>
            <PrimaryAction onPress={this.retry} accessibilityRole="button">
              <PrimaryActionText>Retry room</PrimaryActionText>
            </PrimaryAction>
            <SecondaryAction onPress={this.props.onExit} accessibilityRole="button">
              <SecondaryActionText>Exit player</SecondaryActionText>
            </SecondaryAction>
          </RecoveryActions>
        </RecoveryCard>
      </RecoveryOverlay>
    );
  }
}

const RecoveryOverlay = styled(View)`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 40;
  elevation: 40;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgba(13, 16, 15, 0.78);
`;

const RecoveryCard = styled(View)`
  width: 100%;
  max-width: 320px;
  padding: 20px;
  border-radius: 20px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const RecoveryTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
`;

const RecoveryBody = styled(Text)`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 19px;
`;

const RecoveryActions = styled(View)`
  gap: 12px;
  margin-top: 18px;
`;

const PrimaryAction = styled(Pressable)`
  min-height: 44px;
  border-radius: 999px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const SecondaryAction = styled(Pressable)`
  min-height: 44px;
  border-radius: 999px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const PrimaryActionText = styled(Text)`
  color: ${({ theme }) => theme.colors.textOnPrimary};
  font-size: 14px;
  font-weight: 700;
`;

const SecondaryActionText = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  font-weight: 700;
`;
