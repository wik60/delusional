import "./minimal-home.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { PRODUCT } from "./config.js";
import { supabase } from "./supabase.js";


const siteLoader = document.querySelector("#siteLoader");
const loaderStartedAt = performance.now();

function dismissSiteLoader() {
  if (!siteLoader || siteLoader.classList.contains("is-leaving")) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const minimumVisible = reducedMotion ? 120 : 1150;
  const delay = Math.max(0, minimumVisible - (performance.now() - loaderStartedAt));

  window.setTimeout(() => {
    siteLoader.classList.add("is-leaving");
    window.setTimeout(() => siteLoader.remove(), reducedMotion ? 180 : 600);
  }, delay);
}

if (document.readyState === "complete") dismissSiteLoader();
else window.addEventListener("load", dismissSiteLoader, { once: true });

window.setTimeout(dismissSiteLoader, 2600);

const CART_KEY = "delusional-cart-v3";
const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "PLN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const els = Object.fromEntries([
  "cartTrigger","cartCount","cartHeaderCount","cartDrawer","cartBackdrop","closeCart","continueShopping",
  "cartEmpty","cartContent","cartSize","cartQty","lineTotal","cartSubtotal","shippingTotal","cartTotal",
  "cartQtyDown","cartQtyUp","shippingForm","shippingName","shippingEmail","shippingPhone","shippingCountry","shippingAddress1","shippingAddress2","shippingCity","shippingPostal","shippingMessage",
  "shippingOptionsStep","shippingQuotes","pickupPicker","pickupSelected","pickupMap","pickupList","checkoutButton",
  "checkoutMessage","sizeGuideToggle","sizeGuide","qtyDown","qtyUp","qtyValue","addToCart","productMessage",
  "frontImage","backImage","prevImage","nextImage","imageStage","toast",
].map((id) => [id, document.querySelector(`#${id}`)]));

const sizeButtons = [...document.querySelectorAll("[data-size]")];
const viewButtons = [...document.querySelectorAll("[data-view]")];

let selectedSize = "";
let quantity = 1;
let activeView = "front";
let cart = readCart();
let quotes = [];
let parcelLockers = [];
let selectedShipping = null;
let selectedPickup = null;
let pickupMap = null;
let pickupMarkers = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    if (!parsed || !PRODUCT.sizes.includes(parsed.size)) return null;
    return {
      size: parsed.size,
      quantity: Math.max(1, Math.min(10, Number(parsed.quantity) || 1)),
    };
  } catch {
    return null;
  }
}

function saveCart() {
  if (cart) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  else localStorage.removeItem(CART_KEY);
  renderCart();
}

function showMessage(element, message) {
  if (element) element.textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}

function resetDelivery() {
  selectedShipping = null;
  selectedPickup = null;
  quotes = [];
  parcelLockers = [];
  els.shippingQuotes.replaceChildren();
  els.shippingOptionsStep.hidden = true;
  els.pickupPicker.hidden = true;
  showMessage(els.shippingMessage, "");
  showMessage(els.checkoutMessage, "");
  renderCart();
}

function renderCart() {
  const count = cart?.quantity || 0;
  els.cartCount.textContent = String(count);
  els.cartHeaderCount.textContent = `${count} ${count === 1 ? "ITEM" : "ITEMS"}`;
  els.cartEmpty.hidden = Boolean(cart);
  els.cartContent.hidden = !cart;
  if (!cart) return;

  const subtotal = PRODUCT.price * cart.quantity;
  const delivery = selectedShipping ? Number(selectedShipping.amount) : 0;
  els.cartSize.textContent = cart.size;
  els.cartQty.textContent = String(cart.quantity);
  els.lineTotal.textContent = money.format(subtotal);
  els.cartSubtotal.textContent = money.format(subtotal);
  els.shippingTotal.textContent = selectedShipping
    ? (delivery === 0 ? "FREE" : money.format(delivery))
    : "—";
  els.cartTotal.textContent = money.format(subtotal + delivery);
  els.checkoutButton.disabled = !selectedShipping || (selectedShipping.type === "parcel_locker" && !selectedPickup);
}

function openCart() {
  els.cartDrawer.classList.add("is-open");
  els.cartBackdrop.hidden = false;
  requestAnimationFrame(() => els.cartBackdrop.classList.add("is-open"));
  els.cartDrawer.setAttribute("aria-hidden", "false");
  els.cartTrigger.setAttribute("aria-expanded", "true");
  document.body.classList.add("no-scroll");
  setTimeout(() => els.closeCart.focus(), 150);
}

function closeCart() {
  els.cartDrawer.classList.remove("is-open");
  els.cartBackdrop.classList.remove("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
  els.cartTrigger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("no-scroll");
  setTimeout(() => { els.cartBackdrop.hidden = true; }, 280);
}

function setView(view) {
  activeView = view;
  els.frontImage.classList.toggle("is-active", view === "front");
  els.backImage.classList.toggle("is-active", view === "back");
  viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function animateToCart() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const source = activeView === "front" ? els.frontImage : els.backImage;
  const from = source.getBoundingClientRect();
  const to = els.cartTrigger.getBoundingClientRect();
  const clone = source.cloneNode();
  clone.className = "fly-item";
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  clone.style.width = `${Math.min(from.width, 190)}px`;
  clone.style.height = `${Math.min(from.height, 190)}px`;
  document.body.append(clone);

  const startX = from.left;
  const startY = from.top;
  const endX = to.left + to.width / 2 - Math.min(from.width, 190) / 2;
  const endY = to.top + to.height / 2 - Math.min(from.height, 190) / 2;

  const animation = clone.animate([
    { transform: "translate(0,0) scale(1)", opacity: .88, borderRadius: "0" },
    { transform: `translate(${(endX-startX)*.55}px,${(endY-startY)*.35}px) scale(.55)`, opacity: .78, borderRadius: "50%" },
    { transform: `translate(${endX-startX}px,${endY-startY}px) scale(.08)`, opacity: 0, borderRadius: "50%" },
  ], { duration: 720, easing: "cubic-bezier(.22,1,.36,1)" });

  animation.finished.finally(() => clone.remove());
  setTimeout(() => {
    els.cartTrigger.classList.add("is-pulsing");
    setTimeout(() => els.cartTrigger.classList.remove("is-pulsing"), 300);
  }, 560);
}

function requireSize() {
  if (selectedSize) return true;
  showMessage(els.productMessage, "SELECT A SIZE FIRST.");
  sizeButtons.forEach((button) => button.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
    { duration: 260 },
  ));
  return false;
}

function renderQuotes() {
  els.shippingQuotes.replaceChildren();
  for (const quote of quotes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shipping-quote";
    button.classList.toggle("selected", selectedShipping?.id === quote.id);
    button.innerHTML = `
      <span><strong>${escapeHtml(quote.carrier)}</strong><small>${escapeHtml(quote.service)} · ${quote.minDays}–${quote.maxDays} DAYS</small></span>
      <b>${quote.amount === 0 ? "FREE" : money.format(quote.amount)}</b>`;
    button.addEventListener("click", () => {
      selectedShipping = quote;
      selectedPickup = null;
      renderQuotes();
      renderPickupPicker();
      renderCart();
      showMessage(els.shippingMessage, quote.type === "parcel_locker"
        ? "SELECT A PARCEL LOCKER BELOW."
        : `${quote.carrier.toUpperCase()} SELECTED.`);
    });
    els.shippingQuotes.append(button);
  }
}

function initPickupMap() {
  if (pickupMap) return;
  pickupMap = L.map(els.pickupMap, { scrollWheelZoom: false, zoomControl: true }).setView([52.2297, 21.0122], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap",
  }).addTo(pickupMap);
  pickupMarkers = L.layerGroup().addTo(pickupMap);
}

function choosePickup(point) {
  selectedPickup = point;
  els.pickupSelected.textContent = `${point.code} · ${point.address}`;
  renderPickupPicker();
  renderCart();
  showMessage(els.shippingMessage, `PARCEL LOCKER ${point.code} SELECTED.`);
}

function renderPickupPicker() {
  const needsPickup = selectedShipping?.type === "parcel_locker";
  els.pickupPicker.hidden = !needsPickup;
  if (!needsPickup) {
    selectedPickup = null;
    renderCart();
    return;
  }

  els.pickupList.replaceChildren();
  if (!parcelLockers.length) {
    els.pickupList.innerHTML = '<p class="form-message">NO PARCEL LOCKERS FOUND. CHECK THE CITY AND POSTAL CODE.</p>';
    return;
  }

  for (const point of parcelLockers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pickup-point";
    button.classList.toggle("selected", selectedPickup?.code === point.code);
    const distance = Number.isFinite(Number(point.distanceKm)) ? ` · ${Number(point.distanceKm).toFixed(1)} KM` : "";\n    const nearest = parcelLockers[0]?.code === point.code ? " · NEAREST" : "";\n    button.innerHTML = `<span><strong>${escapeHtml(point.code)}${nearest}</strong><br>${escapeHtml(point.address)}, ${escapeHtml(point.postalCode)} ${escapeHtml(point.city)}${distance}</span><b>${selectedPickup?.code === point.code ? "SELECTED" : "SELECT"}</b>`;
    button.addEventListener("click", () => choosePickup(point));
    els.pickupList.append(button);
  }

  initPickupMap();
  pickupMarkers.clearLayers();
  const bounds = [];
  for (const point of parcelLockers) {
    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: selectedPickup?.code === point.code ? 9 : 7,
      color: "#000",
      weight: 2,
      fillColor: selectedPickup?.code === point.code ? "#000" : "#fff",
      fillOpacity: 1,
    }).addTo(pickupMarkers);
    marker.bindTooltip(`${escapeHtml(point.code)} · ${escapeHtml(point.address)}`);
    marker.on("click", () => choosePickup(point));
    bounds.push([point.latitude, point.longitude]);
  }
  if (bounds.length) pickupMap.fitBounds(bounds, { padding: [18,18], maxZoom: 13 });
  setTimeout(() => pickupMap.invalidateSize(), 80);
}

sizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedSize = button.dataset.size;
    sizeButtons.forEach((item) => item.classList.toggle("active", item === button));
    showMessage(els.productMessage, "");
  });
});

viewButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
els.prevImage.addEventListener("click", () => setView(activeView === "front" ? "back" : "front"));
els.nextImage.addEventListener("click", () => setView(activeView === "front" ? "back" : "front"));
els.imageStage.addEventListener("mouseenter", () => setView("back"));
els.imageStage.addEventListener("mouseleave", () => setView("front"));
els.imageStage.addEventListener("dblclick", () => setView(activeView === "front" ? "back" : "front"));

els.sizeGuideToggle.addEventListener("click", () => {
  const opening = els.sizeGuide.hidden;
  els.sizeGuide.hidden = !opening;
  els.sizeGuideToggle.setAttribute("aria-expanded", String(opening));
  els.sizeGuideToggle.querySelector("span").textContent = opening ? "−" : "+";
});

els.qtyDown.addEventListener("click", () => {
  quantity = Math.max(1, quantity - 1);
  els.qtyValue.textContent = String(quantity);
});
els.qtyUp.addEventListener("click", () => {
  quantity = Math.min(10, quantity + 1);
  els.qtyValue.textContent = String(quantity);
});

els.addToCart.addEventListener("click", () => {
  if (!requireSize()) return;
  cart = { size: selectedSize, quantity };
  resetDelivery();
  saveCart();
  animateToCart();
  showToast("ADDED TO BAG");
  showMessage(els.productMessage, "ADDED TO BAG.");
  setTimeout(openCart, 540);
});

els.cartTrigger.addEventListener("click", openCart);
els.closeCart.addEventListener("click", closeCart);
els.cartBackdrop.addEventListener("click", closeCart);
els.continueShopping.addEventListener("click", closeCart);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.cartDrawer.classList.contains("is-open")) closeCart();
});

els.cartQtyDown.addEventListener("click", () => {
  if (!cart) return;
  cart.quantity = Math.max(1, cart.quantity - 1);
  resetDelivery();
  saveCart();
});
els.cartQtyUp.addEventListener("click", () => {
  if (!cart) return;
  cart.quantity = Math.min(10, cart.quantity + 1);
  resetDelivery();
  saveCart();
});

els.shippingCountry.addEventListener("change", () => {
  const poland = els.shippingCountry.value === "PL";
  els.shippingCity.placeholder = poland ? "WARSAW" : "COPENHAGEN";
  els.shippingPostal.placeholder = poland ? "00-001" : "1050";
  resetDelivery();
});

els.shippingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!cart || !els.shippingForm.reportValidity()) return;

  const submit = els.shippingForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  resetDelivery();
  showMessage(els.shippingMessage, "CALCULATING…");

  try {
    const { data, error } = await supabase.functions.invoke("shipping-quotes", {
      body: {
        country: els.shippingCountry.value,
        city: els.shippingCity.value.trim(),
        postalCode: els.shippingPostal.value.trim(),
        subtotal: PRODUCT.price * cart.quantity,
      },
    });
    if (error) throw error;
    quotes = data?.quotes || [];
    parcelLockers = data?.parcelLockers || [];
    if (!quotes.length) throw new Error("No delivery options");
    els.shippingOptionsStep.hidden = false;
    renderQuotes();
    showMessage(els.shippingMessage, "SELECT A DELIVERY METHOD.");
  } catch (error) {
    console.error(error);
    showMessage(els.shippingMessage, "DELIVERY OPTIONS COULD NOT BE LOADED. TRY AGAIN.");
  } finally {
    submit.disabled = false;
  }
});

els.checkoutButton.addEventListener("click", async () => {
  if (!cart || !selectedShipping) return;
  if (selectedShipping.type === "parcel_locker" && !selectedPickup) {
    showMessage(els.checkoutMessage, "SELECT A PARCEL LOCKER FIRST.");
    return;
  }

  els.checkoutButton.disabled = true;
  els.checkoutButton.textContent = "OPENING STRIPE…";
  showMessage(els.checkoutMessage, "");

  try {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        productSlug: PRODUCT.slug,
        size: cart.size,
        quantity: cart.quantity,
        shippingCountry: els.shippingCountry.value,
        shippingMethodId: selectedShipping.id,
        pickupPointCode: selectedPickup?.code || null,
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Missing Stripe URL");
    location.assign(data.url);
  } catch (error) {
    console.error(error);
    showMessage(els.checkoutMessage, "STRIPE COULD NOT BE OPENED. TRY AGAIN.");
    els.checkoutButton.disabled = false;
    els.checkoutButton.textContent = "CONTINUE TO STRIPE";
  }
});

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }
}, { threshold: .14, rootMargin: "0px 0px -40px 0px" });

document.querySelectorAll("[data-reveal]").forEach((element, index) => {
  element.style.transitionDelay = `${Math.min(index * 55, 220)}ms`;
  observer.observe(element);
});

if (cart) {
  selectedSize = cart.size;
  quantity = cart.quantity;
  els.qtyValue.textContent = String(quantity);
  sizeButtons.forEach((button) => button.classList.toggle("active", button.dataset.size === selectedSize));
}

if (new URLSearchParams(location.search).get("payment") === "cancelled") {
  showToast("PAYMENT CANCELLED");
  history.replaceState({}, "", location.pathname);
  setTimeout(openCart, 350);
}

renderCart();
