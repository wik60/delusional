import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function trackPageVisit() {
  if (document.visibilityState === "prerender" || /admin\.html$/i.test(window.location.pathname)) return;

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const sessionKey = `delusional-visit:${new Date().toISOString().slice(0, 10)}:${path}`;
  try {
    if (window.sessionStorage.getItem(sessionKey)) return;
    window.sessionStorage.setItem(sessionKey, "1");
    const { error } = await supabase.rpc("record_page_visit", { p_path: path });
    if (error) window.sessionStorage.removeItem(sessionKey);
  } catch {
    // Statystyki nie mogą blokować działania sklepu, gdy pamięć lub sieć są niedostępne.
  }
}

if (typeof window !== "undefined") void trackPageVisit();
