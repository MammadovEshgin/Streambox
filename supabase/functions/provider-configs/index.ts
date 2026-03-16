import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from("provider_configs")
      .select("id, label, base_url, referer, enabled, priority, updated_at")
      .eq("enabled", true)
      .order("priority", { ascending: true });

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Shape: { providers: { hdfilm: { baseUrl, referer }, dizipal: { baseUrl, referer } } }
    const providers: Record<string, { baseUrl: string; referer: string }> = {};
    for (const row of data ?? []) {
      providers[row.id] = {
        baseUrl: row.base_url,
        referer: row.referer || `${row.base_url}/`,
      };
    }

    return new Response(
      JSON.stringify({ success: true, providers, updatedAt: new Date().toISOString() }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Cache-Control": "public, max-age=300", // CDN-cache 5 min
        },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
