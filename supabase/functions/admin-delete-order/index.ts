import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@22.4.0";
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
    const authorization = request.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
    const { data: admin } = await supabaseAdmin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!admin) return json({ error: "Forbidden" }, 403);

    const { orderId } = await request.json();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(orderId || ""))) {
      return json({ error: "Invalid order" }, 400);
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, stripe_checkout_session_id, payment_status")
      .eq("id", orderId)
      .single();
    if (orderError || !order) return json({ error: "Order not found" }, 404);

    if (order.payment_status === "pending" && order.stripe_checkout_session_id) {
      const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeSecret) return json({ error: "Stripe is not configured" }, 503);
      const stripe = new Stripe(stripeSecret, {
        apiVersion: "2026-07-29.dahlia",
        httpClient: Stripe.createFetchHttpClient(),
      });
      const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
      if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    }

    const { error: deleteError } = await supabaseAdmin.from("orders").delete().eq("id", order.id);
    if (deleteError) throw deleteError;

    return json({ deleted: true });
  } catch (error) {
    console.error("admin-delete-order", error instanceof Error ? error.message : error);
    return json({ error: "Unable to delete order" }, 500);
  }
});
