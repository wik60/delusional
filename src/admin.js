import "./styles.css";
import { supabase } from "./supabase.js";

const money = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const date = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });
const ADMIN_USERNAME = "delusionalemployee";
const ADMIN_AUTH_EMAIL = "delusionalemployee@admin.delusionalcrew.pl";

const statusLabels = {
  pending: "OCZEKUJE",
  paid: "OPŁACONE",
  processing: "W REALIZACJI",
  shipped: "WYSŁANE",
  cancelled: "ANULOWANE",
};

const els = Object.fromEntries([
  "loginView", "dashboardView", "loginForm", "loginMessage", "adminUser", "logoutButton",
  "metricAll", "metricPaid", "metricToShip", "metricRevenue", "orderSearch", "statusFilter",
  "refreshOrders", "ordersBody", "ordersEmpty", "ordersMessage", "adminTitle", "ordersPanel",
  "productsPanel", "refreshProducts", "productsGrid", "productsMessage", "newProductButton", "newProductSlot",
  "messagesPanel", "refreshMessages", "messagesList", "messagesEmpty", "messagesMessage",
  "customersPanel", "refreshCustomers", "customersCount", "customersBody", "customersEmpty", "customerComposer", "customersMessage",
  "newsletterPanel", "refreshNewsletter", "newsletterForm", "newsletterSubject", "newsletterBody", "newsletterBodyRows", "newsletterCount", "newsletterEmpty", "newsletterMessage",
  "settingsPanel", "salesToggleButton", "salesStatusTitle", "salesStatusDescription", "settingsMessage",
].map((id) => [id, document.querySelector(`#${id}`)]));

let orders = [];
let products = [];
let messages = [];
let subscribers = [];
let activeAdminView = "orders";
let salesEnabled = false;

function setView(authenticated) {
  els.loginView.hidden = authenticated;
  els.dashboardView.hidden = !authenticated;
}

async function verifyAdmin(user) {
  if (!user) return false;
  const { data } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (data) return true;

  const { error: insertError } = await supabase.from("admin_users").insert({
    user_id: user.id,
    email: user.email?.toLowerCase(),
  });
  if (insertError) return false;

  const { data: created, error } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  return !error && Boolean(created);
}

function renderSalesSetting() {
  els.salesStatusTitle.textContent = salesEnabled ? "SPRZEDAŻ WŁĄCZONA" : "COMING SOON";
  els.salesStatusDescription.textContent = salesEnabled
    ? "Klienci mogą dodawać produkty do koszyka i przejść do płatności Stripe."
    : "Zakupy są zablokowane. Klienci widzą komunikat COMING SOON.";
  els.salesToggleButton.textContent = salesEnabled ? "WŁĄCZ COMING SOON" : "WŁĄCZ SPRZEDAŻ";
  els.salesToggleButton.classList.toggle("is-live", salesEnabled);
  els.salesToggleButton.setAttribute("aria-pressed", String(salesEnabled));
}

async function loadStoreSettings() {
  els.settingsMessage.textContent = "ŁADOWANIE…";
  const { data, error } = await supabase
    .from("store_settings")
    .select("sales_enabled")
    .eq("id", "storefront")
    .single();

  if (error || !data) {
    console.error(error);
    salesEnabled = false;
    renderSalesSetting();
    els.settingsMessage.textContent = "NIE UDAŁO SIĘ WCZYTAĆ USTAWIEŃ SKLEPU.";
    return;
  }

  salesEnabled = Boolean(data.sales_enabled);
  renderSalesSetting();
  els.settingsMessage.textContent = "";
}

async function toggleSales() {
  const nextValue = !salesEnabled;
  const confirmText = nextValue
    ? "Włączyć sprzedaż? Klienci będą mogli od razu przejść do koszyka i Stripe."
    : "Włączyć tryb COMING SOON? Zakupy zostaną natychmiast zablokowane.";

  if (!window.confirm(confirmText)) return;

  els.salesToggleButton.disabled = true;
  els.settingsMessage.textContent = "ZAPISYWANIE…";
  const { data, error } = await supabase
    .from("store_settings")
    .update({ sales_enabled: nextValue, updated_at: new Date().toISOString() })
    .eq("id", "storefront")
    .select("sales_enabled")
    .single();

  if (error || !data) {
    console.error(error);
    els.settingsMessage.textContent = "NIE UDAŁO SIĘ ZMIENIĆ TRYBU SPRZEDAŻY.";
    els.salesToggleButton.disabled = false;
    return;
  }

  salesEnabled = Boolean(data.sales_enabled);
  renderSalesSetting();
  els.settingsMessage.textContent = salesEnabled
    ? "SPRZEDAŻ JEST TERAZ WŁĄCZONA."
    : "TRYB COMING SOON JEST TERAZ WŁĄCZONY.";
  els.salesToggleButton.disabled = false;
}

async function loadOrders() {
  els.ordersMessage.textContent = "ŁADOWANIE…";
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, order_number, customer_email, customer_name, customer_phone, created_at, total_amount, currency, payment_status, fulfillment_status, shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_city, shipping_country, shipping_carrier, shipping_service, pickup_point_code, pickup_point_address, inpost_shipment_id, tracking_number, shipping_label_path, shipping_label_status, shipping_label_error, shipping_label_created_at, print_job_id, printed_at, order_items(product_name, size, quantity, unit_price)")
    .order("created_at", { ascending: false });

  if (error) {
    els.ordersMessage.textContent = "NIE UDAŁO SIĘ WCZYTAĆ ZAMÓWIEŃ.";
    return;
  }
  orders = rows || [];
  els.ordersMessage.textContent = "";
  renderMetrics();
  renderOrders();
}

async function loadProducts() {
  els.productsMessage.textContent = "ŁADOWANIE…";
  const { data: rows, error } = await supabase
    .from("products")
    .select("id, slug, name, description, price, compare_at_price, currency, active, size_guide, gallery_images, image_url, front_image_url, back_image_url, product_variants(id, size, stock, reserved_stock, active)")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    els.productsMessage.textContent = "NIE UDAŁO SIĘ WCZYTAĆ PRODUKTÓW.";
    return;
  }

  products = rows || [];
  els.productsMessage.textContent = "";
  renderProducts();
}

async function loadMessages() {
  els.messagesMessage.textContent = "ŁADOWANIE…";
  const { data: rows, error } = await supabase
    .from("contact_messages")
    .select("id, name, email, subject, message, status, reply_body, replied_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    els.messagesMessage.textContent = "NIE UDAŁO SIĘ WCZYTAĆ WIADOMOŚCI.";
    return;
  }

  messages = rows || [];
  els.messagesMessage.textContent = "";
  renderMessages();
}

function getCustomers() {
  const grouped = new Map();
  for (const order of orders.filter((item) => item.payment_status === "paid" && item.customer_email)) {
    const email = order.customer_email.trim().toLowerCase();
    const customer = grouped.get(email) || { email, name: order.customer_name || "", orders: 0, total: 0, lastPurchase: order.created_at };
    customer.orders += 1;
    customer.total += Number(order.total_amount || 0);
    if (new Date(order.created_at) > new Date(customer.lastPurchase)) {
      customer.lastPurchase = order.created_at;
      customer.name = order.customer_name || customer.name;
    }
    grouped.set(email, customer);
  }
  return [...grouped.values()].sort((a, b) => new Date(b.lastPurchase) - new Date(a.lastPurchase));
}

function renderCustomers() {
  const customers = getCustomers();
  els.customersBody.replaceChildren();
  els.customersCount.textContent = String(customers.length);
  els.customersEmpty.hidden = customers.length > 0;
  for (const customer of customers) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong>${escapeHtml(customer.name || "—")}</strong><small>${escapeHtml(customer.email)}</small></td><td>${customer.orders}</td><td>${date.format(new Date(customer.lastPurchase))}</td><td><strong>${money.format(customer.total)}</strong></td><td class="customer-action"></td>`;
    const button = makeAdminButton("NAPISZ", "label-button");
    button.addEventListener("click", () => renderCustomerComposer(customer));
    row.querySelector(".customer-action").append(button);
    els.customersBody.append(row);
  }
}

function renderCustomerComposer(customer) {
  els.customerComposer.innerHTML = `<form class="email-composer"><h2>WIADOMOŚĆ DO ${escapeHtml(customer.name || customer.email)}</h2><p>${escapeHtml(customer.email)}</p><label>TEMAT<input name="subject" maxlength="180" required></label><label>WIADOMOŚĆ<textarea name="message" maxlength="10000" rows="7" required></textarea></label><div class="composer-actions"><button class="button button-dark" type="submit">WYŚLIJ WIADOMOŚĆ</button><button class="refresh-button refresh-button-secondary" type="button">ANULUJ</button></div></form>`;
  const form = els.customerComposer.querySelector("form");
  form.querySelector("button[type=button]").addEventListener("click", () => els.customerComposer.replaceChildren());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "WYSYŁANIE…";
    const values = new FormData(form);
    const { data, error } = await supabase.functions.invoke("send-admin-email", { body: { mode: "customer", email: customer.email, subject: values.get("subject"), message: values.get("message") } });
    if (error || !data?.sent) {
      els.customersMessage.textContent = data?.error || "NIE UDAŁO SIĘ WYSŁAĆ WIADOMOŚCI.";
      button.disabled = false;
      button.textContent = "WYŚLIJ WIADOMOŚĆ";
      return;
    }
    els.customerComposer.replaceChildren();
    els.customersMessage.textContent = `WIADOMOŚĆ DO ${customer.email} ZOSTAŁA WYSŁANA.`;
  });
  els.customerComposer.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadNewsletter() {
  els.newsletterMessage.textContent = "ŁADOWANIE…";
  const { data, error } = await supabase.from("newsletter_subscribers").select("id, email, active, created_at, unsubscribed_at").order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    els.newsletterMessage.textContent = "NIE UDAŁO SIĘ WCZYTAĆ NEWSLETTERA.";
    return;
  }
  subscribers = data || [];
  els.newsletterMessage.textContent = "";
  renderNewsletter();
}

function renderNewsletter() {
  els.newsletterBodyRows.replaceChildren();
  els.newsletterCount.textContent = String(subscribers.filter((item) => item.active).length);
  els.newsletterEmpty.hidden = subscribers.length > 0;
  for (const subscriber of subscribers) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong>${escapeHtml(subscriber.email)}</strong></td><td>${date.format(new Date(subscriber.created_at))}</td><td><span class="status">${subscriber.active ? "AKTYWNY" : "WYPISANY"}</span></td><td class="subscriber-action"></td>`;
    const toggle = makeAdminButton(subscriber.active ? "WYPISZ" : "PRZYWRÓĆ", "label-button label-button-secondary");
    toggle.addEventListener("click", () => setSubscriberActive(subscriber, !subscriber.active, toggle));
    row.querySelector(".subscriber-action").append(toggle);
    els.newsletterBodyRows.append(row);
  }
}

async function setSubscriberActive(subscriber, active, button) {
  button.disabled = true;
  const { error } = await supabase.from("newsletter_subscribers").update({ active, unsubscribed_at: active ? null : new Date().toISOString() }).eq("id", subscriber.id);
  if (error) els.newsletterMessage.textContent = "NIE UDAŁO SIĘ ZMIENIĆ STATUSU SUBSKRYPCJI.";
  else await loadNewsletter();
  button.disabled = false;
}

function renderMessages() {
  els.messagesList.replaceChildren();
  els.messagesEmpty.hidden = messages.length > 0;

  for (const item of messages) {
    const card = document.createElement("article");
    card.className = `contact-message-card${item.status === "new" ? " is-new" : ""}`;

    const header = document.createElement("header");
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const email = document.createElement("a");
    email.href = `mailto:${item.email}`;
    email.textContent = item.email;
    identity.append(name, email);
    const meta = document.createElement("small");
    meta.textContent = `${item.status === "replied" ? "ODPOWIEDZIANO" : "NOWA"} · ${date.format(new Date(item.created_at))}`;
    const controls = document.createElement("div");
    controls.className = "contact-message-controls";
    const toggleButton = document.createElement("button");
    toggleButton.className = "contact-message-toggle";
    toggleButton.type = "button";
    toggleButton.textContent = "ROZWIŃ";
    toggleButton.setAttribute("aria-expanded", "false");
    const deleteButton = document.createElement("button");
    deleteButton.className = "contact-message-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "USUŃ";
    deleteButton.addEventListener("click", () => deleteContactMessage(item, deleteButton));
    controls.append(meta, toggleButton, deleteButton);
    header.append(identity, controls);

    const subject = document.createElement("h2");
    subject.textContent = item.subject;
    const details = document.createElement("div");
    details.className = "contact-message-details";
    details.hidden = true;
    const body = document.createElement("p");
    body.className = "contact-message-body";
    body.textContent = item.message;
    details.append(body);
    card.append(header, subject, details);

    toggleButton.addEventListener("click", () => {
      const expanded = toggleButton.getAttribute("aria-expanded") === "true";
      toggleButton.setAttribute("aria-expanded", String(!expanded));
      toggleButton.textContent = expanded ? "ROZWIŃ" : "ZWIŃ";
      details.hidden = expanded;
      card.classList.toggle("is-expanded", !expanded);
    });

    if (item.status === "replied") {
      const reply = document.createElement("div");
      reply.className = "contact-sent-reply";
      const label = document.createElement("strong");
      label.textContent = `WYSŁANA ODPOWIEDŹ${item.replied_at ? ` · ${date.format(new Date(item.replied_at))}` : ""}`;
      const text = document.createElement("p");
      text.textContent = item.reply_body || "";
      reply.append(label, text);
      details.append(reply);
    } else {
      const form = document.createElement("form");
      form.className = "contact-reply-form";
      const textarea = document.createElement("textarea");
      textarea.required = true;
      textarea.maxLength = 5000;
      textarea.rows = 5;
      textarea.placeholder = "NAPISZ ODPOWIEDŹ DO KLIENTA…";
      const button = makeAdminButton("WYŚLIJ ODPOWIEDŹ", "save-stock-button");
      button.type = "submit";
      form.append(textarea, button);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        await sendContactReply(item, textarea.value, button);
      });
      details.append(form);
    }

    els.messagesList.append(card);
  }
}

async function deleteContactMessage(message, button) {
  if (!window.confirm(`Czy na pewno usunąć wiadomość od ${message.email}? Tej operacji nie można cofnąć.`)) return;

  button.disabled = true;
  button.textContent = "USUWANIE…";
  els.messagesMessage.textContent = "";

  const { error } = await supabase.from("contact_messages").delete().eq("id", message.id);
  if (error) {
    console.error(error);
    els.messagesMessage.textContent = "NIE UDAŁO SIĘ USUNĄĆ WIADOMOŚCI.";
    button.disabled = false;
    button.textContent = "USUŃ";
    return;
  }

  messages = messages.filter((item) => item.id !== message.id);
  renderMessages();
  els.messagesMessage.textContent = "WIADOMOŚĆ ZOSTAŁA USUNIĘTA.";
}

async function sendContactReply(message, reply, button) {
  button.disabled = true;
  button.textContent = "WYSYŁANIE…";
  els.messagesMessage.textContent = "";

  const { data, error } = await supabase.functions.invoke("send-contact-reply", {
    body: { messageId: message.id, reply: reply.trim() },
  });

  let errorData = data;
  if (error?.context?.json) {
    try { errorData = await error.context.json(); } catch { /* Response body may already be consumed. */ }
  }

  if (error || !data?.sent) {
    console.error(error || data);
    els.messagesMessage.textContent = errorData?.code === "EMAIL_NOT_CONFIGURED"
      ? "WYSYŁKA E-MAIL NIE JEST JESZCZE SKONFIGUROWANA. DODAJ KLUCZ RESEND I ZWERYFIKUJ DOMENĘ."
      : "NIE UDAŁO SIĘ WYSŁAĆ ODPOWIEDZI. SPRÓBUJ PONOWNIE.";
    button.disabled = false;
    button.textContent = "WYŚLIJ ODPOWIEDŹ";
    return;
  }

  els.messagesMessage.textContent = `ODPOWIEDŹ DO ${message.email} ZOSTAŁA WYSŁANA.`;
  await loadMessages();
}

function renderMetrics() {
  const paid = orders.filter((order) => order.payment_status === "paid");
  const toShip = orders.filter((order) => ["paid", "processing"].includes(order.fulfillment_status));
  const revenue = paid.reduce((sum, order) => sum + Number(order.total_amount), 0);
  els.metricAll.textContent = String(orders.length);
  els.metricPaid.textContent = String(paid.length);
  els.metricToShip.textContent = String(toShip.length);
  els.metricRevenue.textContent = money.format(revenue);
}

function filteredOrders() {
  const query = els.orderSearch.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  return orders.filter((order) => {
    const matchesQuery = !query || `${order.order_number} ${order.customer_email} ${order.customer_name || ""}`.toLowerCase().includes(query);
    const matchesStatus = status === "all" || order.fulfillment_status === status || order.payment_status === status;
    return matchesQuery && matchesStatus;
  });
}

function renderOrders() {
  const visible = filteredOrders();
  els.ordersBody.replaceChildren();
  els.ordersEmpty.hidden = visible.length > 0;

  for (const order of visible) {
    const row = document.createElement("tr");
    const itemSummary = order.order_items?.map((item) => `${item.product_name} / ${item.size} × ${item.quantity}`).join(", ") || "—";
    const deliverySummary = order.shipping_carrier
      ? `${order.shipping_carrier} / ${order.shipping_service || "dostawa"}${order.pickup_point_code ? ` / ${order.pickup_point_code} — ${order.pickup_point_address || ""}` : ""}`
      : "Dostawa nieprzypisana";
    row.innerHTML = `
      <td><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(itemSummary)}<br>${escapeHtml(deliverySummary)}</small></td>
      <td>${escapeHtml(order.customer_name || "—")}<small>${escapeHtml(order.customer_email || "—")}<br>${escapeHtml(order.customer_phone || "—")}</small></td>
      <td>${date.format(new Date(order.created_at))}</td>
      <td><strong>${money.format(Number(order.total_amount))}</strong></td>
      <td><span class="status status-${order.payment_status}">${statusLabels[order.payment_status] || order.payment_status}</span></td>
      <td class="label-cell"></td>
      <td class="fulfillment-cell"></td>
      <td class="order-actions-cell"></td>`;

    const labelCell = row.querySelector(".label-cell");
    renderLabelActions(order, labelCell);

    const select = document.createElement("select");
    select.className = "status-select";
    for (const value of ["pending", "paid", "processing", "shipped", "cancelled"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = statusLabels[value];
      option.selected = value === order.fulfillment_status;
      select.append(option);
    }
    select.addEventListener("change", () => updateFulfillment(order.id, select.value, select));
    row.querySelector(".fulfillment-cell").append(select);

    const remove = makeAdminButton("USUŃ", "delete-order-button");
    remove.setAttribute("aria-label", `Usuń zamówienie ${order.order_number}`);
    remove.addEventListener("click", () => deleteOrder(order, remove));
    row.querySelector(".order-actions-cell").append(remove);
    els.ordersBody.append(row);
  }
}

async function deleteOrder(order, button) {
  const confirmed = window.confirm(
    `Usunąć zamówienie ${order.order_number}? Tej operacji nie można cofnąć. Aktywna płatność Stripe zostanie anulowana.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "USUWANIE…";
  els.ordersMessage.textContent = "";

  const { data, error } = await supabase.functions.invoke("admin-delete-order", {
    body: { orderId: order.id },
  });

  if (error || data?.error) {
    console.error(error || data?.error);
    els.ordersMessage.textContent = "NIE UDAŁO SIĘ USUNĄĆ ZAMÓWIENIA.";
    button.disabled = false;
    button.textContent = "USUŃ";
    return;
  }

  orders = orders.filter((item) => item.id !== order.id);
  renderMetrics();
  renderOrders();
  els.ordersMessage.textContent = `ZAMÓWIENIE ${order.order_number} ZOSTAŁO USUNIĘTE.`;
}

function productGalleryImages(product) {
  if (Array.isArray(product.gallery_images)) {
    return product.gallery_images.filter((url) => typeof url === "string" && url.trim());
  }

  const legacy = [product.front_image_url || product.image_url, product.back_image_url]
    .filter((url) => typeof url === "string" && url.trim());
  return [...new Set(legacy)];
}

function productImageEditor(product, url, index) {
  const editor = document.createElement("div");
  editor.className = "product-image-editor";

  const heading = document.createElement("strong");
  heading.textContent = `ZDJĘCIE ${index + 1}`;

  const previewWrap = document.createElement("div");
  previewWrap.className = "product-image-preview";

  const preview = document.createElement("img");
  preview.src = url;
  preview.alt = `${product.name} — zdjęcie ${index + 1}`;

  const deleteButton = makeAdminButton("×", "image-delete-button");
  deleteButton.setAttribute("aria-label", `Usuń zdjęcie ${index + 1}`);
  deleteButton.title = "Usuń zdjęcie";
  deleteButton.addEventListener("click", () => deleteProductImage(product, index, url, deleteButton));

  const gallery = productGalleryImages(product);
  const orderControls = document.createElement("div");
  orderControls.className = "image-order-controls";

  const moveLeft = makeAdminButton("←", "image-order-button");
  moveLeft.setAttribute("aria-label", `Przesuń zdjęcie ${index + 1} w lewo`);
  moveLeft.title = "Przesuń wcześniej";
  moveLeft.disabled = index === 0;
  moveLeft.addEventListener("click", () => moveProductImage(product, index, index - 1, moveLeft));

  const moveRight = makeAdminButton("→", "image-order-button");
  moveRight.setAttribute("aria-label", `Przesuń zdjęcie ${index + 1} w prawo`);
  moveRight.title = "Przesuń później";
  moveRight.disabled = index === gallery.length - 1;
  moveRight.addEventListener("click", () => moveProductImage(product, index, index + 1, moveRight));

  orderControls.append(moveLeft, moveRight);
  previewWrap.append(preview, deleteButton, orderControls);
  editor.append(heading, previewWrap);
  return editor;
}

function renderProducts() {
  els.productsGrid.replaceChildren();
  for (const product of products) els.productsGrid.append(renderProductEditor(product));
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function labeledField(labelText, input) {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = labelText;
  label.append(caption, input);
  return label;
}

function textInput(value = "", type = "text") {
  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  return input;
}

function addVariantRow(container, variant = {}) {
  const row = document.createElement("div");
  row.className = "variant-edit-row";
  if (variant.id) row.dataset.variantId = variant.id;

  const size = textInput(variant.size || "");
  size.className = "variant-size";
  size.required = true;
  size.maxLength = 12;
  size.pattern = "[A-Za-z0-9]{1,12}";
  if (variant.id) size.readOnly = true;

  const stock = textInput(String(variant.stock ?? 0), "number");
  stock.className = "variant-stock";
  stock.required = true;
  stock.min = String(variant.reserved_stock || 0);
  stock.max = "99999";
  stock.step = "1";

  const info = document.createElement("small");
  const reserved = Number(variant.reserved_stock || 0);
  info.textContent = variant.id
    ? `DOSTĘPNE: ${Math.max(0, Number(variant.stock) - reserved)} · ZAREZERWOWANE: ${reserved}`
    : "NOWY WARIANT";

  const remove = makeAdminButton("USUŃ", "variant-remove-button");
  remove.addEventListener("click", () => {
    if (container.children.length <= 1) {
      els.productsMessage.textContent = "PRODUKT MUSI MIEĆ CO NAJMNIEJ JEDEN WARIANT.";
      return;
    }
    row.remove();
  });

  row.append(labeledField("ROZMIAR", size), labeledField("STAN", stock), info, remove);
  container.append(row);
}

function addGuideRow(container, guide = {}) {
  const row = document.createElement("div");
  row.className = "guide-edit-row";
  for (const [key, label] of [["size", "ROZMIAR"], ["chest", "KLATKA (CM)"], ["length", "DŁUGOŚĆ (CM)"], ["sleeve", "RĘKAW (CM)"]]) {
    const input = textInput(guide[key] || "");
    input.className = `guide-${key}`;
    input.maxLength = key === "size" ? 12 : 20;
    if (key === "size") input.required = true;
    row.append(labeledField(label, input));
  }
  const remove = makeAdminButton("×", "variant-remove-button guide-remove-button");
  remove.setAttribute("aria-label", "Usuń wiersz rozmiarówki");
  remove.addEventListener("click", () => row.remove());
  row.append(remove);
  container.append(row);
}

function renderProductEditor(product = null) {
  const isNew = !product?.id;
  const draft = product || {
    name: "",
    slug: "",
    description: "",
    price: 220,
    compare_at_price: null,
    active: true,
    size_guide: [],
    product_variants: [
      { size: "S", stock: 0 }, { size: "M", stock: 0 }, { size: "L", stock: 0 }, { size: "XL", stock: 0 },
    ],
  };

  const card = document.createElement("article");
  card.className = `product-admin-card${isNew ? " product-admin-card-new" : ""}`;
  const form = document.createElement("form");
  form.className = "product-details-form";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = isNew ? "NOWY PRODUKT" : draft.name;
  header.append(title);
  if (!isNew) {
    const link = document.createElement("a");
    link.className = "product-preview-link";
    link.href = `./index.html?product=${encodeURIComponent(draft.slug)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "OTWÓRZ PRODUKT ↗";
    header.append(link);
  }

  const name = textInput(draft.name);
  name.required = true;
  name.minLength = 2;
  name.maxLength = 120;
  const slug = textInput(draft.slug);
  slug.required = true;
  slug.maxLength = 120;
  slug.pattern = "[a-z0-9]+(?:-[a-z0-9]+)*";
  let slugEdited = !isNew;
  slug.addEventListener("input", () => { slugEdited = true; });
  name.addEventListener("input", () => {
    title.textContent = name.value.trim() || "NOWY PRODUKT";
    if (!slugEdited) slug.value = slugify(name.value);
  });

  const description = document.createElement("textarea");
  description.value = draft.description || "";
  description.maxLength = 5000;
  description.rows = 5;
  const price = textInput(String(draft.price ?? 0), "number");
  price.required = true;
  price.min = "0";
  price.max = "999999";
  price.step = "0.01";
  const comparePrice = textInput(draft.compare_at_price == null ? "" : String(draft.compare_at_price), "number");
  comparePrice.min = "0";
  comparePrice.max = "999999";
  comparePrice.step = "0.01";
  const active = document.createElement("input");
  active.type = "checkbox";
  active.checked = draft.active !== false;

  const fields = document.createElement("div");
  fields.className = "product-fields-grid";
  fields.append(
    labeledField("NAZWA", name),
    labeledField("ADRES / SLUG", slug),
    labeledField("OPIS", description),
    labeledField("CENA (PLN)", price),
    labeledField("CENA PRZEKREŚLONA (PLN, OPCJONALNIE)", comparePrice),
    labeledField("WIDOCZNY W SKLEPIE", active),
  );

  const variantsSection = document.createElement("section");
  variantsSection.className = "product-editor-section";
  const variantsTitle = document.createElement("h3");
  variantsTitle.textContent = "ROZMIARY I STAN MAGAZYNOWY";
  const variantRows = document.createElement("div");
  variantRows.className = "variant-edit-rows";
  const variants = [...(draft.product_variants || [])].sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
  for (const variant of variants) addVariantRow(variantRows, variant);
  if (!variants.length) addVariantRow(variantRows);
  const addVariant = makeAdminButton("+ DODAJ ROZMIAR", "editor-secondary-button");
  addVariant.addEventListener("click", () => addVariantRow(variantRows));
  variantsSection.append(variantsTitle, variantRows, addVariant);

  const guideSection = document.createElement("section");
  guideSection.className = "product-editor-section";
  const guideTitle = document.createElement("h3");
  guideTitle.textContent = "TABELA ROZMIAROWA";
  const guideRows = document.createElement("div");
  guideRows.className = "guide-edit-rows";
  const guide = Array.isArray(draft.size_guide) ? draft.size_guide : [];
  for (const row of guide) addGuideRow(guideRows, row);
  if (!guide.length) {
    for (const variant of variants) addGuideRow(guideRows, { size: variant.size });
  }
  const addGuide = makeAdminButton("+ DODAJ WIERSZ", "editor-secondary-button");
  addGuide.addEventListener("click", () => addGuideRow(guideRows));
  guideSection.append(guideTitle, guideRows, addGuide);

  if (!isNew) {
    const images = document.createElement("section");
    images.className = "product-editor-section";
    const imagesTitle = document.createElement("h3");
    imagesTitle.textContent = "ZDJĘCIA PRODUKTU";
    const imageGrid = document.createElement("div");
    imageGrid.className = "product-images-admin";
    const gallery = productGalleryImages(draft);
    for (const [index, url] of gallery.entries()) {
      imageGrid.append(productImageEditor(draft, url, index));
    }

    const addImageInput = document.createElement("input");
    addImageInput.type = "file";
    addImageInput.accept = "image/jpeg,image/png,image/webp";
    addImageInput.hidden = true;

    const addImage = makeAdminButton("+ DODAJ ZDJĘCIE", "image-upload-button add-product-image-button");
    addImage.disabled = gallery.length >= 20;
    if (gallery.length >= 20) addImage.title = "Maksymalnie 20 zdjęć produktu";
    addImage.addEventListener("click", () => addImageInput.click());
    addImageInput.addEventListener("change", async () => {
      const [file] = addImageInput.files || [];
      if (file) await uploadProductImage(draft, file, addImage);
      addImageInput.value = "";
    });

    if (!gallery.length) {
      const empty = document.createElement("p");
      empty.className = "product-images-empty";
      empty.textContent = "BRAK ZDJĘĆ — DODAJ PIERWSZE ZDJĘCIE.";
      imageGrid.append(empty);
    }

    images.append(imagesTitle, imageGrid, addImageInput, addImage);
    form.append(header, fields, variantsSection, guideSection, images);
  } else {
    const hint = document.createElement("p");
    hint.className = "product-create-hint";
    hint.textContent = "Po utworzeniu produktu pojawi się opcja dodawania zdjęć.";
    form.append(header, fields, variantsSection, guideSection, hint);
  }

  const actions = document.createElement("div");
  actions.className = "product-editor-actions";
  const save = makeAdminButton(isNew ? "UTWÓRZ PRODUKT" : "ZAPISZ PRODUKT", "save-stock-button");
  save.type = "submit";
  actions.append(save);
  if (isNew) {
    const cancel = makeAdminButton("ANULUJ", "editor-secondary-button");
    cancel.addEventListener("click", () => {
      els.newProductSlot.replaceChildren();
      els.newProductButton.disabled = false;
    });
    actions.append(cancel);
  } else {
    const remove = makeAdminButton("USUŃ PRODUKT", "delete-product-button");
    remove.addEventListener("click", () => deleteProduct(draft, remove));
    actions.append(remove);
  }
  form.append(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const variantPayload = [...variantRows.querySelectorAll(".variant-edit-row")].map((row) => ({
      ...(row.dataset.variantId ? { id: row.dataset.variantId } : {}),
      size: row.querySelector(".variant-size").value.trim().toUpperCase(),
      stock: Number(row.querySelector(".variant-stock").value),
    }));
    const guidePayload = [...guideRows.querySelectorAll(".guide-edit-row")].map((row) => ({
      size: row.querySelector(".guide-size").value.trim().toUpperCase(),
      chest: row.querySelector(".guide-chest").value.trim(),
      length: row.querySelector(".guide-length").value.trim(),
      sleeve: row.querySelector(".guide-sleeve").value.trim(),
    }));
    await saveProduct({
      product: draft,
      name: name.value,
      slug: slug.value,
      description: description.value,
      price: Number(price.value),
      compareAtPrice: comparePrice.value === "" ? null : Number(comparePrice.value),
      active: active.checked,
      variants: variantPayload,
      sizeGuide: guidePayload,
      button: save,
      isNew,
    });
  });

  card.append(form);
  return card;
}

async function moveProductImage(product, fromIndex, toIndex, button) {
  const current = productGalleryImages(product);
  if (
    fromIndex < 0 ||
    fromIndex >= current.length ||
    toIndex < 0 ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) return;

  button.disabled = true;
  els.productsMessage.textContent = "";

  const next = [...current];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  const { error } = await supabase
    .from("products")
    .update({ gallery_images: next })
    .eq("id", product.id);

  if (error) {
    console.error(error);
    els.productsMessage.textContent = "NIE UDAŁO SIĘ ZMIENIĆ KOLEJNOŚCI ZDJĘĆ.";
    button.disabled = false;
    return;
  }

  els.productsMessage.textContent = "KOLEJNOŚĆ ZDJĘĆ ZOSTAŁA ZMIENIONA.";
  await loadProducts();
}

async function deleteProductImage(product, index, url, button) {
  const confirmed = window.confirm(
    `Czy na pewno chcesz usunąć zdjęcie ${index + 1} produktu „${product.name}”? Tej operacji nie można cofnąć.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  els.productsMessage.textContent = "";

  const current = productGalleryImages(product);
  const next = current.filter((_, imageIndex) => imageIndex !== index);

  const { error: updateError } = await supabase
    .from("products")
    .update({ gallery_images: next })
    .eq("id", product.id);

  if (updateError) {
    console.error(updateError);
    els.productsMessage.textContent = "NIE UDAŁO SIĘ USUNĄĆ ZDJĘCIA.";
    button.disabled = false;
    return;
  }

  const fileName = (() => {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {
      return "";
    }
  })();

  if (fileName) {
    const { data: imageFiles, error: listError } = await supabase.storage
      .from("product-images")
      .list(product.id, { limit: 100 });

    if (!listError && imageFiles?.some((file) => file.name === fileName)) {
      const { error: removeError } = await supabase.storage
        .from("product-images")
        .remove([`${product.id}/${fileName}`]);
      if (removeError) console.error("product image cleanup", removeError);
    } else if (listError) {
      console.error("product image listing", listError);
    }
  }

  els.productsMessage.textContent = "ZDJĘCIE ZOSTAŁO USUNIĘTE.";
  await loadProducts();
}

async function uploadProductImage(product, file, button) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
    els.productsMessage.textContent = "WYBIERZ PLIK JPG, PNG LUB WEBP DO 8 MB.";
    return;
  }

  const current = productGalleryImages(product);
  if (current.length >= 20) {
    els.productsMessage.textContent = "PRODUKT MOŻE MIEĆ MAKSYMALNIE 20 ZDJĘĆ.";
    return;
  }

  button.disabled = true;
  button.textContent = "DODAWANIE…";
  els.productsMessage.textContent = "";

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${product.id}/gallery-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { cacheControl: "31536000", contentType: file.type, upsert: false });

  if (uploadError) {
    console.error(uploadError);
    els.productsMessage.textContent = "NIE UDAŁO SIĘ DODAĆ ZDJĘCIA.";
    button.disabled = false;
    button.textContent = "+ DODAJ ZDJĘCIE";
    return;
  }

  const { data: publicUrl } = supabase.storage.from("product-images").getPublicUrl(path);
  const next = [...current, publicUrl.publicUrl];

  const { error: updateError } = await supabase
    .from("products")
    .update({ gallery_images: next })
    .eq("id", product.id);

  if (updateError) {
    console.error(updateError);
    await supabase.storage.from("product-images").remove([path]);
    els.productsMessage.textContent = "PLIK WGRAŁ SIĘ, ALE NIE UDAŁO SIĘ DODAĆ GO DO PRODUKTU.";
    button.disabled = false;
    button.textContent = "+ DODAJ ZDJĘCIE";
    return;
  }

  els.productsMessage.textContent = "NOWE ZDJĘCIE ZOSTAŁO DODANE.";
  await loadProducts();
}

async function saveProduct({ product, name, slug, description, price, compareAtPrice, active, variants, sizeGuide, button, isNew }) {
  button.disabled = true;
  button.textContent = "ZAPISYWANIE…";
  els.productsMessage.textContent = "";

  const invalid = variants.some((item) => !item.size || !Number.isInteger(item.stock) || item.stock < 0 || item.stock > 99999);
  if (invalid) {
    els.productsMessage.textContent = "KAŻDY ROZMIAR MUSI MIEĆ POPRAWNY STAN OD 0 DO 99999.";
    button.disabled = false;
    button.textContent = isNew ? "UTWÓRZ PRODUKT" : "ZAPISZ PRODUKT";
    return;
  }

  const { data: productId, error } = await supabase.rpc("admin_save_product", {
    p_product_id: product.id || null,
    p_name: name.trim(),
    p_slug: slugify(slug),
    p_description: description.trim(),
    p_price: price,
    p_compare_at_price: compareAtPrice,
    p_active: active,
    p_size_guide: sizeGuide,
    p_variants: variants,
  });

  if (error) {
    console.error(error);
    els.productsMessage.textContent = error.message?.includes("duplicate key")
      ? "TAKI ADRES PRODUKTU LUB ROZMIAR JUŻ ISTNIEJE."
      : "NIE UDAŁO SIĘ ZAPISAĆ PRODUKTU. SPRAWDŹ CENĘ, ROZMIARY I ZAREZERWOWANY STAN.";
    button.disabled = false;
    button.textContent = isNew ? "UTWÓRZ PRODUKT" : "ZAPISZ PRODUKT";
    return;
  }

  if (isNew) {
    els.newProductSlot.replaceChildren();
    els.newProductButton.disabled = false;
  }
  els.productsMessage.textContent = isNew
    ? `PRODUKT ZOSTAŁ UTWORZONY. TERAZ MOŻESZ DODAĆ JEGO ZDJĘCIA.`
    : `PRODUKT ${name.trim()} ZOSTAŁ ZAPISANY.`;
  await loadProducts();
  if (isNew && productId) {
    document.querySelector(`.product-admin-card form`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function deleteProduct(product, button) {
  const confirmed = window.confirm(
    `Czy na pewno usunąć produkt „${product.name}”?\n\nProdukt i jego warianty znikną ze sklepu. Historia zakończonych zamówień pozostanie zachowana. Tej operacji nie można cofnąć.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "USUWANIE…";
  els.productsMessage.textContent = "";

  const { error } = await supabase.rpc("admin_delete_product", { p_product_id: product.id });

  if (error) {
    console.error(error);
    if (error.message?.includes("last active product")) {
      els.productsMessage.textContent = "NIE MOŻNA USUNĄĆ OSTATNIEGO AKTYWNEGO PRODUKTU. NAJPIERW DODAJ LUB AKTYWUJ INNY.";
    } else if (error.message?.includes("open order")) {
      els.productsMessage.textContent = "PRODUKT MA OTWARTE ZAMÓWIENIE. NAJPIERW JE ZREALIZUJ LUB ANULUJ.";
    } else {
      els.productsMessage.textContent = "NIE UDAŁO SIĘ USUNĄĆ PRODUKTU.";
    }
    button.disabled = false;
    button.textContent = "USUŃ PRODUKT";
    return;
  }

  const { data: imageFiles } = await supabase.storage.from("product-images").list(product.id, { limit: 100 });
  if (imageFiles?.length) {
    const paths = imageFiles.map((file) => `${product.id}/${file.name}`);
    const { error: imageError } = await supabase.storage.from("product-images").remove(paths);
    if (imageError) console.error("product image cleanup", imageError);
  }

  els.productsMessage.textContent = `PRODUKT ${product.name} ZOSTAŁ USUNIĘTY.`;
  await loadProducts();
}

async function setAdminView(view) {
  activeAdminView = view;
  els.ordersPanel.hidden = view !== "orders";
  els.productsPanel.hidden = view !== "products";
  els.messagesPanel.hidden = view !== "messages";
  els.customersPanel.hidden = view !== "customers";
  els.newsletterPanel.hidden = view !== "newsletter";
  els.settingsPanel.hidden = view !== "settings";
  els.adminTitle.textContent = { orders: "ZAMÓWIENIA", products: "PRODUKTY", messages: "WIADOMOŚCI", customers: "KLIENCI", newsletter: "NEWSLETTER", settings: "USTAWIENIA" }[view] || "PANEL";
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminView === view);
  });
  if (view === "products") await loadProducts();
  if (view === "messages") await loadMessages();
  if (view === "customers") { await loadOrders(); renderCustomers(); }
  if (view === "newsletter") await loadNewsletter();
  if (view === "settings") await loadStoreSettings();
}

function labelStatusText(order) {
  const map = {
    not_created: "BRAK",
    generating: "TWORZENIE…",
    generated: "GOTOWA",
    printed: "WYDRUKOWANA",
    failed: "BŁĄD",
    needs_configuration: "KONFIGURACJA",
  };
  return map[order.shipping_label_status] || order.shipping_label_status || "BRAK";
}

function makeAdminButton(text, className = "label-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function renderLabelActions(order, cell) {
  cell.replaceChildren();

  const status = document.createElement("span");
  status.className = `label-status label-status-${order.shipping_label_status || "not_created"}`;
  status.textContent = labelStatusText(order);
  cell.append(status);

  if (order.tracking_number) {
    const tracking = document.createElement("small");
    tracking.textContent = `TRACKING: ${order.tracking_number}`;
    cell.append(tracking);
  }

  const actions = document.createElement("div");
  actions.className = "label-actions";

  if (order.payment_status === "paid" && /inpost/i.test(order.shipping_carrier || "")) {
    const generate = makeAdminButton(order.shipping_label_path ? "DRUKUJ PONOWNIE" : "UTWÓRZ ETYKIETĘ");
    generate.addEventListener("click", async () => {
      generate.disabled = true;
      generate.textContent = "PRZETWARZANIE…";
      const { data, error } = await supabase.functions.invoke("inpost-fulfillment", {
        body: { orderId: order.id, action: order.shipping_label_path ? "reprint" : "generate" },
      });

      if (error || data?.error) {
        els.ordersMessage.textContent = data?.error || "NIE UDAŁO SIĘ UTWORZYĆ / WYDRUKOWAĆ ETYKIETY.";
      } else {
        els.ordersMessage.textContent = data?.autoPrintConfigured
          ? "ETYKIETA ZOSTAŁA WYSŁANA DO DRUKARKI."
          : "ETYKIETA JEST GOTOWA. AUTOMATYCZNA DRUKARKA NIE JEST JESZCZE SKONFIGUROWANA.";
        if (data?.url && !data?.autoPrintConfigured) window.open(data.url, "_blank", "noopener,noreferrer");
      }
      await loadOrders();
    });
    actions.append(generate);
  }

  if (order.shipping_label_path) {
    const pdf = makeAdminButton("PDF", "label-button label-button-secondary");
    pdf.addEventListener("click", async () => {
      pdf.disabled = true;
      const { data, error } = await supabase.functions.invoke("inpost-fulfillment", {
        body: { orderId: order.id, action: "download" },
      });
      pdf.disabled = false;
      if (error || !data?.url) {
        els.ordersMessage.textContent = "NIE UDAŁO SIĘ OTWORZYĆ ETYKIETY.";
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    });
    actions.append(pdf);
  }

  if (actions.children.length) cell.append(actions);

  if (order.shipping_label_error) {
    const err = document.createElement("small");
    err.className = "label-error";
    err.textContent = order.shipping_label_error;
    cell.append(err);
  }
}

async function updateFulfillment(orderId, fulfillmentStatus, select) {
  select.disabled = true;
  const { error } = await supabase.from("orders").update({ fulfillment_status: fulfillmentStatus }).eq("id", orderId);
  select.disabled = false;
  if (error) {
    els.ordersMessage.textContent = "NIE UDAŁO SIĘ ZMIENIĆ STATUSU.";
    await loadOrders();
    return;
  }
  const order = orders.find((item) => item.id === orderId);
  if (order) order.fulfillment_status = fulfillmentStatus;
  renderMetrics();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = els.loginForm.querySelector("button");
  button.disabled = true;
  els.loginMessage.textContent = "LOGOWANIE…";
  const username = document.querySelector("#adminUsername").value.trim().toLowerCase();
  const password = document.querySelector("#adminPassword").value;
  if (username !== ADMIN_USERNAME) {
    els.loginMessage.textContent = "NIEPRAWIDŁOWY LOGIN LUB HASŁO.";
    button.disabled = false;
    return;
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: ADMIN_AUTH_EMAIL,
    password,
  });
  if (error || !data.user || !(await verifyAdmin(data.user))) {
    if (data.user) await supabase.auth.signOut();
    els.loginMessage.textContent = "NIEPRAWIDŁOWY LOGIN LUB HASŁO.";
  } else {
    els.loginMessage.textContent = "";
    await showDashboard(data.user);
  }
  button.disabled = false;
});

async function showDashboard(user) {
  setView(true);
  els.adminUser.textContent = ADMIN_USERNAME;
  await Promise.all([loadOrders(), loadProducts(), loadMessages(), loadStoreSettings()]);
  await setAdminView(activeAdminView);
}

els.logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  setView(false);
  els.loginForm.reset();
});
els.refreshOrders.addEventListener("click", loadOrders);
els.refreshProducts.addEventListener("click", loadProducts);
els.refreshMessages.addEventListener("click", loadMessages);
els.refreshCustomers.addEventListener("click", async () => { await loadOrders(); renderCustomers(); });
els.refreshNewsletter.addEventListener("click", loadNewsletter);
els.salesToggleButton.addEventListener("click", toggleSales);
els.newsletterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const recipients = subscribers.filter((item) => item.active).length;
  if (!recipients || !window.confirm(`Wysłać newsletter do ${recipients} aktywnych subskrybentów?`)) return;
  const button = els.newsletterForm.querySelector("button");
  button.disabled = true;
  button.textContent = "WYSYŁANIE…";
  const { data, error } = await supabase.functions.invoke("send-admin-email", { body: { mode: "newsletter", subject: els.newsletterSubject.value, message: els.newsletterBody.value } });
  if (error || !data?.sent) els.newsletterMessage.textContent = data?.error || "NIE UDAŁO SIĘ WYSŁAĆ NEWSLETTERA.";
  else {
    els.newsletterForm.reset();
    els.newsletterMessage.textContent = `NEWSLETTER ZOSTAŁ WYSŁANY DO ${data.recipientCount} OSÓB.`;
  }
  button.disabled = false;
  button.textContent = "WYŚLIJ DO AKTYWNYCH SUBSKRYBENTÓW";
});
els.newProductButton.addEventListener("click", () => {
  els.newProductSlot.replaceChildren(renderProductEditor());
  els.newProductButton.disabled = true;
  els.newProductSlot.scrollIntoView({ behavior: "smooth", block: "start" });
});
els.orderSearch.addEventListener("input", renderOrders);
els.statusFilter.addEventListener("change", renderOrders);
document.querySelectorAll("[data-admin-view]").forEach((button) => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminView));
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user && await verifyAdmin(session.user)) await showDashboard(session.user);
else {
  if (session) await supabase.auth.signOut();
  setView(false);
}
