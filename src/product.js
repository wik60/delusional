import "./styles.css";
import "./product.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
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
  "productShippingQuotes", "startPaymentButton", "paymentMessage", "productPickupPicker",
  "productPickupSelected", "productPickupList", "productPickupMap",
].map((id) => [id, document.querySelector(`#${id}`)]));

const sizeButtons = [...document.querySelectorAll("[data-product-size]")];
let selectedSize = "";
let quantity = 1;
let quotes = [];
let parcelLockers = [];
let selectedShipping = null;
let selectedPickupPoint = null;
let pickupMap = null;
let pickupMarkers = null;

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

function paymentReady() {
  return Boolean(selectedShipping && (selectedShipping.type !== "parcel_locker" || selectedPickupPoint));
}

function updatePaymentButton() {
  els.startPaymentButton.disabled = !paymentReady();
}

function initPickupMap() {
  if (pickupMap) return;
  pickupMap = L.map(els.productPickupMap, { scrollWheelZoom: false }).setView([52.2297, 21.0122], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap",
  }).addTo(pickupMap);
  pickupMarkers = L.layerGroup().addTo(pickupMap);
}

function choosePickupPoint(point) {
  selectedPickupPoint = point;
  els.productPickupSelected.textContent = `${point.code} · ${point.address}`;
  renderPickupPoints();
  updatePaymentButton();
  showMessage(els.productShippingMessage, `WYBRANO PACZKOMAT ${point.code}.`);
}

function renderPickupPoints() {
  els.productPickupList.replaceChildren();
  for (const point of parcelLockers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pickup-point";
    button.classList.toggle("selected", selectedPickupPoint?.code === point.code);
    button.innerHTML = `<strong>${escapeHtml(point.code)}</strong><span>${escapeHtml(point.address)}, ${escapeHtml(point.postalCode)} ${escapeHtml(point.city)}</span><i aria-hidden="true"></i>`;
    button.addEventListener("click", () => choosePickupPoint(point));
    els.productPickupList.append(button);
  }

  initPickupMap();
  pickupMarkers.clearLayers();
  const bounds = [];
  for (const point of parcelLockers) {
    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: selectedPickupPoint?.code === point.code ? 9 : 7,
      color: "#171612",
      weight: 2,
      fillColor: selectedPickupPoint?.code === point.code ? "#171612" : "#c2b39f",
      fillOpacity: 1,
    }).addTo(pickupMarkers);
    marker.bindTooltip(`${escapeHtml(point.code)} · ${escapeHtml(point.address)}`);
    marker.on("click", () => choosePickupPoint(point));
    bounds.push([point.latitude, point.longitude]);
  }
  if (bounds.length) pickupMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 13 });
  requestAnimationFrame(() => pickupMap.invalidateSize());
}

function togglePickupPicker() {
  const needsPickup = selectedShipping?.type === "parcel_locker";
  els.productPickupPicker.hidden = !needsPickup;
  if (!needsPickup) {
    selectedPickupPoint = null;
    els.productPickupSelected.textContent = "NIE WYBRANO";
  } else if (parcelLockers.length) {
    renderPickupPoints();
    setTimeout(() => pickupMap?.invalidateSize(), 50);
  } else {
    els.productPickupList.innerHTML = "<p class=\"checkout-message\">NIE ZNALEZIONO PACZKOMATÓW. WPISZ PONOWNIE MIASTO I OBLICZ DOSTAWĘ.</p>";
  }
  updatePaymentButton();
}

document.querySelector(".product-gallery-swap")?.addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("show-back");
});

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
      selectedPickupPoint = null;
      renderQuotes();
      togglePickupPicker();
      showMessage(els.productShippingMessage, quote.type === "parcel_locker"
        ? "WYBIERZ PACZKOMAT NA MAPIE."
        : `${quote.carrier.toUpperCase()} — WYBRANO.`);
    });
    els.productShippingQuotes.append(button);
  }
}

els.productCountry.addEventListener("change", () => {
  const isPoland = els.productCountry.value === "PL";
  els.productCity.placeholder = isPoland ? "WARSZAWA" : "KØBENHAVN";
  els.productPostal.placeholder = isPoland ? "00-001" : "1050";
  selectedShipping = null;
  selectedPickupPoint = null;
  quotes = [];
  parcelLockers = [];
  renderQuotes();
  togglePickupPicker();
});

els.productShippingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireSize() || !els.productShippingForm.reportValidity()) return;
  const submit = els.productShippingForm.querySelector("button[type=submit]");
  submit.disabled = true;
  selectedShipping = null;
  selectedPickupPoint = null;
  updatePaymentButton();
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
    parcelLockers = data?.parcelLockers || [];
    if (!quotes.length) throw new Error("No shipping methods");
    renderQuotes();
    togglePickupPicker();
    showMessage(els.productShippingMessage, "WYBIERZ PRZEWOŹNIKA.");
  } catch (error) {
    console.error(error);
    quotes = [];
    parcelLockers = [];
    renderQuotes();
    showMessage(els.productShippingMessage, "NIE UDAŁO SIĘ POBRAĆ METOD DOSTAWY.");
  } finally {
    submit.disabled = false;
  }
});

els.startPaymentButton.addEventListener("click", async () => {
  if (!requireSize() || !selectedShipping) return;
  if (selectedShipping.type === "parcel_locker" && !selectedPickupPoint) {
    showMessage(els.paymentMessage, "WYBIERZ PACZKOMAT.");
    return;
  }
  els.startPaymentButton.disabled = true;
  els.startPaymentButton.textContent = "PRZEKIEROWANIE DO STRIPE…";
  showMessage(els.paymentMessage, "");
  try {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        productSlug: PRODUCT.slug,
        size: selectedSize,
        quantity,
        shippingCountry: els.productCountry.value,
        shippingMethodId: selectedShipping.id,
        pickupPointCode: selectedPickupPoint?.code || null,
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Missing checkout URL");
    location.assign(data.url);
  } catch (error) {
    console.error(error);
    showMessage(els.paymentMessage, "NIE UDAŁO SIĘ OTWORZYĆ STRIPE. SPRÓBUJ PONOWNIE.");
    els.startPaymentButton.disabled = false;
    els.startPaymentButton.textContent = "PRZEJDŹ DO STRIPE";
  }
});

if (new URLSearchParams(location.search).get("payment") === "cancelled") {
  showMessage(els.paymentMessage, "PŁATNOŚĆ ANULOWANA — MOŻESZ SPRÓBOWAĆ PONOWNIE.");
  els.productCheckout.scrollIntoView({ block: "center" });
  history.replaceState({}, "", location.pathname);
}
