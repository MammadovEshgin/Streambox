import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableWithoutFeedback,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import { AUTH_EMAIL_OTP_LENGTH, sanitizeAuthEmailOtp } from "../../services/authConfig";
import { verifyOtp } from "../../services/auth";

type OtpVerificationScreenProps = {
  email: string;
  onVerified: () => void;
  onBack: () => void;
};

const OTP_LENGTH = AUTH_EMAIL_OTP_LENGTH;

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Backdrop = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const Glow = styled.View<{ $size: number; $top?: number; $left?: number; $opacity?: number }>`
  position: absolute;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  background-color: ${({ theme }) => theme.colors.primary};
  top: ${({ $top = 0 }) => $top}px;
  left: ${({ $left = 0 }) => $left}px;
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
`;

const EmailHighlight = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: 600;
`;

const OtpRow = styled.View`
  flex-direction: row;
  justify-content: center;
  gap: 8px;
  margin-top: 32px;
  margin-bottom: 8px;
`;

const OtpCell = styled.View<{ $focused: boolean; $filled: boolean; $error: boolean }>`
  width: 38px;
  height: 48px;
  border-radius: 10px;
  border-width: 1.5px;
  border-color: ${({ $error, $focused, $filled, theme }) =>
    $error
      ? "#E5484D"
      : $focused
        ? theme.colors.primary
        : $filled
          ? theme.colors.primaryMuted
          : theme.colors.border};
  background-color: ${({ $focused, theme }) =>
    $focused ? theme.colors.primarySoft : theme.colors.surface};
  align-items: center;
  justify-content: center;
`;

const OtpDigit = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 700;
`;

const HiddenInput = styled(TextInput)`
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
`;

const ErrorText = styled.Text`
  color: #E5484D;
  font-size: 13px;
  text-align: center;
  margin-top: 8px;
`;

const VerifyButton = styled.Pressable<{ $disabled: boolean }>`
  margin-top: 28px;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.primary};
  opacity: ${({ $disabled }) => ($disabled ? 0.35 : 1)};
`;

const VerifyLabel = styled.Text`
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
`;

const ResendRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  gap: 4px;
`;

const ResendText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const ResendLink = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 600;
`;

export function OtpVerificationScreen({ email, onVerified, onBack }: OtpVerificationScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [otp, setOtp] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleChange = (text: string) => {
    const cleaned = sanitizeAuthEmailOtp(text);
    setOtp(cleaned);
    setFocusIndex(cleaned.length);
    setError("");
  };

  const handleVerify = useCallback(async () => {
    if (otp.length !== OTP_LENGTH) {
      setError(t("auth.enterFullOtp"));
      return;
    }

    Keyboard.dismiss();
    setIsVerifying(true);
    setError("");

    try {
      await verifyOtp(email, otp);
      onVerified();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("auth.verificationFailed");
      setError(msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("token")
        ? t("auth.wrongVerificationCode")
        : msg);
      setOtp("");
      setFocusIndex(0);
    } finally {
      setIsVerifying(false);
    }
  }, [email, onVerified, otp, t]);

  return (
    <Root>
      <Backdrop colors={["#0A0806", "#060504", "#000000"]} locations={[0, 0.5, 1]} />
      <Glow $size={160} $top={150} $left={-60} $opacity={0.07} />

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
                <Feather name="mail" size={28} color={theme.colors.primary} />
              </IconCircle>

              <Title>{t("auth.verifyEmailTitle")}</Title>
              <Subtitle>
                {t("auth.verifyEmailDescription")}{"\n"}
                <EmailHighlight>{email}</EmailHighlight>
              </Subtitle>

              <OtpRow>
                {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                  <OtpCell
                    key={i}
                    $focused={focusIndex === i}
                    $filled={!!otp[i]}
                    $error={!!error}
                    onTouchEnd={() => inputRef.current?.focus()}
                  >
                    <OtpDigit>{otp[i] ?? ""}</OtpDigit>
                  </OtpCell>
                ))}
              </OtpRow>

              <HiddenInput
                ref={inputRef}
                value={otp}
                onChangeText={handleChange}
                maxLength={OTP_LENGTH}
                keyboardType="number-pad"
                autoFocus
                autoComplete="one-time-code"
              />

              {error ? <ErrorText>{error}</ErrorText> : null}

              <VerifyButton
                $disabled={otp.length !== OTP_LENGTH || isVerifying}
                disabled={otp.length !== OTP_LENGTH || isVerifying}
                onPress={() => void handleVerify()}
              >
                {isVerifying ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <VerifyLabel>{t("auth.verifyContinue")}</VerifyLabel>
                )}
              </VerifyButton>

              <ResendRow>
                <ResendText>{t("auth.didNotReceiveCode")}</ResendText>
                <ResendLink>{t("auth.checkSpamFolder")}</ResendLink>
              </ResendRow>
            </Animated.View>
          </Inner>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Root>
  );
}
