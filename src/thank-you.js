import "./storefront.css";
import { supabase } from "./supabase.js";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "PLN",
});

const els = Object.fromEntries([
  "thankYouCard","thankYouTitle","thankYouLead","thankYouDetails","thankYouOrder",
  "thankYouProduct","thankYouShipping","thankYouTotal","thankYouEmail",
].map((id) => [id, document.querySelector(`#${id}`)]));

const sessionId = new URLSearchParams(location.search).get("session_id");

function fail(message) {
  els.thankYouCard.classList.add("is-error");
  els.thankYouTitle.textContent = "WE COULD NOT VERIFY THE PAYMENT.";
  els.thankYouLead.textContent = message;
}

if (!sessionId) {
  fail("The order ID is missing. If your card was charged, contact us and we will verify the payment.");
} else {
  try {
    const { data, error } = await supabase.functions.invoke("checkout-status", {
      body: { sessionId },
    });

    if (error || !data?.orderNumber) throw error || new Error("Order not found");

    const paid = data.paymentStatus === "paid" || data.paymentStatus === "no_payment_required";
    els.thankYouCard.classList.toggle("is-pending", !paid);
    els.thankYouTitle.textContent = paid ? "THANK YOU FOR YOUR ORDER." : "YOUR PAYMENT IS PROCESSING.";
    els.thankYouLead.textContent = paid
      ? "Your order has been confirmed and is now being prepared."
      : "Payment confirmation can take a few seconds. Refresh this page shortly.";

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
      ? `Stripe will send the payment receipt to ${data.customerEmail}.`
      : "Stripe will send the payment receipt to the email address used during checkout.";

    localStorage.removeItem("delusional-cart-v3");
    localStorage.removeItem("delusional-cart-v2");
  } catch (error) {
    console.error(error);
    fail("Refresh this page in a moment or return to the store.");
  }
}
