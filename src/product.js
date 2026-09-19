import "./styles.css";
import "./product.css";
import { PRODUCT } from "./config.js";
import { supabase } from "./supabase.js";

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const els = Object.fromEntries([
  "sizeGuideToggle", "sizeGuide", "productQtyDown", "productQtyUp", "productQty",
  "productBagCount", "productAddButton", "productCheckout", "productShippingForm",
  "productCountry", "productCity", "productPostal", "productShippingMessage",
  "productShippingQuotes", "startPaymentButton", "paymentMessage", "stripeWidget",
  "expressCheckoutElement", "contactDetailsElement", "shippingAddressElement",
  "paymentElement", "confirmPaymentButton",
].map((id) => [id, document.querySelector(`#${id}`)]));

const sizeButtons = [...document.querySelectorAll("[data-product-size]")];
let selectedSize = "";
let quantity = 1;
let quotes = [];
let selectedShipping = null;
let checkout = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function showMessage(element, message) {
  element.textContent = message;
}

function requireSize() {
  if (selectedSize) return true;
  showMessage(els.paymentMessage, "WYBIERZ ROZMIAR BLUZY.");
  document.querySelector("#productSizeOptions").classList.add("attention");
  setTimeout(() => document.querySelector("#productSizeOptions").classList.remove("attention"), 600);
  return false;
}

els.sizeGuideToggle.addEventListener("click", () => {
  const willOpen = els.sizeGuide.hidden;
  els.sizeGuide.hidden = !willOpen;
  els.sizeGuideToggle.setAttribute("aria-expanded", String(willOpen));
  els.sizeGuideToggle.lastElementChild.textContent = willOpen ? "−" : "+";
});

sizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedSize = button.dataset.productSize;
    sizeButtons.forEach((item) => item.classList.toggle("selected", item === button));
    showMessage(els.paymentMessage, "");
  });
});

els.productQtyDown.addEventListener("click", () => {
  quantity = Math.max(1, quantity - 1);
  els.productQty.textContent = String(quantity);
});

els.productQtyUp.addEventListener("click", () => {
  quantity = Math.min(10, quantity + 1);
  els.productQty.textContent = String(quantity);
});

els.productAddButton.addEventListener("click", () => {
  if (!requireSize()) return;
  els.productBagCount.textContent = String(quantity);
  els.productCheckout.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => els.productCity.focus({ preventScroll: true }), 450);
});

function renderQuotes() {
  els.productShippingQuotes.replaceChildren();
  for (const quote of quotes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "product-shipping-quote";
    button.classList.toggle("selected", selectedShipping?.id === quote.id);
    button.innerHTML = `
      <span><strong>${escapeHtml(quote.carrier)}</strong><small>${escapeHtml(quote.service)} · ${quote.minDays}–${quote.maxDays} DNI</small></span>
      <b>${quote.amount === 0 ? "GRATIS" : money.format(quote.amount)}</b>
      <i aria-hidden="true"></i>`;
    button.addEventListener("click", () => {
      selectedShipping = quote;
      renderQuotes();
      els.startPaymentButton.disabled = false;
      showMessage(els.productShippingMessage, `${quote.carrier.toUpperCase()} — WYBRANO.`);
    });
    els.productShippingQuotes.append(button);
  }
}

els.productCountry.addEventListener("change", () => {
  const isPoland = els.productCountry.value === "PL";
  els.productCity.placeholder = isPoland ? "WARSZAWA" : "KØBENHAVN";
  els.productPostal.placeholder = isPoland ? "00-001" : "1050";
  selectedShipping = null;
  quotes = [];
  renderQuotes();
  els.startPaymentButton.disabled = true;
});

els.productShippingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireSize() || !els.productShippingForm.reportValidity()) return;
  const submit = els.productShippingForm.querySelector("button[type=submit]");
  submit.disabled = true;
  selectedShipping = null;
  els.startPaymentButton.disabled = true;
  showMessage(els.productShippingMessage, "OBLICZANIE…");
  try {
    const { data, error } = await supabase.functions.invoke("shipping-quotes", {
      body: {
        country: els.productCountry.value,
        city: els.productCity.value.trim(),
        postalCode: els.productPostal.value.trim(),
        subtotal: PRODUCT.price * quantity,
      },
    });
    if (error) throw error;
    quotes = data?.quotes || [];
    if (!quotes.length) throw new Error("No shipping methods");
    renderQuotes();
    showMessage(els.productShippingMessage, "WYBIERZ PRZEWOŹNIKA.");
  } catch (error) {
    console.error(error);
    quotes = [];
    renderQuotes();
    showMessage(els.productShippingMessage, "NIE UDAŁO SIĘ POBRAĆ METOD DOSTAWY.");
  } finally {
    submit.disabled = false;
  }
});

async function initializeStripeWidgets() {
  if (!window.Stripe) throw new Error("Stripe.js did not load");
  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: {
      productSlug: PRODUCT.slug,
      size: selectedSize,
      quantity,
      shippingCountry: els.productCountry.value,
      shippingMethodId: selectedShipping.id,
      uiMode: "elements",
    },
  });
  if (error) throw error;
  if (!data?.clientSecret || !data?.publishableKey) throw new Error("Checkout is not configured");

  els.expressCheckoutElement.replaceChildren();
  els.contactDetailsElement.replaceChildren();
  els.shippingAddressElement.replaceChildren();
  els.paymentElement.replaceChildren();
  const stripe = window.Stripe(data.publishableKey);
  checkout = stripe.initCheckoutElementsSdk({ clientSecret: data.clientSecret });

  const expressCheckoutElement = checkout.createExpressCheckoutElement();
  expressCheckoutElement.mount("#expressCheckoutElement");
  expressCheckoutElement.on("confirm", async () => {
    const loadResult = await checkout.loadActions();
    if (loadResult.type !== "success") {
      showMessage(els.paymentMessage, "NIE UDAŁO SIĘ WCZYTAĆ PŁATNOŚCI.");
      return;
    }
    const { error: confirmError } = await loadResult.actions.confirm();
    if (confirmError) showMessage(els.paymentMessage, confirmError.message || "PŁATNOŚĆ NIE POWIODŁA SIĘ.");
  });

  checkout.createContactDetailsElement().mount("#contactDetailsElement");
  checkout.createShippingAddressElement().mount("#shippingAddressElement");
  checkout.createPaymentElement().mount("#paymentElement");
  els.stripeWidget.hidden = false;
  els.stripeWidget.scrollIntoView({ behavior: "smooth", block: "center" });
}

els.startPaymentButton.addEventListener("click", async () => {
  if (!requireSize()) return;
  if (!selectedShipping) {
    showMessage(els.paymentMessage, "NAJPIERW WYBIERZ SPOSÓB DOSTAWY.");
    return;
  }
  els.startPaymentButton.disabled = true;
  els.startPaymentButton.textContent = "URUCHAMIANIE PŁATNOŚCI…";
  showMessage(els.paymentMessage, "");
  try {
    await initializeStripeWidgets();
    els.startPaymentButton.hidden = true;
  } catch (error) {
    console.error(error);
    showMessage(els.paymentMessage, "PŁATNOŚCI SĄ JESZCZE KONFIGUROWANE. SPRÓBUJ PONOWNIE PÓŹNIEJ.");
    els.startPaymentButton.disabled = false;
    els.startPaymentButton.textContent = "PRZEJDŹ DO PŁATNOŚCI";
  }
});

els.confirmPaymentButton.addEventListener("click", async () => {
  if (!checkout) return;
  els.confirmPaymentButton.disabled = true;
  els.confirmPaymentButton.textContent = "PRZETWARZANIE…";
  showMessage(els.paymentMessage, "");
  try {
    const loadResult = await checkout.loadActions();
    if (loadResult.type !== "success") throw new Error("Could not load checkout actions");
    const { error } = await loadResult.actions.confirm();
    if (error) throw error;
  } catch (error) {
    console.error(error);
    showMessage(els.paymentMessage, error?.message || "PŁATNOŚĆ NIE POWIODŁA SIĘ.");
    els.confirmPaymentButton.disabled = false;
    els.confirmPaymentButton.textContent = "ZAPŁAĆ BEZPIECZNIE";
  }
});

const paymentState = new URLSearchParams(location.search).get("payment");
if (paymentState === "success") {
  showMessage(els.paymentMessage, "PŁATNOŚĆ PRZYJĘTA — DZIĘKUJEMY.");
  els.productCheckout.scrollIntoView({ block: "center" });
  history.replaceState({}, "", location.pathname);
}
