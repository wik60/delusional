import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const page = (title: string, text: string, status = 200) => new Response(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="margin:0;background:#ede9e4;color:#111;font-family:Georgia,serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:560px;padding:40px;text-align:center"><h1>${title}</h1><p>${text}</p><a href="https://wik60.github.io/delusional/" style="color:#111">WRÓĆ DO SKLEPU</a></main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return page("NIEPRAWIDŁOWE ŻĄDANIE", "Ten link nie może zostać użyty.", 405);
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page("LINK JEST NIEPRAWIDŁOWY", "Sprawdź, czy adres został skopiowany w całości.", 400);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await client.from("newsletter_subscribers").update({ active: false, unsubscribed_at: new Date().toISOString() }).eq("unsubscribe_token", token).select("id").maybeSingle();
  if (error || !data) return page("LINK JEST NIEPRAWIDŁOWY", "Nie znaleźliśmy aktywnej subskrypcji dla tego linku.", 404);
  return page("SUBSKRYPCJA ZOSTAŁA ANULOWANA", "Nie będziemy już wysyłać newslettera na ten adres.");
});
