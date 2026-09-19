import "./styles.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { PRODUCT } from "./config.js";
import { supabase } from "./supabase.js";

const CART_KEY = "delusional-cart-v2";
const SHIPPING_KEY = "delusional-shipping-v1";
const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const countryViews = {
  PL: { label: "POLAND", center: [52.05, 19.15], zoom: 6, city: "WARSZAWA", postal: "00-001" },
  DK: { label: "DENMARK", center: [56.1, 9.5], zoom: 6, city: "KØBENHAVN", postal: "1050" },
};

const cityViews = {
  warszawa: [52.2297, 21.0122],
  krakow: [50.0647, 19.945],
  wroclaw: [51.1079, 17.0385],
  poznan: [52.4064, 16.9252],
  gdansk: [54.352, 18.6466],
  lodz: [51.7592, 19.456],
  københavn: [55.6761, 12.5683],
  kobenhavn: [55.6761, 12.5683],
  copenhagen: [55.6761, 12.5683],
  aarhus: [56.1629, 10.2039],
  odense: [55.4038, 10.4024],
  aalborg: [57.0488, 9.9217],
};

const els = Object.fromEntries([
  "addToCart", "cartCount", "cartDrawer", "cartBackdrop", "closeCart", "continueShopping",
  "cartEmpty", "cartContent", "cartSize", "cartQty", "lineTotal", "cartTotal",
  "shippingTotal", "decreaseQty", "increaseQty", "checkoutButton", "checkoutMessage",
  "shippingForm", "shippingCountry", "shippingCity", "shippingPostal", "shippingMessage",
  "shippingQuotes", "selectedShipping", "changeShipping", "mapLocation", "mapCaptionLabel", "toast",
  "pickupPicker", "pickupSelected", "pickupList",
].map((id) => [id, document.querySelector(`#${id}`)]));
els.cartTrigger = document.querySelector(".cart-trigger");
els.sizeButtons = [...document.querySelectorAll("[data-size]")];

let selectedSize = "";
let cart = readCart();
let shipping = readShipping();
let quotes = [];
let parcelLockers = [];

const map = L.map("shippingMap", {
  zoomControl: false,
  scrollWheelZoom: false,
  attributionControl: true,
}).setView(countryViews.PL.center, countryViews.PL.zoom);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "© OpenStreetMap",
}).addTo(map);
const destinationMarker = L.circleMarker(countryViews.PL.center, {
  radius: 9,
  color: "#15130f",
  weight: 2,
  fillColor: "#c2b39f",
  fillOpacity: 1,
}).addTo(map);
const pickupMarkers = L.layerGroup().addTo(map);

function normalizeCity(value) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function updateMap(country, city = "") {
  const view = countryViews[country] || countryViews.PL;
  const originalKey = city.trim().toLowerCase();
  const point = cityViews[originalKey] || cityViews[normalizeCity(city)] || view.center;
  const zoom = cityViews[originalKey] || cityViews[normalizeCity(city)] ? 11 : view.zoom;
  destinationMarker.setLatLng(point);
  map.flyTo(point, zoom, { duration: 0.8 });
  els.mapLocation.textContent = city ? `${city.toUpperCase()}, ${country}` : view.label;
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    if (!parsed || !PRODUCT.sizes.includes(parsed.size)) return null;
    return { size: parsed.size, quantity: Math.max(1, Math.min(10, Number(parsed.quantity) || 1)) };
  } catch {
    return null;
  }
}

function readShipping() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHIPPING_KEY));
    if (!parsed?.id || !["PL", "DK"].includes(parsed.country)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCart() {
  if (cart) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  else localStorage.removeItem(CART_KEY);
  renderCart();
}

function saveShipping() {
  if (shipping) localStorage.setItem(SHIPPING_KEY, JSON.stringify(shipping));
  else localStorage.removeItem(SHIPPING_KEY);
  renderCart();
}

function renderCart() {
  const quantity = cart?.quantity || 0;
  els.cartCount.textContent = String(quantity);
  els.cartEmpty.hidden = Boolean(cart);
  els.cartContent.hidden = !cart;
  if (!cart) return;

  const subtotal = PRODUCT.price * cart.quantity;
  const shippingAmount = shipping ? Number(shipping.amount) : 0;
  els.cartSize.textContent = cart.size;
  els.cartQty.textContent = String(cart.quantity);
  els.lineTotal.textContent = money.format(subtotal);
  els.selectedShipping.textContent = shipping
    ? `${shipping.carrier} / ${shipping.service}${shipping.pickupPoint ? ` / ${shipping.pickupPoint.code}` : ""}`
    : "CALCULATE SHIPPING →";
  els.shippingTotal.textContent = shipping
    ? (shippingAmount === 0 ? "FREE" : money.format(shippingAmount))
    : "—";
  els.cartTotal.textContent = money.format(subtotal + shippingAmount);
}

function openCart() {
  els.cartDrawer.classList.add("is-open");
  els.cartBackdrop.hidden = false;
  requestAnimationFrame(() => els.cartBackdrop.classList.add("is-open"));
  els.cartDrawer.setAttribute("aria-hidden", "false");
  els.cartTrigger.setAttribute("aria-expanded", "true");
  document.body.classList.add("no-scroll");
  els.closeCart.focus();
}

function closeCart() {
  els.cartDrawer.classList.remove("is-open");
  els.cartBackdrop.classList.remove("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
  els.cartTrigger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("no-scroll");
  setTimeout(() => { els.cartBackdrop.hidden = true; }, 250);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function renderQuotes() {
  els.shippingQuotes.replaceChildren();
  for (const quote of quotes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shipping-quote";
    button.classList.toggle("selected", shipping?.id === quote.id);
    button.innerHTML = `
      <span class="carrier-name">${escapeHtml(quote.carrier)}</span>
      <span class="carrier-service">${escapeHtml(quote.service)} · ${quote.minDays}–${quote.maxDays} DAYS</span>
      <strong>${quote.amount === 0 ? "FREE" : money.format(quote.amount)}</strong>
      <i aria-hidden="true"></i>`;
    button.addEventListener("click", () => {
      shipping = {
        ...quote,
        country: els.shippingCountry.value,
        city: els.shippingCity.value.trim(),
        postalCode: els.shippingPostal.value.trim(),
        pickupPoint: null,
      };
      saveShipping();
      renderQuotes();
      renderPickupPicker();
      showToast(quote.type === "parcel_locker" ? "SELECT A PARCEL LOCKER" : `${quote.carrier.toUpperCase()} SELECTED`);
    });
    els.shippingQuotes.append(button);
  }
}

function selectPickupPoint(point) {
  if (!shipping || shipping.type !== "parcel_locker") return;
  shipping.pickupPoint = point;
  saveShipping();
  renderPickupPicker();
  showToast(`${point.code} SELECTED`);
}

function renderPickupPicker() {
  const needsPickup = shipping?.type === "parcel_locker";
  els.pickupPicker.hidden = !needsPickup;
  pickupMarkers.clearLayers();
  if (!needsPickup) {
    els.mapCaptionLabel.textContent = "DELIVERY AREA";
    return;
  }

  els.pickupSelected.textContent = shipping.pickupPoint
    ? `${shipping.pickupPoint.code} · ${shipping.pickupPoint.address}`
    : "NIE WYBRANO";
  els.pickupList.replaceChildren();
  const bounds = [];
  for (const point of parcelLockers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pickup-point";
    button.classList.toggle("selected", shipping.pickupPoint?.code === point.code);
    button.innerHTML = `<strong>${escapeHtml(point.code)}</strong><span>${escapeHtml(point.address)}, ${escapeHtml(point.postalCode)} ${escapeHtml(point.city)}</span><i aria-hidden="true"></i>`;
    button.addEventListener("click", () => selectPickupPoint(point));
    els.pickupList.append(button);

    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: shipping.pickupPoint?.code === point.code ? 10 : 7,
      color: "#171612",
      weight: 2,
      fillColor: shipping.pickupPoint?.code === point.code ? "#171612" : "#c2b39f",
      fillOpacity: 1,
    }).addTo(pickupMarkers);
    marker.bindTooltip(`${escapeHtml(point.code)} · ${escapeHtml(point.address)}`);
    marker.on("click", () => selectPickupPoint(point));
    bounds.push([point.latitude, point.longitude]);
  }
  if (!parcelLockers.length) {
    els.pickupList.innerHTML = "<p class=\"shipping-message\">NIE ZNALEZIONO PUNKTÓW. WPISZ PONOWNIE MIASTO.</p>";
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
  els.mapCaptionLabel.textContent = "PICKUP POINTS";
  els.mapLocation.textContent = shipping.pickupPoint?.code || `${parcelLockers.length} PACZKOMATÓW`;
}

async function calculateShipping({ silent = false } = {}) {
  if (!els.shippingForm.reportValidity()) return;
  const country = els.shippingCountry.value;
  const city = els.shippingCity.value.trim();
  const postalCode = els.shippingPostal.value.trim();
  const subtotal = PRODUCT.price * (cart?.quantity || 1);
  const submit = els.shippingForm.querySelector("button[type=submit]");
  submit.disabled = true;
  if (!silent) els.shippingMessage.textContent = "CALCULATING…";

  try {
    const { data, error } = await supabase.functions.invoke("shipping-quotes", {
      body: { country, city, postalCode, subtotal },
    });
    if (error) throw error;
    quotes = data?.quotes || [];
    parcelLockers = data?.parcelLockers || [];
    if (!quotes.length) throw new Error("No delivery methods");

    if (shipping) {
      const refreshed = quotes.find((quote) => quote.id === shipping.id);
      shipping = refreshed ? { ...shipping, ...refreshed, country, city, postalCode } : null;
      if (shipping?.type === "parcel_locker" && shipping.pickupPoint) {
        shipping.pickupPoint = parcelLockers.find((point) => point.code === shipping.pickupPoint.code) || null;
      }
      saveShipping();
    }

    renderQuotes();
    updateMap(country, city);
    renderPickupPicker();
    els.shippingMessage.textContent = "SELECT A DELIVERY METHOD.";
  } catch (error) {
    console.error(error);
    quotes = [];
    parcelLockers = [];
    renderQuotes();
    renderPickupPicker();
    els.shippingMessage.textContent = "DELIVERY QUOTES ARE TEMPORARILY UNAVAILABLE.";
  } finally {
    submit.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

els.sizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedSize = button.dataset.size;
    els.sizeButtons.forEach((item) => item.classList.toggle("selected", item === button));
  });
});

els.addToCart.addEventListener("click", () => {
  if (!selectedSize) {
    showToast("SELECT SIZE");
    document.querySelector("#sizeOptions").classList.add("attention");
    setTimeout(() => document.querySelector("#sizeOptions").classList.remove("attention"), 600);
    return;
  }
  if (cart?.size === selectedSize) cart.quantity = Math.min(10, cart.quantity + 1);
  else cart = { size: selectedSize, quantity: 1 };
  saveCart();
  openCart();
});

els.cartTrigger.addEventListener("click", openCart);
els.closeCart.addEventListener("click", closeCart);
els.continueShopping.addEventListener("click", () => {
  closeCart();
  document.querySelector("#products").scrollIntoView({ behavior: "smooth" });
});
els.cartBackdrop.addEventListener("click", closeCart);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCart(); });

els.decreaseQty.addEventListener("click", async () => {
  if (!cart) return;
  cart.quantity -= 1;
  if (cart.quantity < 1) cart = null;
  saveCart();
  if (cart && shipping) await calculateShipping({ silent: true });
});

els.increaseQty.addEventListener("click", async () => {
  if (!cart) return;
  cart.quantity = Math.min(10, cart.quantity + 1);
  saveCart();
  if (shipping) await calculateShipping({ silent: true });
});

els.changeShipping.addEventListener("click", () => {
  closeCart();
  document.querySelector("#shipping").scrollIntoView({ behavior: "smooth" });
});

els.shippingCountry.addEventListener("change", () => {
  const view = countryViews[els.shippingCountry.value];
  els.shippingCity.placeholder = view.city;
  els.shippingPostal.placeholder = view.postal;
  quotes = [];
  parcelLockers = [];
  shipping = null;
  saveShipping();
  renderQuotes();
  renderPickupPicker();
  updateMap(els.shippingCountry.value);
});

els.shippingCity.addEventListener("change", () => updateMap(els.shippingCountry.value, els.shippingCity.value));
els.shippingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await calculateShipping();
});

els.checkoutButton.addEventListener("click", async () => {
  if (!cart) return;
  if (!shipping) {
    els.checkoutMessage.textContent = "SELECT A DELIVERY METHOD FIRST.";
    setTimeout(() => {
      closeCart();
      document.querySelector("#shipping").scrollIntoView({ behavior: "smooth" });
    }, 700);
    return;
  }
  if (shipping.type === "parcel_locker" && !shipping.pickupPoint) {
    els.checkoutMessage.textContent = "SELECT A PARCEL LOCKER FIRST.";
    setTimeout(() => {
      closeCart();
      document.querySelector("#shipping").scrollIntoView({ behavior: "smooth" });
    }, 700);
    return;
  }

  els.checkoutButton.disabled = true;
  els.checkoutButton.textContent = "PREPARING CHECKOUT…";
  els.checkoutMessage.textContent = "";
  try {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        productSlug: PRODUCT.slug,
        size: cart.size,
        quantity: cart.quantity,
        shippingCountry: shipping.country,
        shippingMethodId: shipping.id,
        pickupPointCode: shipping.pickupPoint?.code || null,
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Missing checkout URL");
    location.assign(data.url);
  } catch (error) {
    console.error(error);
    els.checkoutMessage.textContent = "PAYMENTS ARE STILL BEING CONFIGURED.";
    els.checkoutButton.disabled = false;
    els.checkoutButton.textContent = "CHECKOUT";
  }
});

const paymentState = new URLSearchParams(location.search).get("payment");
if (paymentState === "success") {
  cart = null;
  saveCart();
  showToast("PAYMENT ACCEPTED — THANK YOU");
  history.replaceState({}, "", location.pathname);
} else if (paymentState === "cancelled") {
  showToast("PAYMENT CANCELLED — YOUR BAG IS SAVED");
  history.replaceState({}, "", location.pathname);
}

if (shipping) {
  els.shippingCountry.value = shipping.country;
  els.shippingCity.value = shipping.city || "";
  els.shippingPostal.value = shipping.postalCode || "";
  updateMap(shipping.country, shipping.city);
  calculateShipping({ silent: true });
}
renderCart();
renderPickupPicker();
