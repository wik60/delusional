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
  "refreshOrders", "ordersBody", "ordersEmpty", "ordersMessage",
].map((id) => [id, document.querySelector(`#${id}`)]));

let orders = [];

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
      <td></td>`;

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
    row.lastElementChild.append(select);
    els.ordersBody.append(row);
  }
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
  await loadOrders();
}

els.logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  setView(false);
  els.loginForm.reset();
});
els.refreshOrders.addEventListener("click", loadOrders);
els.orderSearch.addEventListener("input", renderOrders);
els.statusFilter.addEventListener("change", renderOrders);

const { data: { session } } = await supabase.auth.getSession();
if (session?.user && await verifyAdmin(session.user)) await showDashboard(session.user);
else {
  if (session) await supabase.auth.signOut();
  setView(false);
}
