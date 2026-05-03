import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import { isValidEmail, requestPasswordReset } from "../../services/auth";

type ForgotPasswordScreenProps = {
  onCodeSent: (email: string) => void;
  onBack: () => void;
};

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Backdrop = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const Glow = styled.View<{ $size: number; $top?: number; $right?: number; $opacity?: number }>`
  position: absolute;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  background-color: ${({ theme }) => theme.colors.primary};
  top: ${({ $top = 0 }) => $top}px;
  right: ${({ $right = 0 }) => $right}px;
  opacity: ${({ $opacity = 0.06 }) => $opacity};
`;

const Inner = styled.View<{ $top: number; $bottom: number }>`
  flex: 1;
  padding: ${({ $top }) => $top + 20}px 24px ${({ $bottom }) => $bottom + 24}px;
  justify-content: center;
`;

const BackButton = styled.Pressable`
  position: absolute;
  top: 0;
  left: 0;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
`;

const IconCircle = styled.View`
  width: 64px;
  height: 64px;
  border-radius: 32px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primarySoftStrong};
  align-self: center;
  margin-bottom: 24px;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  text-align: center;
`;

const Subtitle = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  padding-horizontal: 12px;
`;

const InputWrap = styled.View<{ $error?: boolean }>`
  flex-direction: row;
  align-items: center;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ $error, theme }) =>
    $error ? "#E5484D" : theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 0 14px;
  margin-top: 28px;
`;

const StyledInput = styled.TextInput`
  flex: 1;
  padding: 14px 0;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
`;

const ErrorText = styled.Text`
  color: #E5484D;
  font-size: 12px;
  margin-top: 8px;
`;

const SendButton = styled.Pressable<{ $disabled: boolean }>`
  margin-top: 20px;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.primary};
  opacity: ${({ $disabled }) => ($disabled ? 0.35 : 1)};
`;

const SendLabel = styled.Text`
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
`;

const BackToLogin = styled.Pressable`
  margin-top: 20px;
  align-self: center;
  padding: 6px;
`;

const BackToLoginText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const BackToLoginLink = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: 600;
`;

export function ForgotPasswordScreen({ onCodeSent, onBack }: ForgotPasswordScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const emailRateLimitMessage = "too many email requests were sent recently";

  const handleSend = useCallback(async () => {
    setError("");
    if (!email.trim()) {
      setError(t("auth.emailRequired"));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t("auth.invalidEmail"));
      return;
    }

    Keyboard.dismiss();
    setIsSending(true);

    try {
      await requestPasswordReset(email);
      onCodeSent(email.trim().toLowerCase());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("auth.sendResetFailed");
      setError(
        message.toLowerCase().includes(emailRateLimitMessage)
          ? t("auth.emailRateLimited")
          : message
      );
    } finally {
      setIsSending(false);
    }
  }, [email, emailRateLimitMessage, onCodeSent, t]);

  return (
    <Root>
      <Backdrop colors={["#0A0806", "#060504", "#000000"]} locations={[0, 0.5, 1]} />
      <Glow $size={180} $top={120} $right={-70} $opacity={0.06} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <Inner $top={insets.top} $bottom={insets.bottom}>
            <BackButton onPress={onBack} style={{ top: insets.top + 12, left: 16 }}>
              <Feather name="arrow-left" size={22} color={theme.colors.textPrimary} />
            </BackButton>

            <Animated.View entering={FadeInDown.duration(400)}>
              <IconCircle>
                <Feather name="key" size={28} color={theme.colors.primary} />
              </IconCircle>

              <Title>{t("auth.resetPasswordTitle")}</Title>
              <Subtitle>
                {t("auth.resetPasswordDescription")}
              </Subtitle>

              <InputWrap $error={!!error}>
                <Feather
                  name="mail"
                  size={16}
                  color={error ? "#E5484D" : theme.colors.textSecondary}
                  style={{ marginRight: 10 }}
                />
                <StyledInput
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    if (error) setError("");
                  }}
                  placeholder={t("auth.emailPlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  returnKeyType="done"
                  onSubmitEditing={() => void handleSend()}
                />
              </InputWrap>
              {error ? <ErrorText>{error}</ErrorText> : null}

              <SendButton
                $disabled={isSending || !email.trim()}
                disabled={isSending || !email.trim()}
                onPress={() => void handleSend()}
              >
                {isSending ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <SendLabel>{t("auth.sendResetCode")}</SendLabel>
                )}
              </SendButton>

              <BackToLogin onPress={onBack}>
                <BackToLoginText>
                  {t("auth.rememberPassword")} <BackToLoginLink>{t("auth.signIn")}</BackToLoginLink>
                </BackToLoginText>
              </BackToLogin>
            </Animated.View>
          </Inner>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Root>
  );
}
