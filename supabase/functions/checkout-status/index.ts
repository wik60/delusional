import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@22.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const headers = { ...corsHeaders, "Content-Type": "application/json" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function maskEmail(value: string | null | undefined) {
  if (!value || !value.includes("@")) return null;
  const [name, domain] = value.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { sessionId } = await request.json();
    if (!/^cs_(test_|live_)[A-Za-z0-9]{20,}$/.test(String(sessionId || ""))) {
      return json({ error: "Invalid session" }, 400);
    }

    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) return json({ error: "Checkout is not configured" }, 503);
    const stripeClient = new Stripe(stripeSecret, {
      apiVersion: "2026-07-29.dahlia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const session = await stripeClient.checkout.sessions.retrieve(String(sessionId));
    const orderId = session.metadata?.order_id;
    if (!orderId) return json({ error: "Order not found" }, 404);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("order_number, total_amount, currency, payment_status, shipping_carrier, shipping_service, pickup_point_code, pickup_point_name, pickup_point_address, order_items(product_name, size, quantity)")
      .eq("id", orderId)
      .eq("stripe_checkout_session_id", session.id)
      .single();
    if (error || !order) return json({ error: "Order not found" }, 404);

    return json({
      orderNumber: order.order_number,
      paymentStatus: session.payment_status,
      totalAmount: Number(order.total_amount),
      currency: order.currency,
      customerEmail: maskEmail(session.customer_details?.email || session.customer_email),
      shipping: {
        carrier: order.shipping_carrier,
        service: order.shipping_service,
        pickupPoint: order.pickup_point_code ? {
          code: order.pickup_point_code,
          name: order.pickup_point_name,
          address: order.pickup_point_address,
        } : null,
      },
      items: order.order_items || [],
    });
  } catch (error) {
    console.error("checkout-status", error instanceof Error ? error.message : error);
    return json({ error: "Unable to load order" }, 500);
  }
});
