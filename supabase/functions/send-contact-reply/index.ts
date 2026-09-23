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
    const authorization = request.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
    const { data: admin } = await adminClient
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!admin) return json({ error: "Forbidden" }, 403);

    const { messageId, reply } = await request.json();
    const replyText = String(reply || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(messageId || ""))) {
      return json({ error: "Invalid message" }, 400);
    }
    if (!replyText || replyText.length > 5000) return json({ error: "Invalid reply" }, 400);

    const { data: contact, error: contactError } = await adminClient
      .from("contact_messages")
      .select("id, name, email, subject")
      .eq("id", messageId)
      .single();
    if (contactError || !contact) return json({ error: "Message not found" }, 404);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "Email service is not configured", code: "EMAIL_NOT_CONFIGURED" }, 503);

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "Delusional Crew <kontakt@delusionalcrew.pl>",
        to: [contact.email],
        reply_to: "kontakt@delusionalcrew.pl",
        subject: `Re: ${contact.subject}`,
        text: `Cześć ${contact.name},\n\n${replyText}\n\nDelusional Crew\nkontakt@delusionalcrew.pl`,
      }),
    });

    const emailResult = await emailResponse.json();
    if (!emailResponse.ok) {
      console.error("resend", emailResponse.status, emailResult);
      return json({ error: "Email could not be sent", code: "EMAIL_SEND_FAILED" }, 502);
    }

    const { error: updateError } = await adminClient
      .from("contact_messages")
      .update({ status: "replied", reply_body: replyText, replied_at: new Date().toISOString() })
      .eq("id", contact.id);
    if (updateError) throw updateError;

    return json({ sent: true });
  } catch (error) {
    console.error("send-contact-reply", error instanceof Error ? error.message : error);
    return json({ error: "Unable to send reply" }, 500);
  }
});
