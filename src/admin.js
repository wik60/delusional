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
  "productsPanel", "refreshProducts", "productsGrid", "productsMessage",
].map((id) => [id, document.querySelector(`#${id}`)]));

let orders = [];
let products = [];
let activeAdminView = "orders";

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
    .select("id, slug, name, image_url, front_image_url, back_image_url, product_variants(id, size, stock, reserved_stock, active)")
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

function imageUrl(product, side) {
  if (side === "front") return product.front_image_url || product.image_url || "./images/classic-zip-front.jpg";
  return product.back_image_url || "./images/classic-zip-back.jpg";
}

function productImageEditor(product, side, label) {
  const editor = document.createElement("div");
  editor.className = "product-image-editor";

  const heading = document.createElement("strong");
  heading.textContent = label;
  const preview = document.createElement("img");
  preview.src = imageUrl(product, side);
  preview.alt = `${product.name} — ${label.toLowerCase()}`;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.hidden = true;

  const button = makeAdminButton("WYBIERZ I WGRAJ", "image-upload-button");
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const [file] = input.files || [];
    if (file) await uploadProductImage(product, side, file, button);
    input.value = "";
  });

  editor.append(heading, preview, input, button);
  return editor;
}

function renderProducts() {
  els.productsGrid.replaceChildren();

  for (const product of products) {
    const card = document.createElement("article");
    card.className = "product-admin-card";

    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = product.name;
    const slug = document.createElement("small");
    slug.textContent = product.slug;
    header.append(title, slug);

    const images = document.createElement("div");
    images.className = "product-images-admin";
    images.append(
      productImageEditor(product, "front", "PRZÓD"),
      productImageEditor(product, "back", "TYŁ"),
    );

    const stockForm = document.createElement("form");
    stockForm.className = "stock-form";
    const stockTitle = document.createElement("h3");
    stockTitle.textContent = "STAN MAGAZYNOWY";
    stockForm.append(stockTitle);

    const stockRows = document.createElement("div");
    stockRows.className = "stock-rows";
    const variants = [...(product.product_variants || [])].sort(
      (a, b) => ["S", "M", "L", "XL"].indexOf(a.size) - ["S", "M", "L", "XL"].indexOf(b.size),
    );

    for (const variant of variants) {
      const row = document.createElement("label");
      row.className = "stock-row";
      const size = document.createElement("strong");
      size.textContent = variant.size;
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";
      input.min = String(variant.reserved_stock || 0);
      input.max = "99999";
      input.step = "1";
      input.required = true;
      input.value = String(variant.stock);
      input.dataset.variantId = variant.id;
      const details = document.createElement("small");
      details.textContent = `DOSTĘPNE: ${Math.max(0, variant.stock - (variant.reserved_stock || 0))} · ZAREZERWOWANE: ${variant.reserved_stock || 0}`;
      row.append(size, input, details);
      stockRows.append(row);
    }

    const save = makeAdminButton("ZAPISZ STANY", "save-stock-button");
    save.type = "submit";
    stockForm.append(stockRows, save);
    stockForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!stockForm.reportValidity()) return;
      await saveStock(product, stockForm, save);
    });

    card.append(header, images, stockForm);
    els.productsGrid.append(card);
  }
}

async function uploadProductImage(product, side, file, button) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
    els.productsMessage.textContent = "WYBIERZ PLIK JPG, PNG LUB WEBP DO 8 MB.";
    return;
  }

  button.disabled = true;
  button.textContent = "WGRYWANIE…";
  els.productsMessage.textContent = "";

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${product.id}/${side}-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { cacheControl: "31536000", contentType: file.type, upsert: false });

  if (uploadError) {
    console.error(uploadError);
    els.productsMessage.textContent = "NIE UDAŁO SIĘ WGRAĆ ZDJĘCIA.";
    button.disabled = false;
    button.textContent = "WYBIERZ I WGRAJ";
    return;
  }

  const { data: publicUrl } = supabase.storage.from("product-images").getPublicUrl(path);
  const column = side === "front" ? "front_image_url" : "back_image_url";
  const { error: updateError } = await supabase
    .from("products")
    .update({ [column]: publicUrl.publicUrl })
    .eq("id", product.id);

  if (updateError) {
    console.error(updateError);
    await supabase.storage.from("product-images").remove([path]);
    els.productsMessage.textContent = "PLIK WGRAŁ SIĘ, ALE NIE UDAŁO SIĘ PRZYPISAĆ GO DO PRODUKTU.";
    button.disabled = false;
    button.textContent = "WYBIERZ I WGRAJ";
    return;
  }

  els.productsMessage.textContent = `${side === "front" ? "ZDJĘCIE PRZODU" : "ZDJĘCIE TYŁU"} ZOSTAŁO ZMIENIONE.`;
  await loadProducts();
}

async function saveStock(product, form, button) {
  button.disabled = true;
  button.textContent = "ZAPISYWANIE…";
  els.productsMessage.textContent = "";

  const updates = [...form.querySelectorAll("input[data-variant-id]")].map((input) => ({
    id: input.dataset.variantId,
    stock: Number(input.value),
  }));

  const invalid = updates.some((item) => !Number.isInteger(item.stock) || item.stock < 0 || item.stock > 99999);
  if (invalid) {
    els.productsMessage.textContent = "STAN MUSI BYĆ LICZBĄ CAŁKOWITĄ OD 0 DO 99999.";
    button.disabled = false;
    button.textContent = "ZAPISZ STANY";
    return;
  }

  const { error } = await supabase.rpc("admin_update_product_stock", {
    p_product_id: product.id,
    p_stocks: updates,
  });

  if (error) {
    console.error(error);
    els.productsMessage.textContent = "NIE UDAŁO SIĘ ZAPISAĆ STANU. STAN NIE MOŻE BYĆ NIŻSZY NIŻ LICZBA ZAREZERWOWANYCH SZTUK.";
    await loadProducts();
    return;
  }

  els.productsMessage.textContent = `STAN PRODUKTU ${product.name} ZOSTAŁ ZAPISANY.`;
  await loadProducts();
}

async function setAdminView(view) {
  activeAdminView = view;
  const showingProducts = view === "products";
  els.ordersPanel.hidden = showingProducts;
  els.productsPanel.hidden = !showingProducts;
  els.adminTitle.textContent = showingProducts ? "PRODUKTY" : "ZAMÓWIENIA";
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminView === view);
  });
  if (showingProducts) await loadProducts();
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
  await Promise.all([loadOrders(), loadProducts()]);
  await setAdminView(activeAdminView);
}

els.logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  setView(false);
  els.loginForm.reset();
});
els.refreshOrders.addEventListener("click", loadOrders);
els.refreshProducts.addEventListener("click", loadProducts);
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
