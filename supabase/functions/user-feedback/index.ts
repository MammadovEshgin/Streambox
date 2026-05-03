import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-streambox-auth",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const FEEDBACK_TO_EMAIL = "esqinmemmedov700@gmail.com";

type FeedbackRequest = {
  message?: string;
  language?: string;
  profileName?: string;
  profileLocation?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSubject(profileName: string, language: string) {
  const suffix = language === "tr" ? "Uygulama geri bildirimi" : "App feedback";
  return `StreamBox | ${suffix} | ${profileName}`;
}

function buildHtmlEmail(params: {
  profileName: string;
  senderEmail: string;
  location: string;
  userId: string;
  message: string;
}) {
  const { profileName, senderEmail, location, userId, message } = params;
  const submittedAt = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Baku",
  });

  return `
    <div style="margin:0;padding:24px 14px;background:#070a08;font-family:Arial,Helvetica,sans-serif;color:#eef3ef;">
      <div style="max-width:640px;margin:0 auto;background:#101512;border:1px solid #1d2920;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 24px 24px;background:linear-gradient(135deg,#123320 0%,#0b1510 55%,#08100b 100%);border-bottom:1px solid #1d2920;">
          <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.08);color:#cfe6d5;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;">StreamBox Feedback</div>
          <h1 style="margin:14px 0 0;font-size:28px;line-height:1.15;color:#f5fbf6;">New feedback from ${escapeHtml(profileName)}</h1>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#b8c9bc;">A new note arrived from the app. Here is the full message and sender context.</p>
        </div>
        <div style="padding:24px;">
          <div style="margin-bottom:18px;padding:16px 18px;border-radius:18px;background:#141c17;border:1px solid #233229;">
            <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8ea797;">From</div>
            <div style="margin-top:6px;font-size:16px;line-height:1.45;font-weight:700;color:#f3faf4;">${escapeHtml(profileName)}</div>
            <div style="margin-top:4px;font-size:14px;line-height:1.6;color:#bdd1c2;">${escapeHtml(senderEmail)}</div>
          </div>
          <div style="padding:18px 18px 20px;border-radius:20px;background:#0d1310;border:1px solid #1f2c23;">
            <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8ea797;margin-bottom:12px;">Feedback message</div>
            <div style="font-size:15px;line-height:1.8;color:#eef4ef;white-space:pre-wrap;">${escapeHtml(message)}</div>
          </div>
          <div style="margin-top:18px;padding:16px 18px;border-radius:18px;background:#141c17;border:1px solid #233229;">
            <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8ea797;margin-bottom:8px;">Details</div>
            <div style="font-size:13px;line-height:1.8;color:#c6d4c9;">
              <div><strong style="color:#f3faf4;">Submitted:</strong> ${escapeHtml(submittedAt)} (Asia/Baku)</div>
              <div><strong style="color:#f3faf4;">Location:</strong> ${escapeHtml(location || "Not provided")}</div>
              <div><strong style="color:#f3faf4;">User ID:</strong> ${escapeHtml(userId)}</div>
            </div>
          </div>
          <div style="margin-top:18px;color:#7f9585;font-size:12px;line-height:1.7;text-align:center;">
            Sent from StreamBox feedback
          </div>
        </div>
      </div>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "Method not allowed." }, 405);
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const feedbackFromEmail = Deno.env.get("FEEDBACK_FROM_EMAIL") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!resendApiKey || !feedbackFromEmail || !supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ success: false, message: "Feedback service is not configured." }, 500);
    }

    const authHeader = req.headers.get("X-StreamBox-Auth") ?? req.headers.get("Authorization") ?? "";
    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!authToken) {
      return jsonResponse({ success: false, message: "You must be signed in to send feedback." }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authToken);

    if (authError || !user?.email) {
      return jsonResponse({ success: false, message: "You must be signed in to send feedback." }, 401);
    }

    const body = (await req.json()) as FeedbackRequest;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const profileName =
      typeof body.profileName === "string" && body.profileName.trim().length > 0
        ? body.profileName.trim()
        : "StreamBox user";
    const language =
      typeof body.language === "string" && body.language.trim().length > 0
        ? body.language.trim()
        : "en";
    const location = typeof body.profileLocation === "string" ? body.profileLocation.trim() : "";

    if (message.length < 10 || message.length > 2000) {
      return jsonResponse(
        { success: false, message: "Feedback must be between 10 and 2000 characters." },
        400
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `StreamBox Feedback <${feedbackFromEmail}>`,
        to: [FEEDBACK_TO_EMAIL],
        reply_to: user.email,
        subject: formatSubject(profileName, language),
        html: buildHtmlEmail({
          profileName,
          senderEmail: user.email,
          location,
          userId: user.id,
          message,
        }),
        text: [
          `StreamBox feedback from ${profileName}`,
          `Email: ${user.email}`,
          `Location: ${location || "Not provided"}`,
          `User ID: ${user.id}`,
          "",
          message,
        ].join("\n"),
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return jsonResponse(
        {
          success: false,
          message:
            typeof result?.message === "string"
              ? result.message
              : "Unable to send feedback email.",
        },
        500
      );
    }

    return jsonResponse({ success: true, id: result?.id ?? null });
  } catch (error) {
    return jsonResponse({ success: false, message: String(error) }, 500);
  }
});
