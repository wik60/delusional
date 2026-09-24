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
    if (error) {
      window.sessionStorage.removeItem(sessionKey);
      return;
    }
    await trackVisitLocation();
  } catch {
    // Statystyki nie mogą blokować działania sklepu, gdy pamięć lub sieć są niedostępne.
  }
}

async function trackVisitLocation() {
  const day = new Date().toISOString().slice(0, 10);
  const locationKey = `delusional-location:${day}`;
  if (window.sessionStorage.getItem(locationKey)) return;

  const response = await fetch("https://ipwho.is/?fields=success,city,country,country_code", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return;
  const location = await response.json();
  if (!location?.success || !location.city || !location.country) return;

  let country = String(location.country);
  if (location.country_code && typeof Intl.DisplayNames === "function") {
    country = new Intl.DisplayNames(["pl"], { type: "region" }).of(
      String(location.country_code).toUpperCase(),
    ) || country;
  }

  const { error } = await supabase.rpc("record_visit_location", {
    p_city: String(location.city),
    p_country: country,
  });
  if (!error) window.sessionStorage.setItem(locationKey, "1");
}

if (typeof window !== "undefined") void trackPageVisit();
