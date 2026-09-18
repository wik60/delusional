import "./styles.css";
import { PRODUCT, SHIPPING } from "./config.js";
import { supabase } from "./supabase.js";

const CART_KEY = "delusional-cart-v1";
const money = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 });

const els = {
  sizeButtons: [...document.querySelectorAll("[data-size]")],
  addToCart: document.querySelector("#addToCart"),
  cartTrigger: document.querySelector(".cart-trigger"),
  cartCount: document.querySelector("#cartCount"),
  cartDrawer: document.querySelector("#cartDrawer"),
  cartBackdrop: document.querySelector("#cartBackdrop"),
  closeCart: document.querySelector("#closeCart"),
  continueShopping: document.querySelector("#continueShopping"),
  cartEmpty: document.querySelector("#cartEmpty"),
  cartContent: document.querySelector("#cartContent"),
  cartSize: document.querySelector("#cartSize"),
  cartQty: document.querySelector("#cartQty"),
  lineTotal: document.querySelector("#lineTotal"),
  cartTotal: document.querySelector("#cartTotal"),
  shippingTotal: document.querySelector("#shippingTotal"),
  deliveryCountry: document.querySelector("#deliveryCountry"),
  decreaseQty: document.querySelector("#decreaseQty"),
  increaseQty: document.querySelector("#increaseQty"),
  checkoutButton: document.querySelector("#checkoutButton"),
  checkoutMessage: document.querySelector("#checkoutMessage"),
  newsletterForm: document.querySelector("#newsletterForm"),
  newsletterMessage: document.querySelector("#newsletterMessage"),
  toast: document.querySelector("#toast"),
};

let selectedSize = "";
let cart = readCart();

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY));
    if (!parsed || !PRODUCT.sizes.includes(parsed.size)) return null;
    return { size: parsed.size, quantity: Math.max(1, Math.min(10, Number(parsed.quantity) || 1)) };
  } catch {
    return null;
  }
}

function saveCart() {
  if (cart) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  else localStorage.removeItem(CART_KEY);
  renderCart();
}

function renderCart() {
  const quantity = cart?.quantity || 0;
  els.cartCount.textContent = String(quantity);
  els.cartEmpty.hidden = Boolean(cart);
  els.cartContent.hidden = !cart;
  if (!cart) return;
  els.cartSize.textContent = cart.size;
  els.cartQty.textContent = String(cart.quantity);
  const subtotal = PRODUCT.price * cart.quantity;
  const shippingRule = SHIPPING[els.deliveryCountry.value];
  const shipping = shippingRule.freeFrom && subtotal >= shippingRule.freeFrom ? 0 : shippingRule.amount;
  els.lineTotal.textContent = money.format(subtotal);
  els.shippingTotal.textContent = shipping === 0 ? "GRATIS" : money.format(shipping);
  els.cartTotal.textContent = money.format(subtotal + shipping);
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

els.sizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedSize = button.dataset.size;
    els.sizeButtons.forEach((item) => item.classList.toggle("selected", item === button));
  });
});

els.addToCart.addEventListener("click", () => {
  if (!selectedSize) {
    showToast("WYBIERZ ROZMIAR");
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
els.continueShopping.addEventListener("click", closeCart);
els.cartBackdrop.addEventListener("click", closeCart);
els.deliveryCountry.addEventListener("change", renderCart);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCart(); });

els.decreaseQty.addEventListener("click", () => {
  if (!cart) return;
  cart.quantity -= 1;
  if (cart.quantity < 1) cart = null;
  saveCart();
});

els.increaseQty.addEventListener("click", () => {
  if (!cart) return;
  cart.quantity = Math.min(10, cart.quantity + 1);
  saveCart();
});

els.checkoutButton.addEventListener("click", async () => {
  if (!cart) return;
  els.checkoutButton.disabled = true;
  els.checkoutButton.textContent = "PRZYGOTOWUJĘ PŁATNOŚĆ…";
  els.checkoutMessage.textContent = "";
  try {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        productSlug: PRODUCT.slug,
        size: cart.size,
        quantity: cart.quantity,
        shippingCountry: els.deliveryCountry.value,
        successUrl: `${location.origin}${location.pathname}?payment=success`,
        cancelUrl: `${location.origin}${location.pathname}?payment=cancelled`,
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Brak adresu płatności");
    location.assign(data.url);
  } catch (error) {
    console.error(error);
    els.checkoutMessage.textContent = "Płatności są jeszcze konfigurowane. Spróbuj ponownie później.";
    els.checkoutButton.disabled = false;
    els.checkoutButton.textContent = "PRZEJDŹ DO PŁATNOŚCI";
  }
});

els.newsletterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = new FormData(els.newsletterForm).get("email") || document.querySelector("#newsletterEmail").value;
  els.newsletterMessage.textContent = "ZAPISUJĘ…";
  const { error } = await supabase.from("newsletter_subscribers").insert({ email: String(email).trim().toLowerCase() });
  if (error && error.code !== "23505") {
    els.newsletterMessage.textContent = "NIE UDAŁO SIĘ ZAPISAĆ. SPRÓBUJ PONOWNIE.";
    return;
  }
  els.newsletterForm.reset();
  els.newsletterMessage.textContent = "JESTEŚ NA LIŚCIE. DO ZOBACZENIA PRZY DROPIE.";
});

const paymentState = new URLSearchParams(location.search).get("payment");
if (paymentState === "success") {
  cart = null;
  saveCart();
  showToast("PŁATNOŚĆ PRZYJĘTA — DZIĘKUJEMY");
  history.replaceState({}, "", location.pathname);
} else if (paymentState === "cancelled") {
  showToast("PŁATNOŚĆ ANULOWANA — KOSZYK ZOSTAŁ ZACHOWANY");
  history.replaceState({}, "", location.pathname);
}

renderCart();
