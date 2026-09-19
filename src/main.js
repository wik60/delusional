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
  "frontImage","backImage","cartProductImage","prevImage","nextImage","imageStage","toast", "productName",
  "productCode", "productDescription", "currentPrice", "comparePrice", "announcement",
  "sizeOptions", "cartProductName", "catalogSection", "catalogGrid", "newsletterSection",
  "newsletterForm", "newsletterEmail", "newsletterCompany", "newsletterMessage", "viewDots",
].map((id) => [id, document.querySelector(`#${id}`)]));

let sizeButtons = [...document.querySelectorAll("[data-size]")];
const requestedSlug = new URLSearchParams(location.search).get("product") || PRODUCT.slug;

let selectedSize = "";
let quantity = 1;
let activeImageIndex = 0;
let cart = readCart();
let quotes = [];
let parcelLockers = [];
let selectedShipping = null;
let selectedPickup = null;
let deliveryOrigin = null;
let pickupMap = null;
let pickupMarkers = null;
let inventoryLoaded = false;
let variantStocks = new Map();

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    if (!parsed || typeof parsed.size !== "string") return null;
    return {
      productSlug: parsed.productSlug || PRODUCT.slug,
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

function availableStock(size) {
  if (!inventoryLoaded) return 10;
  return Math.max(0, Number(variantStocks.get(size) || 0));
}

function maxQuantity(size) {
  return Math.min(10, availableStock(size));
}

function reconcileInventory() {
  sizeButtons.forEach((button) => {
    const stock = availableStock(button.dataset.size);
    button.disabled = stock < 1;
    button.classList.toggle("sold-out", stock < 1);
    button.title = stock < 1 ? "SOLD OUT" : `${stock} AVAILABLE`;
    button.setAttribute("aria-label", `${button.dataset.size}${stock < 1 ? " — sold out" : ` — ${stock} available`}`);
  });

  if (selectedSize && availableStock(selectedSize) < 1) {
    selectedSize = "";
    quantity = 1;
    els.qtyValue.textContent = "1";
    sizeButtons.forEach((button) => button.classList.remove("active"));
  } else if (selectedSize) {
    quantity = Math.max(1, Math.min(quantity, maxQuantity(selectedSize)));
    els.qtyValue.textContent = String(quantity);
  }

  if (cart) {
    const maximum = maxQuantity(cart.size);
    if (maximum < 1) {
      cart = null;
      localStorage.removeItem(CART_KEY);
      resetDelivery();
      showToast("ITEM SOLD OUT");
    } else if (cart.quantity > maximum) {
      cart.quantity = maximum;
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      resetDelivery();
      showToast("CART UPDATED TO AVAILABLE STOCK");
    }
  }

  renderCart();
}

async function loadCatalog() {
  const [{ data: product, error }, { data: catalog }] = await Promise.all([
    supabase
    .from("products")
    .select("slug, name, description, price, compare_at_price, currency, size_guide, gallery_images, front_image_url, back_image_url, image_url, product_variants(size, stock, reserved_stock, active)")
    .eq("slug", requestedSlug)
    .single(),
    supabase
      .from("products")
      .select("slug, name, price, currency, gallery_images, image_url, front_image_url, back_image_url")
      .order("created_at", { ascending: true }),
  ]);

  if (error || !product) {
    console.error("catalog", error);
    showMessage(els.productMessage, "PRODUCT COULD NOT BE LOADED.");
    return;
  }

  PRODUCT.slug = product.slug;
  PRODUCT.name = product.name;
  PRODUCT.price = Number(product.price);
  PRODUCT.compareAtPrice = product.compare_at_price == null ? null : Number(product.compare_at_price);
  PRODUCT.currency = product.currency;
  PRODUCT.sizes = (product.product_variants || []).filter((variant) => variant.active).map((variant) => variant.size);

  els.productName.textContent = product.name;
  els.cartProductName.textContent = product.name;
  els.productDescription.textContent = product.description || "";
  els.currentPrice.textContent = `${PRODUCT.price.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} ${PRODUCT.currency}`;
  els.comparePrice.hidden = PRODUCT.compareAtPrice == null;
  els.comparePrice.textContent = PRODUCT.compareAtPrice == null
    ? ""
    : `${PRODUCT.compareAtPrice.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} ${PRODUCT.currency}`;
  els.addToCart.textContent = `ADD TO CART — ${PRODUCT.price.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} ${PRODUCT.currency}`;
  els.announcement.textContent = `${product.name} — AVAILABLE NOW`;
  document.title = `${product.name} — DELUSIONALCREW`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", `${product.name} — Delusional Crew.`);

  const activeCatalog = catalog || [];
  const productIndex = Math.max(0, activeCatalog.findIndex((item) => item.slug === product.slug));
  els.productCode.textContent = `DELUSIONAL / ${String(productIndex + 1).padStart(3, "0")}`;
  renderHomepageProducts(activeCatalog);

  els.sizeOptions.replaceChildren();
  for (const variant of (product.product_variants || []).filter((item) => item.active)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.size = variant.size;
    button.textContent = variant.size;
    els.sizeOptions.append(button);
  }
  sizeButtons = [...els.sizeOptions.querySelectorAll("[data-size]")];
  bindSizeButtons();

  els.sizeGuide.replaceChildren();
  const sizeGuide = Array.isArray(product.size_guide) ? product.size_guide : [];
  for (const row of sizeGuide) {
    const line = document.createElement("div");
    const size = document.createElement("span");
    size.textContent = row.size || "—";
    const measurements = document.createElement("span");
    measurements.textContent = [row.chest, row.length, row.sleeve].filter(Boolean).join(" / ") + " CM";
    line.append(size, measurements);
    els.sizeGuide.append(line);
  }
  if (sizeGuide.length) {
    const legend = document.createElement("small");
    legend.textContent = "CHEST / LENGTH / SLEEVE";
    els.sizeGuide.append(legend);
  }
  els.sizeGuideToggle.hidden = sizeGuide.length === 0;

  const gallery = productGalleryImages(product);
  els.imageStage.querySelectorAll(".product-shot").forEach((shot) => shot.remove());

  const shots = gallery.map((url, index) => {
    const image = document.createElement("img");
    image.className = `product-shot${index === 0 ? " is-active" : ""}`;
    image.src = url;
    image.alt = `${product.name} — image ${index + 1}`;
    els.imageStage.insertBefore(image, els.prevImage);
    return image;
  });

  els.frontImage = shots[0] || null;
  els.backImage = shots[1] || null;
  els.cartProductImage.src = gallery[0] || "./images/brand-mark.png";
  els.cartProductImage.alt = product.name;
  setImage(0);

  if (cart && cart.productSlug !== PRODUCT.slug) {
    cart = null;
    localStorage.removeItem(CART_KEY);
    resetDelivery();
    showToast("CART CLEARED FOR SELECTED PRODUCT");
  }

  variantStocks = new Map((product.product_variants || []).map((variant) => [
    variant.size,
    variant.active ? Math.max(0, Number(variant.stock) - Number(variant.reserved_stock || 0)) : 0,
  ]));
  inventoryLoaded = true;
  if (cart && PRODUCT.sizes.includes(cart.size)) {
    selectedSize = cart.size;
    quantity = cart.quantity;
    els.qtyValue.textContent = String(quantity);
    sizeButtons.forEach((button) => button.classList.toggle("active", button.dataset.size === selectedSize));
  }
  reconcileInventory();
}

function productGalleryImages(item) {
  if (Array.isArray(item.gallery_images)) {
    return item.gallery_images.filter((url) => typeof url === "string" && url.trim());
  }

  const classic = item.slug === "delusional-classic-zip-up";
  const legacy = [
    item.front_image_url || item.image_url || (classic ? "./images/classic-zip-front.jpg" : ""),
    item.back_image_url || (classic ? "./images/classic-zip-back.jpg" : ""),
  ].filter(Boolean);

  return [...new Set(legacy)];
}

function productImage(item, side) {
  const gallery = productGalleryImages(item);
  if (side === "front") return gallery[0] || "./images/brand-mark.png";
  return gallery[1] || gallery[0] || "./images/brand-mark.png";
}

function renderHomepageProducts(catalog) {
  const showCatalog = catalog.length > 1;
  els.catalogSection.hidden = !showCatalog;
  els.newsletterSection.hidden = showCatalog;
  els.catalogGrid.replaceChildren();

  if (!showCatalog) return;

  for (const item of catalog) {
    const link = document.createElement("a");
    link.className = "catalog-tile";
    link.href = `./index.html?product=${encodeURIComponent(item.slug)}`;
    link.setAttribute("aria-label", `${item.name} — ${item.price} ${item.currency}`);

    const frontUrl = productImage(item, "front");
    const backUrl = productImage(item, "back");
    const primaryUrl = frontUrl || backUrl || "./images/brand-mark.png";

    const front = document.createElement("img");
    front.className = "catalog-image catalog-image-front";
    front.src = primaryUrl;
    front.alt = `${item.name} — front`;

    const back = document.createElement("img");
    back.className = "catalog-image catalog-image-back";
    back.src = backUrl || primaryUrl;
    back.alt = `${item.name} — back`;

    const price = document.createElement("span");
    price.className = "catalog-price";
    price.textContent = `${Number(item.price).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} ${item.currency}`;

    link.append(front, back, price);
    els.catalogGrid.append(link);
  }
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
  deliveryOrigin = null;
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
  const cartAvailable = availableStock(cart.size) >= cart.quantity;
  els.checkoutButton.disabled = !cartAvailable || !selectedShipping || (selectedShipping.type === "parcel_locker" && !selectedPickup);
  if (!cartAvailable) showMessage(els.checkoutMessage, "THE SELECTED QUANTITY IS NO LONGER AVAILABLE.");
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

function getProductShots() {
  return [...els.imageStage.querySelectorAll(".product-shot")]
    .filter((shot) => !shot.hidden && Boolean(shot.getAttribute("src")));
}

function renderImageDots() {
  if (!els.viewDots) return;
  const shots = getProductShots();
  els.viewDots.replaceChildren();
  els.prevImage.hidden = shots.length <= 1;
  els.nextImage.hidden = shots.length <= 1;

  shots.forEach((_, index) => {
    const dot = document.createElement("span");
    dot.className = "view-dot";
    dot.classList.toggle("active", index === activeImageIndex);
    dot.setAttribute("aria-hidden", "true");
    els.viewDots.append(dot);
  });
}

function setImage(index) {
  const shots = getProductShots();
  if (!shots.length) {
    activeImageIndex = 0;
    renderImageDots();
    return;
  }

  activeImageIndex = ((index % shots.length) + shots.length) % shots.length;

  shots.forEach((shot, shotIndex) => {
    shot.classList.toggle("is-active", shotIndex === activeImageIndex);
  });

  renderImageDots();
}

function animateToCart() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const source = getProductShots()[activeImageIndex] || els.cartProductImage;
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
      selectedPickup = quote.type === "parcel_locker" ? (parcelLockers[0] || null) : null;
      renderQuotes();
      renderPickupPicker();
      renderCart();
      showMessage(els.shippingMessage, quote.type === "parcel_locker"
        ? (selectedPickup
          ? `NEAREST PARCEL LOCKER PROPOSED: ${selectedPickup.code}. YOU CAN CHANGE IT BELOW.`
          : "NO PARCEL LOCKER FOUND NEAR THIS ADDRESS.")
        : `${quote.carrier.toUpperCase()} SELECTED.`);
    });
    els.shippingQuotes.append(button);
  }
}

function initPickupMap() {
  if (pickupMap) return;
  pickupMap = L.map(els.pickupMap, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true }).setView([52.2297, 21.0122], 11);
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
    els.pickupSelected.textContent = "NO ACTIVE PARCEL LOCKERS FOUND";
    els.pickupList.innerHTML = '<p class="form-message">NO PARCEL LOCKERS FOUND. CHECK THE ADDRESS OR CITY.</p>';
    return;
  }

  if (!selectedPickup) selectedPickup = parcelLockers[0];

  const selectedDistance = Number.isFinite(Number(selectedPickup.distanceKm))
    ? ` · ${Number(selectedPickup.distanceKm).toFixed(2)} KM`
    : "";
  els.pickupSelected.textContent =
    `SELECTED: ${selectedPickup.code} · ${selectedPickup.address}${selectedDistance} · ${parcelLockers.length} LOCKERS LOADED`;

  for (const point of parcelLockers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pickup-point";
    button.classList.toggle("selected", selectedPickup?.code === point.code);

    const distance = Number.isFinite(Number(point.distanceKm))
      ? ` · ${Number(point.distanceKm).toFixed(2)} KM`
      : "";
    const nearest = parcelLockers[0]?.code === point.code ? " · NEAREST" : "";

    button.innerHTML =
      `<span><strong>${escapeHtml(point.code)}${nearest}</strong><br>${escapeHtml(point.address)}, ${escapeHtml(point.postalCode)} ${escapeHtml(point.city)}${distance}</span><b>${selectedPickup?.code === point.code ? "SELECTED" : "SELECT"}</b>`;

    button.addEventListener("click", () => choosePickup(point));
    els.pickupList.append(button);
  }

  initPickupMap();
  pickupMarkers.clearLayers();

  if (deliveryOrigin) {
    L.circleMarker([deliveryOrigin.latitude, deliveryOrigin.longitude], {
      radius: 7,
      color: "#111",
      weight: 3,
      fillColor: "#fff",
      fillOpacity: 1,
    }).addTo(pickupMarkers).bindTooltip("DELIVERY ADDRESS");
  }

  const allBounds = [];
  for (const point of parcelLockers) {
    const isSelected = selectedPickup?.code === point.code;
    const isNearest = parcelLockers[0]?.code === point.code;

    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: isSelected ? 8 : (isNearest ? 7 : 4),
      color: "#000",
      weight: isSelected ? 3 : 1,
      fillColor: isSelected ? "#000" : "#fff",
      fillOpacity: 1,
    }).addTo(pickupMarkers);

    marker.bindTooltip(
      `${escapeHtml(point.code)} · ${escapeHtml(point.address)}${Number.isFinite(Number(point.distanceKm)) ? ` · ${Number(point.distanceKm).toFixed(2)} KM` : ""}`
    );
    marker.on("click", () => choosePickup(point));
    allBounds.push([point.latitude, point.longitude]);
  }

  if (deliveryOrigin) {
    pickupMap.setView([deliveryOrigin.latitude, deliveryOrigin.longitude], 14);
  } else if (allBounds.length) {
    pickupMap.fitBounds(allBounds, { padding: [18, 18], maxZoom: 13 });
  }

  setTimeout(() => pickupMap.invalidateSize(), 80);
}

function bindSizeButtons() {
  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedSize = button.dataset.size;
      quantity = Math.max(1, Math.min(quantity, maxQuantity(selectedSize)));
      els.qtyValue.textContent = String(quantity);
      sizeButtons.forEach((item) => item.classList.toggle("active", item === button));
      showMessage(els.productMessage, "");
    });
  });
}

bindSizeButtons();

els.prevImage.addEventListener("click", () => setImage(activeImageIndex - 1));
els.nextImage.addEventListener("click", () => setImage(activeImageIndex + 1));

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
  const maximum = selectedSize ? maxQuantity(selectedSize) : 10;
  quantity = Math.min(maximum, quantity + 1);
  els.qtyValue.textContent = String(quantity);
  if (selectedSize && quantity >= maximum) {
    showMessage(
      els.productMessage,
      availableStock(selectedSize) > 10 ? "MAXIMUM 10 PER ORDER." : `ONLY ${maximum} AVAILABLE IN SIZE ${selectedSize}.`,
    );
  }
});

els.addToCart.addEventListener("click", () => {
  if (!requireSize()) return;
  if (availableStock(selectedSize) < quantity) {
    showMessage(els.productMessage, "THIS QUANTITY IS NO LONGER AVAILABLE.");
    return;
  }
  cart = { productSlug: PRODUCT.slug, size: selectedSize, quantity };
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
  const maximum = maxQuantity(cart.size);
  cart.quantity = Math.min(maximum, cart.quantity + 1);
  if (cart.quantity >= maximum) {
    showMessage(
      els.checkoutMessage,
      availableStock(cart.size) > 10 ? "MAXIMUM 10 PER ORDER." : `ONLY ${maximum} AVAILABLE IN SIZE ${cart.size}.`,
    );
  }
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
        name: els.shippingName.value.trim(),
        email: els.shippingEmail.value.trim(),
        phone: els.shippingPhone.value.trim(),
        country: els.shippingCountry.value,
        addressLine1: els.shippingAddress1.value.trim(),
        addressLine2: els.shippingAddress2.value.trim(),
        city: els.shippingCity.value.trim(),
        postalCode: els.shippingPostal.value.trim(),
        subtotal: PRODUCT.price * cart.quantity,
      },
    });
    if (error) throw error;
    quotes = data?.quotes || [];
    parcelLockers = data?.parcelLockers || [];
    deliveryOrigin = Number.isFinite(Number(data?.destination?.latitude)) && Number.isFinite(Number(data?.destination?.longitude))
      ? { latitude: Number(data.destination.latitude), longitude: Number(data.destination.longitude) }
      : null;
    if (!quotes.length) throw new Error("No delivery options");
    els.shippingOptionsStep.hidden = false;
    renderQuotes();
    showMessage(
      els.shippingMessage,
      parcelLockers.length
        ? `ADDRESS VERIFIED. ${parcelLockers.length} ACTIVE LOCKERS LOADED. NEAREST: ${parcelLockers[0].code}${Number.isFinite(Number(parcelLockers[0].distanceKm)) ? ` · ${Number(parcelLockers[0].distanceKm).toFixed(2)} KM` : ""}.`
        : "ADDRESS VERIFIED. SELECT A DELIVERY METHOD."
    );
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
        customerName: els.shippingName.value.trim(),
        customerEmail: els.shippingEmail.value.trim(),
        customerPhone: els.shippingPhone.value.trim(),
        shippingCountry: els.shippingCountry.value,
        shippingAddressLine1: els.shippingAddress1.value.trim(),
        shippingAddressLine2: els.shippingAddress2.value.trim(),
        shippingCity: els.shippingCity.value.trim(),
        shippingPostalCode: els.shippingPostal.value.trim(),
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

els.newsletterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.newsletterForm.reportValidity()) return;
  if (els.newsletterCompany.value) return;

  const submit = els.newsletterForm.querySelector("button");
  const email = els.newsletterEmail.value.trim().toLowerCase();
  submit.disabled = true;
  els.newsletterMessage.textContent = "JOINING…";

  const { error } = await supabase.from("newsletter_subscribers").insert({ email });
  const alreadyJoined = error?.code === "23505";

  if (!error || alreadyJoined) {
    els.newsletterForm.reset();
    els.newsletterMessage.textContent = alreadyJoined
      ? "THIS EMAIL IS ALREADY ON THE LIST."
      : "YOU'RE ON THE LIST. THANK YOU.";
  } else {
    console.error(error);
    els.newsletterMessage.textContent = "COULD NOT JOIN. TRY AGAIN.";
  }
  submit.disabled = false;
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

if (new URLSearchParams(location.search).get("payment") === "cancelled") {
  showToast("PAYMENT CANCELLED");
  history.replaceState({}, "", location.pathname);
  setTimeout(openCart, 350);
}

renderCart();
await loadCatalog();
