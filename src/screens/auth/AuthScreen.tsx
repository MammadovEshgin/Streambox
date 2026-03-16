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
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import { isValidEmail, signIn, signUp, validatePassword } from "../../services/auth";

type AuthScreenProps = {
  onSignUpSuccess: (email: string, displayName: string) => void;
  onSignInSuccess: () => void;
  onForgotPassword: () => void;
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

const ScrollContent = styled.ScrollView.attrs({
  showsVerticalScrollIndicator: false,
  keyboardShouldPersistTaps: "handled",
})`
  flex: 1;
`;

const Inner = styled.View<{ $top: number; $bottom: number }>`
  flex: 1;
  padding: ${({ $top }) => $top + 20}px 24px ${({ $bottom }) => $bottom + 24}px;
`;

const BrandSection = styled(Animated.View)`
  align-items: center;
  margin-top: 32px;
  margin-bottom: 40px;
`;

const BrandTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.8px;
`;

const BrandAccent = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
`;

const BrandSubtitle = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  line-height: 20px;
`;

const TabRow = styled.View`
  flex-direction: row;
  margin-bottom: 28px;
  border-radius: 12px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding: 4px;
`;

const Tab = styled.Pressable<{ $active: boolean }>`
  flex: 1;
  padding: 12px 0;
  align-items: center;
  border-radius: 10px;
  background-color: ${({ $active, theme }) =>
    $active ? theme.colors.primarySoftStrong : "transparent"};
`;

const TabLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2px;
`;

const FormCard = styled(Animated.View)`
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
  line-height: 16px;
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
  letter-spacing: 0.2px;
`;

const ForgotButton = styled.Pressable`
  align-self: flex-end;
  padding: 4px 0;
  margin-top: -8px;
  margin-bottom: 12px;
`;

const ForgotText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 600;
`;

const GeneralError = styled.Text`
  color: #E5484D;
  font-size: 13px;
  line-height: 18px;
  text-align: center;
  margin-top: 12px;
`;

export function AuthScreen({ onSignUpSuccess, onSignInSuccess, onForgotPassword }: AuthScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const passwordValidation = validatePassword(password);

  const clearErrors = () => {
    setNameError("");
    setEmailError("");
    setPasswordError("");
    setGeneralError("");
  };

  const switchMode = (next: "login" | "signup") => {
    setMode(next);
    clearErrors();
    setPassword("");
    setConfirmPassword("");
    setDisplayName("");
  };

  const handleSubmit = useCallback(async () => {
    clearErrors();

    if (mode === "signup" && !displayName.trim()) {
      setNameError("Name is required");
      return;
    }
    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }
    if (!isValidEmail(email)) {
      setEmailError("Enter a valid email address");
      return;
    }
    if (!password) {
      setPasswordError("Password is required");
      return;
    }

    if (mode === "signup") {
      if (!passwordValidation.isValid) {
        setPasswordError("Password doesn't meet requirements");
        return;
      }
      if (password !== confirmPassword) {
        setPasswordError("Passwords don't match");
        return;
      }
    }

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      if (mode === "signup") {
        await signUp(email, password, displayName.trim());
        onSignUpSuccess(email.trim().toLowerCase(), displayName.trim());
      } else {
        await signIn(email, password);
        onSignInSuccess();
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : "";
      const message = raw || "Something went wrong";
      const lower = message.toLowerCase();
      if (lower.includes("invalid login credentials") || lower.includes("password") || lower.includes("credentials")) {
        setGeneralError("Invalid email or password");
      } else if (lower.includes("email")) {
        setEmailError(message);
      } else {
        setGeneralError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, confirmPassword, displayName, mode, passwordValidation.isValid, onSignUpSuccess, onSignInSuccess]);

  const isLoginDisabled = isSubmitting || !email.trim() || !password;
  const isSignupDisabled = isSubmitting || !displayName.trim() || !email.trim() || !password || !confirmPassword || !passwordValidation.isValid || password !== confirmPassword;
  const isDisabled = mode === "login" ? isLoginDisabled : isSignupDisabled;

  return (
    <Root>
      <Backdrop colors={["#0A0806", "#060504", "#000000"]} locations={[0, 0.5, 1]} />
      <Glow $size={200} $top={60} $right={-80} $opacity={0.07} />
      <Glow $size={140} $top={300} $right={280} $opacity={0.05} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollContent>
            <Inner $top={insets.top} $bottom={insets.bottom}>
              <BrandSection entering={FadeInDown.duration(400)}>
                <BrandTitle>
                  Stream<BrandAccent>Box</BrandAccent>
                </BrandTitle>
                <BrandSubtitle>
                  {mode === "login" ? "Welcome back" : "Create your account"}
                </BrandSubtitle>
              </BrandSection>

              <TabRow>
                <Tab $active={mode === "login"} onPress={() => switchMode("login")}>
                  <TabLabel $active={mode === "login"}>Sign In</TabLabel>
                </Tab>
                <Tab $active={mode === "signup"} onPress={() => switchMode("signup")}>
                  <TabLabel $active={mode === "signup"}>Sign Up</TabLabel>
                </Tab>
              </TabRow>

              <FormCard entering={FadeInUp.duration(350).delay(100)}>
                {mode === "signup" ? (
                  <>
                    <FieldLabel>Name</FieldLabel>
                    <InputWrap $error={!!nameError}>
                      <Feather
                        name="user"
                        size={16}
                        color={nameError ? "#E5484D" : theme.colors.textSecondary}
                        style={{ marginRight: 10 }}
                      />
                      <StyledInput
                        value={displayName}
                        onChangeText={(v) => {
                          setDisplayName(v);
                          if (nameError) setNameError("");
                        }}
                        placeholder="Your name"
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="words"
                        autoComplete="name"
                        returnKeyType="next"
                        onSubmitEditing={() => emailRef.current?.focus()}
                      />
                    </InputWrap>
                    {nameError ? <ErrorText>{nameError}</ErrorText> : null}
                  </>
                ) : null}

                <FieldLabel>Email</FieldLabel>
                <InputWrap $error={!!emailError}>
                  <Feather
                    name="mail"
                    size={16}
                    color={emailError ? "#E5484D" : theme.colors.textSecondary}
                    style={{ marginRight: 10 }}
                  />
                  <StyledInput
                    ref={emailRef}
                    value={email}
                    onChangeText={(v) => {
                      setEmail(v);
                      if (emailError) setEmailError("");
                    }}
                    placeholder="you@example.com"
                    placeholderTextColor={theme.colors.textSecondary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                  />
                </InputWrap>
                {emailError ? <ErrorText>{emailError}</ErrorText> : null}

                <FieldLabel>Password</FieldLabel>
                <InputWrap $error={!!passwordError}>
                  <Feather
                    name="lock"
                    size={16}
                    color={passwordError ? "#E5484D" : theme.colors.textSecondary}
                    style={{ marginRight: 10 }}
                  />
                  <StyledInput
                    ref={passwordRef}
                    value={password}
                    onChangeText={(v) => {
                      setPassword(v);
                      if (passwordError) setPasswordError("");
                    }}
                    placeholder="Enter password"
                    placeholderTextColor={theme.colors.textSecondary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    returnKeyType={mode === "signup" ? "next" : "done"}
                    onSubmitEditing={() => {
                      if (mode === "signup") confirmRef.current?.focus();
                      else void handleSubmit();
                    }}
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

                {mode === "signup" && password.length > 0 ? (
                  <PasswordRulesList>
                    {[
                      { label: "8+ characters", met: password.length >= 8 },
                      { label: "Lowercase letter", met: /[a-z]/.test(password) },
                      { label: "Uppercase letter", met: /[A-Z]/.test(password) },
                      { label: "Digit", met: /\d/.test(password) },
                      { label: "Special character", met: /[^a-zA-Z0-9]/.test(password) },
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

                {mode === "login" ? (
                  <ForgotButton onPress={onForgotPassword}>
                    <ForgotText>Forgot password?</ForgotText>
                  </ForgotButton>
                ) : null}

                {mode === "signup" ? (
                  <>
                    <FieldLabel>Confirm Password</FieldLabel>
                    <InputWrap $error={!!passwordError && password !== confirmPassword}>
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
                        placeholder="Re-enter password"
                        placeholderTextColor={theme.colors.textSecondary}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoComplete="new-password"
                        returnKeyType="done"
                        onSubmitEditing={() => void handleSubmit()}
                      />
                    </InputWrap>
                  </>
                ) : null}

                <SubmitButton
                  $disabled={isDisabled}
                  disabled={isDisabled}
                  onPress={() => void handleSubmit()}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <SubmitLabel>
                      {mode === "login" ? "Sign In" : "Create Account"}
                    </SubmitLabel>
                  )}
                </SubmitButton>

                {generalError ? <GeneralError>{generalError}</GeneralError> : null}
              </FormCard>
            </Inner>
          </ScrollContent>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Root>
  );
}
