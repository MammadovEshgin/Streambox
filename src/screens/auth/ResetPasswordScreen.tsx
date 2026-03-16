import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  TouchableWithoutFeedback,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import {
  signOut,
  updatePassword,
  validatePassword,
  verifyPasswordResetOtp,
} from "../../services/auth";

type ResetPasswordScreenProps = {
  email: string;
  onResetComplete: () => void;
  onBack: () => void;
};

const OTP_LENGTH = 8;

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

const ScrollContent = styled.ScrollView.attrs({
  showsVerticalScrollIndicator: false,
  keyboardShouldPersistTaps: "handled",
})`
  flex: 1;
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

const FormCard = styled.View`
  margin-top: 28px;
  border-radius: 16px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 20px;
`;

const FieldLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  margin-bottom: 8px;
`;

const InputWrap = styled.View<{ $error?: boolean }>`
  flex-direction: row;
  align-items: center;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ $error, theme }) =>
    $error ? "#E5484D" : theme.colors.border};
  background-color: ${({ theme }) => theme.colors.background};
  padding: 0 14px;
  margin-bottom: 16px;
`;

const StyledInput = styled(TextInput)`
  flex: 1;
  padding: 14px 0;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
`;

const ErrorText = styled.Text`
  color: #E5484D;
  font-size: 12px;
  margin-top: -10px;
  margin-bottom: 12px;
`;

const PasswordRulesList = styled.View`
  margin-top: -8px;
  margin-bottom: 12px;
`;

const PasswordRule = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
`;

const PasswordRuleText = styled.Text<{ $met: boolean }>`
  color: ${({ $met, theme }) => ($met ? theme.colors.primary : theme.colors.textSecondary)};
  font-size: 11px;
`;

const SubmitButton = styled.Pressable<{ $disabled: boolean }>`
  margin-top: 4px;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.primary};
  opacity: ${({ $disabled }) => ($disabled ? 0.35 : 1)};
`;

const SubmitLabel = styled.Text`
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
`;

const GeneralError = styled.Text`
  color: #E5484D;
  font-size: 13px;
  text-align: center;
  margin-top: 12px;
`;

const SuccessWrap = styled(Animated.View)`
  align-items: center;
  justify-content: center;
`;

const SuccessCircle = styled.View`
  width: 80px;
  height: 80px;
  border-radius: 40px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primarySoftStrong};
  margin-bottom: 24px;
`;

const SuccessTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 24px;
  font-weight: 800;
  text-align: center;
`;

const SuccessSubtitle = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  text-align: center;
`;

const GoToLoginButton = styled.Pressable`
  margin-top: 32px;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.primary};
  width: 100%;
`;

const GoToLoginLabel = styled.Text`
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
`;

export function ResetPasswordScreen({ email, onResetComplete, onBack }: ResetPasswordScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const passwordValidation = validatePassword(newPassword);

  const handleSubmit = useCallback(async () => {
    setOtpError("");
    setPasswordError("");
    setGeneralError("");

    if (otpCode.length !== OTP_LENGTH) {
      setOtpError("Enter the full 8-character code");
      return;
    }
    if (!passwordValidation.isValid) {
      setPasswordError("Password doesn't meet requirements");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match");
      return;
    }

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      // First verify the OTP to establish a recovery session
      await verifyPasswordResetOtp(email, otpCode);
      // Then update the password
      await updatePassword(newPassword);
      // Sign out the recovery session so user must log in with new password
      await signOut();
      setIsSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      if (msg.toLowerCase().includes("token") || msg.toLowerCase().includes("otp") || msg.toLowerCase().includes("expired")) {
        setOtpError(msg.includes("expired") ? "Code expired. Request a new one." : "Invalid code");
      } else {
        setGeneralError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [otpCode, newPassword, confirmPassword, email, passwordValidation.isValid]);

  if (isSuccess) {
    return (
      <Root>
        <Backdrop colors={["#0A0806", "#060504", "#000000"]} locations={[0, 0.5, 1]} />
        <Inner $top={insets.top} $bottom={insets.bottom}>
          <SuccessWrap entering={FadeInDown.duration(400)}>
            <SuccessCircle>
              <Feather name="check" size={36} color={theme.colors.primary} />
            </SuccessCircle>
            <SuccessTitle>Password Changed</SuccessTitle>
            <SuccessSubtitle>
              Your password has been successfully updated. You can now sign in with your new password.
            </SuccessSubtitle>
            <GoToLoginButton onPress={onResetComplete}>
              <GoToLoginLabel>Back to Sign In</GoToLoginLabel>
            </GoToLoginButton>
          </SuccessWrap>
        </Inner>
      </Root>
    );
  }

  return (
    <Root>
      <Backdrop colors={["#0A0806", "#060504", "#000000"]} locations={[0, 0.5, 1]} />
      <Glow $size={160} $top={200} $left={-50} $opacity={0.06} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollContent>
            <Inner $top={insets.top} $bottom={insets.bottom}>
              <BackButton onPress={onBack} style={{ top: insets.top + 12, left: 16 }}>
                <Feather name="arrow-left" size={22} color={theme.colors.textPrimary} />
              </BackButton>

              <Animated.View entering={FadeInDown.duration(400)}>
                <IconCircle>
                  <Feather name="shield" size={28} color={theme.colors.primary} />
                </IconCircle>

                <Title>Set New Password</Title>
                <Subtitle>
                  Enter the code sent to <EmailHighlight>{email}</EmailHighlight> and create your new password.
                </Subtitle>

                <FormCard>
                  <FieldLabel>Reset Code</FieldLabel>
                  <InputWrap $error={!!otpError}>
                    <Feather
                      name="hash"
                      size={16}
                      color={otpError ? "#E5484D" : theme.colors.textSecondary}
                      style={{ marginRight: 10 }}
                    />
                    <StyledInput
                      value={otpCode}
                      onChangeText={(v) => {
                        setOtpCode(v.replace(/[^0-9a-zA-Z]/g, "").slice(0, OTP_LENGTH));
                        if (otpError) setOtpError("");
                      }}
                      placeholder="8-character code"
                      placeholderTextColor={theme.colors.textSecondary}
                      autoCapitalize="none"
                      autoComplete="one-time-code"
                      maxLength={OTP_LENGTH}
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </InputWrap>
                  {otpError ? <ErrorText>{otpError}</ErrorText> : null}

                  <FieldLabel>New Password</FieldLabel>
                  <InputWrap $error={!!passwordError}>
                    <Feather
                      name="lock"
                      size={16}
                      color={passwordError ? "#E5484D" : theme.colors.textSecondary}
                      style={{ marginRight: 10 }}
                    />
                    <StyledInput
                      ref={passwordRef}
                      value={newPassword}
                      onChangeText={(v) => {
                        setNewPassword(v);
                        if (passwordError) setPasswordError("");
                      }}
                      placeholder="New password"
                      placeholderTextColor={theme.colors.textSecondary}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete="new-password"
                      returnKeyType="next"
                      onSubmitEditing={() => confirmRef.current?.focus()}
                    />
                    <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
                      <Feather
                        name={showPassword ? "eye-off" : "eye"}
                        size={16}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                  </InputWrap>
                  {passwordError ? <ErrorText>{passwordError}</ErrorText> : null}

                  {newPassword.length > 0 ? (
                    <PasswordRulesList>
                      {[
                        { label: "8+ characters", met: newPassword.length >= 8 },
                        { label: "Lowercase letter", met: /[a-z]/.test(newPassword) },
                        { label: "Uppercase letter", met: /[A-Z]/.test(newPassword) },
                        { label: "Digit", met: /\d/.test(newPassword) },
                        { label: "Special character", met: /[^a-zA-Z0-9]/.test(newPassword) },
                      ].map((rule) => (
                        <PasswordRule key={rule.label}>
                          <Feather
                            name={rule.met ? "check-circle" : "circle"}
                            size={12}
                            color={rule.met ? theme.colors.primary : theme.colors.textSecondary}
                          />
                          <PasswordRuleText $met={rule.met}>{rule.label}</PasswordRuleText>
                        </PasswordRule>
                      ))}
                    </PasswordRulesList>
                  ) : null}

                  <FieldLabel>Confirm New Password</FieldLabel>
                  <InputWrap>
                    <Feather
                      name="lock"
                      size={16}
                      color={theme.colors.textSecondary}
                      style={{ marginRight: 10 }}
                    />
                    <StyledInput
                      ref={confirmRef}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder="Re-enter new password"
                      placeholderTextColor={theme.colors.textSecondary}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete="new-password"
                      returnKeyType="done"
                      onSubmitEditing={() => void handleSubmit()}
                    />
                  </InputWrap>

                  <SubmitButton
                    $disabled={isSubmitting || !otpCode || !newPassword || !confirmPassword}
                    disabled={isSubmitting || !otpCode || !newPassword || !confirmPassword}
                    onPress={() => void handleSubmit()}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <SubmitLabel>Reset Password</SubmitLabel>
                    )}
                  </SubmitButton>

                  {generalError ? <GeneralError>{generalError}</GeneralError> : null}
                </FormCard>
              </Animated.View>
            </Inner>
          </ScrollContent>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Root>
  );
}
