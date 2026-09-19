import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@22.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }

async function verifyParcelLocker(code: string) {
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return null;
  try {
    const response = await fetch(\`https://api-shipx-pl.easypack24.net/v1/points/\${encodeURIComponent(code)}\`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const point = await response.json();
    const types = Array.isArray(point.type) ? point.type : [];
    if (point.status !== "Operating" || !types.includes("parcel_locker")) return null;
    return {
      code: String(point.name).slice(0, 32),
      name: String(point.display_name || \`InPost Paczkomat \${point.name}\`).slice(0, 120),
      address: \`\${String(point.address?.line1 || "")}, \${String(point.address?.line2 || "")}\`
        .replace(/^, |, $/g, "")
        .slice(0, 220),
    };
  } catch (error) {
    console.error("verify-parcel-locker", error instanceof Error ? error.message : error);
    return null;
  }
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
    const quantity = Number(payload.quantity);
    const customerName = String(payload.customerName || "").trim().slice(0, 120);
    const customerEmail = String(payload.customerEmail || "").trim().toLowerCase().slice(0, 160);
    const customerPhone = String(payload.customerPhone || "").trim().slice(0, 24);
    const shippingCountry = String(payload.shippingCountry || "").toUpperCase();
    const shippingAddressLine1 = String(payload.shippingAddressLine1 || "").trim().slice(0, 160);
    const shippingAddressLine2 = String(payload.shippingAddressLine2 || "").trim().slice(0, 160);
    const shippingCity = String(payload.shippingCity || "").trim().slice(0, 80);
    const shippingPostalCode = String(payload.shippingPostalCode || "").trim().slice(0, 16);
    const shippingMethodId = String(payload.shippingMethodId || "");
    const pickupPointCode = String(payload.pickupPointCode || "").trim().toUpperCase();

    const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail);
    const phoneDigits = customerPhone.replace(/\D/g, "");
    if (
      !productSlug || !size || !shippingMethodId || !["PL", "DK"].includes(shippingCountry) ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 10 ||
      customerName.length < 2 || !validEmail || phoneDigits.length < 7 || phoneDigits.length > 15 ||
      shippingAddressLine1.length < 3 || shippingCity.length < 2 || shippingPostalCode.length < 3
    ) return json({ error: "Invalid checkout details" }, 400);

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
      .select("id, carrier, service_name, amount, free_from, currency, delivery_type")
      .eq("id", shippingMethodId)
      .eq("country_code", shippingCountry)
      .eq("active", true)
      .single();
    if (shippingError || !shippingMethod) return json({ error: "Shipping unavailable" }, 409);

    const pickupPoint = shippingMethod.delivery_type === "parcel_locker"
      ? await verifyParcelLocker(pickupPointCode)
      : null;
    if (shippingMethod.delivery_type === "parcel_locker" && !pickupPoint) return json({ error: "Invalid pickup point" }, 400);

    const shippingAmount = shippingMethod.free_from && subtotal >= Number(shippingMethod.free_from)
      ? 0
      : Number(shippingMethod.amount);

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_email: customerEmail,
        customer_name: customerName,
        customer_phone: customerPhone,
        shipping_address_line1: shippingAddressLine1,
        shipping_address_line2: shippingAddressLine2 || null,
        shipping_postal_code: shippingPostalCode,
        shipping_city: shippingCity,
        shipping_country: shippingCountry,
        subtotal_amount: subtotal,
        shipping_amount: shippingAmount,
        total_amount: subtotal + shippingAmount,
        currency: product.currency,
        shipping_method_id: shippingMethod.id,
        shipping_carrier: shippingMethod.carrier,
        shipping_service: shippingMethod.service_name,
        pickup_point_code: pickupPoint?.code || null,
        pickup_point_name: pickupPoint?.name || null,
        pickup_point_address: pickupPoint?.address || null,
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
        product_data: { name: product.name, description: \`Rozmiar: \${size}\` },
      },
    }];

    if (shippingAmount > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: String(product.currency).toLowerCase(),
          unit_amount: Math.round(shippingAmount * 100),
          product_data: {
            name: \`\${shippingMethod.carrier} — \${shippingMethod.service_name}\`,
            description: pickupPoint
              ? \`\${pickupPoint.code} · \${pickupPoint.address}\`
              : \`\${shippingAddressLine1}, \${shippingPostalCode} \${shippingCity}\`,
          },
        },
      });
    }

    const normalizedStorefrontUrl = storefrontUrl.endsWith("/") ? storefrontUrl : \`\${storefrontUrl}/\`;
    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      integration_identifier: "delusional_qmwrpzka",
      customer_creation: "always",
      customer_email: customerEmail,
      billing_address_collection: "auto",
      line_items: lineItems,
      locale: "en",
      custom_text: {
        submit: { message: "After payment, a confirmation will be sent to your email. Delivery details and phone number were collected before checkout." },
      },
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        shipping_method_id: shippingMethod.id,
        pickup_point_code: pickupPoint?.code || "",
      },
      success_url: \`\${normalizedStorefrontUrl}thank-you.html?session_id={CHECKOUT_SESSION_ID}\`,
      cancel_url: \`\${normalizedStorefrontUrl}index.html?payment=cancelled\`,
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