import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const headers = { ...corsHeaders, "Content-Type": "application/json" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = await request.json();
    const country = String(payload.country || "").toUpperCase();
    const postalCode = String(payload.postalCode || "").trim().slice(0, 16);
    const city = String(payload.city || "").trim().slice(0, 80);
    const subtotal = Number(payload.subtotal);

    if (!["PL", "DK"].includes(country) || postalCode.length < 3 || city.length < 2 || !Number.isFinite(subtotal) || subtotal < 0 || subtotal > 5000) {
      return json({ error: "Invalid destination" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabaseAdmin
      .from("shipping_methods")
      .select("id, carrier, service_name, amount, free_from, currency, min_delivery_days, max_delivery_days, delivery_type")
      .eq("country_code", country)
      .eq("active", true)
      .order("amount", { ascending: true });

    if (error) throw error;

    const quotes = (data || []).map((method) => ({
      id: method.id,
      carrier: method.carrier,
      service: method.service_name,
      amount: method.free_from && subtotal >= Number(method.free_from) ? 0 : Number(method.amount),
      currency: method.currency,
      minDays: method.min_delivery_days,
      maxDays: method.max_delivery_days,
      type: method.delivery_type,
    }));

    return json({ destination: { country, postalCode, city }, quotes });
  } catch (error) {
    console.error("shipping-quotes", error instanceof Error ? error.message : error);
    return json({ error: "Unable to calculate shipping" }, 500);
  }
});
