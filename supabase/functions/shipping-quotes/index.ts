import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.116.0/cors";

const headers = { ...corsHeaders, "Content-Type": "application/json" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }

type ParcelLocker = {
  code: string; name: string; address: string; city: string; postalCode: string;
  latitude: number; longitude: number; distanceKm?: number;
};

function radians(value: number) { return value * Math.PI / 180; }
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const earth = 6371;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function geocodeAddress(addressLine1: string, postalCode: string, city: string, country: string) {
  // Apartment / unit numbers must not influence geocoding. They can cause a valid
  // street address to resolve incorrectly or fail entirely.
  const q = [addressLine1, postalCode, city, country === "PL" ? "Poland" : "Denmark"].filter(Boolean).join(", ");
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=${country.toLowerCase()}&q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(6500),
      headers: { Accept: "application/json", "User-Agent": "DelusionalCrewStore/1.0 (shipping address lookup)" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : null;
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  } catch (error) {
    console.error("geocode-address", error instanceof Error ? error.message : error);
    return null;
  }
}

async function getParcelLockers(
  city: string,
  postalCode: string,
  origin: { latitude: number; longitude: number } | null,
): Promise<ParcelLocker[]> {
  // InPost's city filter is not proximity-aware and Warsaw has far more points than
  // a single page. Querying the first 100 by city could therefore omit a locker
  // literally next door. Use InPost's native nearest-points query instead.
  const params = new URLSearchParams({
    type: "parcel_locker",
    status: "Operating",
    sort_by: "distance_to_relative_point",
    sort_order: "asc",
    limit: "50",
    max_distance: "10000",
  });

  if (origin) {
    params.set("relative_point", `${origin.latitude},${origin.longitude}`);
  } else {
    // If street geocoding ever fails, the postal code still gives InPost a local
    // reference point instead of falling back to an arbitrary city-wide page.
    params.set("relative_post_code", postalCode);
  }

  try {
    const response = await fetch(`https://api-shipx-pl.easypack24.net/v1/points?${params}`, {
      signal: AbortSignal.timeout(6500),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];

    const payload = await response.json();
    const seen = new Set<string>();
    const points: ParcelLocker[] = (payload.items || []).flatMap((point: Record<string, unknown>) => {
      const address = point.address as Record<string, unknown> | undefined;
      const details = point.address_details as Record<string, unknown> | undefined;
      const location = point.location as Record<string, unknown> | undefined;
      const code = String(point.name || "").slice(0, 32);
      const latitude = Number(location?.latitude);
      const longitude = Number(location?.longitude);

      if (!code || seen.has(code) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      seen.add(code);

      return [{
        code,
        name: String(point.display_name || `InPost Paczkomat ${code}`).slice(0, 120),
        address: String(address?.line1 || "").slice(0, 160),
        city: String(details?.city || city).slice(0, 80),
        postalCode: String(details?.post_code || "").slice(0, 16),
        latitude,
        longitude,
        distanceKm: origin
          ? distanceKm(origin.latitude, origin.longitude, latitude, longitude)
          : (Number.isFinite(Number(point.distance)) ? Number(point.distance) / 1000 : undefined),
      }];
    });

    points.sort((a, b) => Number(a.distanceKm ?? 9999) - Number(b.distanceKm ?? 9999));
    return points.slice(0, 30);
  } catch (error) {
    console.error("parcel-lockers", error instanceof Error ? error.message : error);
    return [];
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = await request.json();
    const name = String(payload.name || "").trim().slice(0, 120);
    const email = String(payload.email || "").trim().toLowerCase().slice(0, 160);
    const phone = String(payload.phone || "").trim().slice(0, 24);
    const country = String(payload.country || "").toUpperCase();
    const addressLine1 = String(payload.addressLine1 || "").trim().slice(0, 160);
    const addressLine2 = String(payload.addressLine2 || "").trim().slice(0, 160);
    const postalCode = String(payload.postalCode || "").trim().slice(0, 16);
    const city = String(payload.city || "").trim().slice(0, 80);
    const subtotal = Number(payload.subtotal);

    const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    const phoneDigits = phone.replace(/\D/g, "");
    if (
      name.length < 2 || !validEmail || phoneDigits.length < 7 || phoneDigits.length > 15 ||
      !["PL", "DK"].includes(country) || addressLine1.length < 3 || postalCode.length < 3 || city.length < 2 ||
      !Number.isFinite(subtotal) || subtotal < 0 || subtotal > 5000
    ) return json({ error: "Complete all required delivery details" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabaseAdmin
      .from("shipping_methods")
      .select("id, carrier, service_name, amount, free_from, currency, min_delivery_days, max_delivery_days, delivery_type")
      .eq("country_code", country)
      .eq("active", true)
      .order("amount", { ascending: true });
    if (error) throw error;

    const quotes = (data || []).map((method) => ({
      id: method.id,
      carrier: method.carrier,
      service: method.service_name,
      amount: method.free_from && subtotal >= Number(method.free_from) ? 0 : Number(method.amount),
      currency: method.currency,
      minDays: method.min_delivery_days,
      maxDays: method.max_delivery_days,
      type: method.delivery_type,
    }));

    const origin = country === "PL" ? await geocodeAddress(addressLine1, postalCode, city, country) : null;
    const parcelLockers = country === "PL" ? await getParcelLockers(city, postalCode, origin) : [];

    return json({
      destination: { name, email, phone, country, addressLine1, addressLine2, postalCode, city, geocoded: Boolean(origin) },
      quotes,
      parcelLockers,
    });
  } catch (error) {
    console.error("shipping-quotes", error instanceof Error ? error.message : error);
    return json({ error: "Unable to calculate shipping" }, 500);
  }
});