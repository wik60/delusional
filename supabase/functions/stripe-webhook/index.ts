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
    event = await stripeClient.webhooks.constructEventAsync(await request.text(), signature, webhookSecret);
  } catch (error) {
    console.error("Invalid webhook signature", error instanceof Error ? error.message : error);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
      );

      const update: Record<string, unknown> = {
        total_amount: (session.amount_total || 0) / 100,
        payment_status: session.payment_status === "paid" ? "paid" : "pending",
        fulfillment_status: session.payment_status === "paid" ? "paid" : "pending",
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      };
      if (session.customer_details?.email || session.customer_email) {
        update.customer_email = session.customer_details?.email || session.customer_email;
      }
      if (session.customer_details?.phone) update.customer_phone = session.customer_details.phone;

      const { error } = await supabaseAdmin.from("orders").update(update).eq("id", orderId);
      if (error) {
        console.error("Order update failed", error.message);
        return new Response("Database update failed", { status: 500 });
      }

      if (session.payment_status === "paid") {
        const fulfillmentUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/inpost-fulfillment`;
        const fulfillmentPromise = fetch(fulfillmentUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ orderId, action: "generate" }),
        }).then(async (response) => {
          if (!response.ok) console.error("Automatic label fulfillment failed", await response.text());
        }).catch((error) => console.error("Automatic label fulfillment request failed", error));

        try {
          // Keep Stripe webhook fast while the label is generated and optionally printed.
          // @ts-ignore Supabase Edge Runtime global
          EdgeRuntime.waitUntil(fulfillmentPromise);
        } catch {
          await fulfillmentPromise;
        }
      }
    }
  } else if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
      );
      const { error } = await supabaseAdmin.from("orders").update({
        payment_status: "failed",
        fulfillment_status: "pending",
      }).eq("id", orderId);
      if (error) return new Response("Database update failed", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});