import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@22.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const signature = request.headers.get("stripe-signature");
  if (!stripeSecret || !webhookSecret || !signature) return new Response("Webhook not configured", { status: 503 });

  const stripeClient = new Stripe(stripeSecret, {
    apiVersion: "2026-07-29.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = await stripeClient.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (error) {
    console.error("Invalid webhook signature", error instanceof Error ? error.message : error);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      const address = session.shipping_details?.address;
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
      );

      const { error } = await supabaseAdmin.from("orders").update({
        customer_email: session.customer_details?.email || session.customer_email,
        customer_name: session.shipping_details?.name || session.customer_details?.name,
        shipping_address_line1: address?.line1,
        shipping_address_line2: address?.line2,
        shipping_postal_code: address?.postal_code,
        shipping_city: address?.city,
        shipping_country: address?.country,
        subtotal_amount: (session.amount_subtotal || 0) / 100,
        shipping_amount: (session.shipping_cost?.amount_total || 0) / 100,
        total_amount: (session.amount_total || 0) / 100,
        payment_status: session.payment_status === "paid" ? "paid" : "pending",
        fulfillment_status: session.payment_status === "paid" ? "paid" : "pending",
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      }).eq("id", orderId);

      if (error) {
        console.error("Order update failed", error.message);
        return new Response("Database update failed", { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
