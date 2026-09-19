import "./styles.css";
import "./product.css";
import { supabase } from "./supabase.js";

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});

const els = Object.fromEntries([
  "thankYouCard", "thankYouTitle", "thankYouLead", "thankYouDetails", "thankYouOrder",
  "thankYouProduct", "thankYouShipping", "thankYouTotal", "thankYouEmail",
].map((id) => [id, document.querySelector(`#${id}`)]));

const sessionId = new URLSearchParams(location.search).get("session_id");

function fail(message) {
  els.thankYouCard.classList.add("is-error");
  els.thankYouTitle.textContent = "NIE UDAŁO SIĘ POTWIERDZIĆ PŁATNOŚCI.";
  els.thankYouLead.textContent = message;
}

if (!sessionId) {
  fail("Brakuje identyfikatora zamówienia. Jeśli płatność została pobrana, skontaktuj się z nami.");
} else {
  try {
    const { data, error } = await supabase.functions.invoke("checkout-status", {
      body: { sessionId },
    });
    if (error || !data?.orderNumber) throw error || new Error("Order not found");

    const paid = data.paymentStatus === "paid" || data.paymentStatus === "no_payment_required";
    els.thankYouCard.classList.toggle("is-pending", !paid);
    els.thankYouTitle.textContent = paid ? "DZIĘKUJEMY ZA ZAMÓWIENIE." : "PŁATNOŚĆ JEST PRZETWARZANA.";
    els.thankYouLead.textContent = paid
      ? "Twoje zamówienie zostało przyjęte. Zaczynamy je przygotowywać."
      : "Odśwież tę stronę za chwilę — potwierdzenie może potrwać kilka sekund.";
    els.thankYouOrder.textContent = data.orderNumber;
    els.thankYouProduct.textContent = (data.items || [])
      .map((item) => `${item.product_name} / ${item.size} × ${item.quantity}`)
      .join(", ") || "Delusional Classic Zip Up";
    const pickup = data.shipping?.pickupPoint;
    els.thankYouShipping.textContent = pickup
      ? `${data.shipping.carrier} ${pickup.code} — ${pickup.address}`
      : `${data.shipping?.carrier || ""} ${data.shipping?.service || ""}`.trim();
    els.thankYouTotal.textContent = money.format(Number(data.totalAmount));
    els.thankYouDetails.hidden = false;
    els.thankYouEmail.textContent = data.customerEmail
      ? `Potwierdzenie płatności zostanie wysłane przez Stripe na adres ${data.customerEmail}.`
      : "Potwierdzenie płatności zostanie wysłane przez Stripe na adres podany podczas płatności.";
    localStorage.removeItem("delusional-cart-v2");
  } catch (error) {
    console.error(error);
    fail("Spróbuj odświeżyć stronę lub wróć do sklepu.");
  }
}
