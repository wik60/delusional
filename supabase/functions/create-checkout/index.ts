import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@22.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const storefrontUrl = Deno.env.get("STOREFRONT_URL");
    if (!stripeSecret || !storefrontUrl) return json({ error: "Checkout is not configured" }, 503);

    const payload = await request.json();
    const productSlug = String(payload.productSlug || "");
    const size = String(payload.size || "").toUpperCase();
    const shippingCountry = String(payload.shippingCountry || "").toUpperCase();
    const shippingMethodId = String(payload.shippingMethodId || "");
    const quantity = Number(payload.quantity);
    if (!productSlug || !size || !shippingMethodId || !["PL", "DK"].includes(shippingCountry) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return json({ error: "Invalid cart" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: variant, error: variantError } = await supabaseAdmin
      .from("product_variants")
      .select("id, size, stock, active, product:products!inner(id, slug, name, price, currency, active)")
      .eq("size", size)
      .eq("active", true)
      .eq("products.slug", productSlug)
      .eq("products.active", true)
      .single();

    if (variantError || !variant || variant.stock < quantity) return json({ error: "Product unavailable" }, 409);

    const product = Array.isArray(variant.product) ? variant.product[0] : variant.product;
    const subtotal = Number(product.price) * quantity;
    const { data: shippingMethod, error: shippingError } = await supabaseAdmin
      .from("shipping_methods")
      .select("id, carrier, service_name, amount, free_from, currency")
      .eq("id", shippingMethodId)
      .eq("country_code", shippingCountry)
      .eq("active", true)
      .single();
    if (shippingError || !shippingMethod) return json({ error: "Shipping unavailable" }, 409);
    const shippingAmount = shippingMethod.free_from && subtotal >= Number(shippingMethod.free_from)
      ? 0
      : Number(shippingMethod.amount);
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        subtotal_amount: subtotal,
        shipping_amount: shippingAmount,
        total_amount: subtotal + shippingAmount,
        currency: product.currency,
        shipping_country: shippingCountry,
        shipping_method_id: shippingMethod.id,
        shipping_carrier: shippingMethod.carrier,
        shipping_service: shippingMethod.service_name,
      })
      .select("id, order_number")
      .single();

    if (orderError || !order) throw orderError || new Error("Could not create order");

    const { error: itemError } = await supabaseAdmin.from("order_items").insert({
      order_id: order.id,
      product_id: product.id,
      variant_id: variant.id,
      product_name: product.name,
      size,
      quantity,
      unit_price: product.price,
    });
    if (itemError) throw itemError;

    const stripeClient = new Stripe(stripeSecret, {
      apiVersion: "2026-07-29.dahlia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
      quantity,
      price_data: {
        currency: String(product.currency).toLowerCase(),
        unit_amount: Math.round(Number(product.price) * 100),
        product_data: {
          name: product.name,
          description: `Rozmiar: ${size}`,
        },
      },
    }];
    if (shippingAmount > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: String(product.currency).toLowerCase(),
          unit_amount: Math.round(shippingAmount * 100),
          product_data: { name: `${shippingMethod.carrier} — ${shippingMethod.service_name}` },
        },
      });
    }

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      integration_identifier: "delusional_qmwrpzka",
      customer_creation: "always",
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: [shippingCountry as "PL" | "DK"] },
      line_items: lineItems,
      metadata: { order_id: order.id, order_number: order.order_number, shipping_method_id: shippingMethod.id },
      success_url: `${storefrontUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${storefrontUrl}?payment=cancelled`,
    });

    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);
    if (updateError) throw updateError;

    return json({ url: session.url });
  } catch (error) {
    console.error("create-checkout", error instanceof Error ? error.message : error);
    return json({ error: "Unable to start checkout" }, 500);
  }
});
