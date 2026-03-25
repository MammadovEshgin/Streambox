import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  const email = "test.streambox1000@yopmail.com";
  console.log("-> Testing Signup for " + email);
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: "TestPassword123!",
    });
    if (error) {
      console.error("Error signing up:", error);
    } else {
      console.log("Signup successful!", data.user?.id);
    }

    console.log("-> Testing Reset Password for " + email);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
    if (resetError) {
      console.error("Error resetting password:", resetError);
    } else {
      console.log("Password reset email sent!");
    }
  } catch(e) {
    console.error(e);
  }
}

run().catch(console.error);
