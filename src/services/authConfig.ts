export const AUTH_EMAIL_OTP_LENGTH = 6;

export function sanitizeAuthEmailOtp(value: string) {
  return value.replace(/\D/g, "").slice(0, AUTH_EMAIL_OTP_LENGTH);
}
