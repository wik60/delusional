import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const headers = { ...corsHeaders, "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = request.headers.get("Authorization") || "";
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: admin } = await adminClient.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!admin) return json({ error: "Forbidden" }, 403);

    const body = await request.json();
    const mode = String(body.mode || "");
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    if (!["customer", "newsletter"].includes(mode) || !subject || subject.length > 180 || !message || message.length > 10000) return json({ error: "Nieprawidłowa treść wiadomości." }, 400);

    let recipients: Array<{ email: string; token?: string }> = [];
    if (mode === "customer") {
      const email = String(body.email || "").trim().toLowerCase();
      const { data: order } = await adminClient.from("orders").select("id").ilike("customer_email", email).eq("payment_status", "paid").limit(1).maybeSingle();
      if (!order) return json({ error: "Adres nie należy do klienta z opłaconym zamówieniem." }, 400);
      recipients = [{ email }];
    } else {
      const { data } = await adminClient.from("newsletter_subscribers").select("email, unsubscribe_token").eq("active", true);
      recipients = (data || []).map((item) => ({ email: item.email, token: item.unsubscribe_token }));
    }
    if (!recipients.length) return json({ error: "Brak aktywnych odbiorców." }, 400);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "Wysyłka e-mail nie jest skonfigurowana." }, 503);
    const escapedMessage = escapeHtml(message).replace(/\n/g, "<br>");
    for (const recipient of recipients) {
      const unsubscribe = mode === "newsletter" ? `<p style="margin-top:32px;font-size:12px;color:#777">Nie chcesz otrzymywać wiadomości? <a href="${url}/functions/v1/unsubscribe-newsletter?token=${recipient.token}">Wypisz się</a>.</p>` : "";
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({ from: "Delusional Crew <kontakt@delusionalcrew.pl>", to: [recipient.email], reply_to: "kontakt@delusionalcrew.pl", subject, text: `${message}\n\nDelusional Crew`, html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111"><p>${escapedMessage}</p>${unsubscribe}<p>Delusional Crew</p></div>` }),
      });
      if (!response.ok) {
        console.error("resend", response.status, await response.text());
        return json({ error: `Nie udało się wysłać wiadomości do ${recipient.email}.` }, 502);
      }
    }

    await adminClient.from("email_campaigns").insert({ mode, recipient_email: mode === "customer" ? recipients[0].email : null, subject, message, recipient_count: recipients.length, sent_by: user.id });
    return json({ sent: true, recipientCount: recipients.length });
  } catch (error) {
    console.error("send-admin-email", error);
    return json({ error: "Nie udało się wysłać wiadomości." }, 500);
  }
});
