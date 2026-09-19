import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const headers = { ...corsHeaders, "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "Customer",
    last_name: parts.slice(1).join(" ") || "-",
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function authorize(request: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = request.headers.get("Authorization") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (authHeader === `Bearer ${serviceRole}`) return { internal: true };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!authHeader.startsWith("Bearer ") || !anonKey) return null;

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;

  const { data: adminRow } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return adminRow ? { internal: false, user } : null;
}

async function shipxRequest(path: string, options: RequestInit = {}) {
  const token = Deno.env.get("INPOST_SHIPX_TOKEN");
  if (!token) throw new Error("INPOST_SHIPX_TOKEN is not configured");

  const response = await fetch(`https://api-shipx-pl.easypack24.net/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`InPost ${response.status}: ${detail.slice(0, 700)}`);
  }
  return response;
}

async function getShipment(shipmentId: string) {
  const response = await shipxRequest(`/shipments/${encodeURIComponent(shipmentId)}`);
  return await response.json();
}

async function createShipment(order: any) {
  const organizationId = Deno.env.get("INPOST_ORGANIZATION_ID");
  if (!organizationId) throw new Error("INPOST_ORGANIZATION_ID is not configured");

  const { first_name, last_name } = splitName(order.customer_name || "");
  const parcelTemplate = (Deno.env.get("INPOST_PARCEL_TEMPLATE") || "medium").toLowerCase();

  const payload = {
    receiver: {
      first_name,
      last_name,
      email: order.customer_email,
      phone: order.customer_phone,
    },
    parcels: [{ template: parcelTemplate }],
    service: "inpost_locker_standard",
    reference: order.order_number,
    custom_attributes: {
      target_point: order.pickup_point_code,
    },
    only_choice_of_offer: true,
  };

  const response = await shipxRequest(
    `/organizations/${encodeURIComponent(organizationId)}/shipments`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return await response.json();
}

async function resolveReadyShipment(shipment: any) {
  let current = shipment;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (current?.id && current?.tracking_number) return current;
    if (!current?.id) return current;
    await sleep(750);
    current = await getShipment(String(current.id));
  }
  return current;
}

async function fetchLabel(shipmentId: string) {
  const response = await shipxRequest(
    `/shipments/${encodeURIComponent(shipmentId)}/label?format=Pdf&type=A6`,
    { headers: { Accept: "application/pdf" } },
  );
  return await response.arrayBuffer();
}

async function sendToPrintNode(pdf: ArrayBuffer, title: string, idempotencyKey: string) {
  const apiKey = Deno.env.get("PRINTNODE_API_KEY");
  const printerId = Number(Deno.env.get("PRINTNODE_PRINTER_ID"));
  if (!apiKey || !Number.isFinite(printerId)) return null;

  const response = await fetch("https://api.printnode.com/printjobs", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      printerId,
      title,
      contentType: "pdf_base64",
      content: arrayBufferToBase64(pdf),
      source: "Delusional Crew automatic fulfillment",
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (response.status === 409) return "already-submitted";
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`PrintNode ${response.status}: ${detail.slice(0, 500)}`);
  }
  return String(await response.json());
}

async function signedLabelUrl(admin: ReturnType<typeof createClient>, path: string) {
  const { data, error } = await admin.storage.from("shipping-labels").createSignedUrl(path, 180);
  if (error) throw error;
  return data.signedUrl;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Supabase is not configured" }, 503);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const auth = await authorize(request, admin);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  try {
    const payload = await request.json();
    const orderId = String(payload.orderId || "");
    const action = String(payload.action || "generate");
    if (!orderId) return json({ error: "Missing orderId" }, 400);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, order_number, customer_email, customer_name, customer_phone, payment_status, shipping_country, shipping_carrier, shipping_service, pickup_point_code, inpost_shipment_id, tracking_number, shipping_label_path, shipping_label_status, printed_at")
      .eq("id", orderId)
      .single();

    if (orderError || !order) return json({ error: "Order not found" }, 404);

    if (action === "download") {
      if (!order.shipping_label_path) return json({ error: "Label has not been generated yet" }, 404);
      return json({ url: await signedLabelUrl(admin, order.shipping_label_path) });
    }

    if (order.payment_status !== "paid") return json({ error: "Order is not paid" }, 409);
    if (order.shipping_country !== "PL" || !/inpost/i.test(order.shipping_carrier || "") || !order.pickup_point_code) {
      return json({ error: "Automatic InPost labels are available for Polish InPost locker orders" }, 409);
    }

    const missingConfig = [
      !Deno.env.get("INPOST_SHIPX_TOKEN") ? "INPOST_SHIPX_TOKEN" : null,
      !Deno.env.get("INPOST_ORGANIZATION_ID") ? "INPOST_ORGANIZATION_ID" : null,
    ].filter(Boolean);

    if (missingConfig.length) {
      await admin.from("orders").update({
        shipping_label_status: "needs_configuration",
        shipping_label_error: `Missing: ${missingConfig.join(", ")}`,
      }).eq("id", orderId);
      return json({ error: "InPost label generation needs configuration", missing: missingConfig }, 409);
    }

    await admin.from("orders").update({
      shipping_label_status: "generating",
      shipping_label_error: null,
    }).eq("id", orderId);

    let shipmentId = order.inpost_shipment_id ? String(order.inpost_shipment_id) : "";
    let trackingNumber = order.tracking_number ? String(order.tracking_number) : "";

    if (!shipmentId) {
      const created = await resolveReadyShipment(await createShipment(order));
      shipmentId = String(created?.id || "");
      trackingNumber = String(created?.tracking_number || created?.trackingNumber || "");
      if (!shipmentId) throw new Error("InPost did not return shipment id");

      await admin.from("orders").update({
        inpost_shipment_id: shipmentId,
        tracking_number: trackingNumber || null,
      }).eq("id", orderId);
    } else if (!trackingNumber) {
      const shipment = await resolveReadyShipment(await getShipment(shipmentId));
      trackingNumber = String(shipment?.tracking_number || shipment?.trackingNumber || "");
      if (trackingNumber) {
        await admin.from("orders").update({ tracking_number: trackingNumber }).eq("id", orderId);
      }
    }

    let labelPath = order.shipping_label_path ? String(order.shipping_label_path) : "";
    let pdf: ArrayBuffer | null = null;

    if (!labelPath || action === "regenerate") {
      pdf = await fetchLabel(shipmentId);
      labelPath = `${order.order_number}-${shipmentId}.pdf`;
      const { error: uploadError } = await admin.storage
        .from("shipping-labels")
        .upload(labelPath, pdf, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;

      await admin.from("orders").update({
        shipping_label_path: labelPath,
        shipping_label_status: "generated",
        shipping_label_created_at: new Date().toISOString(),
        shipping_label_error: null,
      }).eq("id", orderId);
    }

    const printConfigured = Boolean(Deno.env.get("PRINTNODE_API_KEY") && Deno.env.get("PRINTNODE_PRINTER_ID"));
    const shouldPrint = action === "reprint" || (action === "generate" && !order.printed_at);

    let printJobId: string | null = null;
    if (printConfigured && shouldPrint) {
      if (!pdf) {
        const { data: labelFile, error: downloadError } = await admin.storage.from("shipping-labels").download(labelPath);
        if (downloadError) throw downloadError;
        pdf = await labelFile.arrayBuffer();
      }

      printJobId = await sendToPrintNode(
        pdf,
        `DELUSIONAL ${order.order_number}`,
        action === "reprint" ? `${order.id}-reprint-${Date.now()}` : `${order.id}-auto-label`,
      );

      await admin.from("orders").update({
        shipping_label_status: "printed",
        print_job_id: printJobId,
        printed_at: new Date().toISOString(),
        shipping_label_error: null,
        fulfillment_status: "processing",
      }).eq("id", orderId);
    }

    const url = await signedLabelUrl(admin, labelPath);
    return json({
      ok: true,
      shipmentId,
      trackingNumber,
      labelStatus: printConfigured && shouldPrint ? "printed" : "generated",
      autoPrintConfigured: printConfigured,
      printJobId,
      url,
    });
  } catch (error) {
    console.error("inpost-fulfillment", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "Fulfillment failed";

    try {
      const payload = await request.clone().json().catch(() => null);
      if (payload?.orderId) {
        await admin.from("orders").update({
          shipping_label_status: "failed",
          shipping_label_error: message.slice(0, 1000),
        }).eq("id", String(payload.orderId));
      }
    } catch {}

    return json({ error: message }, 500);
  }
});