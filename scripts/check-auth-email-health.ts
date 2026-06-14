import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_KEY.");
  process.exit(1);
}

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

function formatError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "unknown error";
  }

  const candidate = error as { message?: string; status?: number; code?: string };
  const parts = [candidate.message, candidate.code, candidate.status ? `status=${candidate.status}` : undefined]
    .filter(Boolean);

  return parts.join(" | ") || "unknown error";
}

async function run(): Promise<void> {
  const suffix = Date.now();
  const generateLinkEmail = `generate-link.health.${suffix}@yopmail.com`;
  const signupEmail = `signup.health.${suffix}@yopmail.com`;
  const resetEmail = `reset.health.${suffix}@yopmail.com`;
  const inviteEmail = `invite.health.${suffix}@yopmail.com`;
  const password = "TestPassword123!";
  const results: CheckResult[] = [];

  const { data: generatedSignup, error: generateSignupError } =
    await adminClient.auth.admin.generateLink({
      type: "signup",
      email: generateLinkEmail,
      password,
      options: {
        data: { display_name: "Health Check" },
      },
    });

  results.push({
    name: "admin.generateLink(signup)",
    ok: !generateSignupError,
    detail: generateSignupError
      ? formatError(generateSignupError)
      : `otp=${generatedSignup.properties.email_otp ?? "n/a"}`,
  });

  const { error: signUpError } = await anonClient.auth.signUp({
    email: signupEmail,
    password,
    options: {
      data: { display_name: "Health Check" },
    },
  });

  results.push({
    name: "auth.signUp()",
    ok: !signUpError,
    detail: signUpError ? formatError(signUpError) : "signup email accepted",
  });

  const { error: createUserError } = await adminClient.auth.admin.createUser({
    email: resetEmail,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Health Check" },
  });

  results.push({
    name: "admin.createUser()",
    ok: !createUserError,
    detail: createUserError ? formatError(createUserError) : "user created",
  });

  const { error: resetError } = await anonClient.auth.resetPasswordForEmail(resetEmail);

  results.push({
    name: "auth.resetPasswordForEmail(existing user)",
    ok: !resetError,
    detail: resetError ? formatError(resetError) : "recovery email accepted",
  });

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(inviteEmail);

  results.push({
    name: "admin.inviteUserByEmail()",
    ok: !inviteError,
    detail: inviteError ? formatError(inviteError) : "invite email accepted",
  });

  console.log("\nSupabase Auth Email Health Check\n");
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}`);
    console.log(`      ${result.detail}`);
  }

  const generatedLinkWorks = results.find((item) => item.name === "admin.generateLink(signup)")?.ok;
  const anyEmailSendFails = results.some(
    (item) =>
      !item.ok &&
      item.name !== "admin.generateLink(signup)" &&
      item.detail.toLowerCase().includes("sending") &&
      item.detail.toLowerCase().includes("email")
  );

  if (generatedLinkWorks && anyEmailSendFails) {
    console.log("\nDiagnosis");
    console.log(
      "Auth token generation is healthy, but Supabase email delivery is failing. This usually means custom SMTP is disabled or misconfigured, or a Send Email Hook is failing."
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
