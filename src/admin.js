import "./styles.css";
import { supabase } from "./supabase.js";

const money = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const date = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });

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
  const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  return !error && Boolean(data);
}

async function loadOrders() {
  els.ordersMessage.textContent = "ŁADOWANIE…";
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, order_number, customer_email, customer_name, created_at, total_amount, currency, payment_status, fulfillment_status, shipping_city, shipping_country, order_items(product_name, size, quantity, unit_price)")
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
    row.innerHTML = `
      <td><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(itemSummary)}</small></td>
      <td>${escapeHtml(order.customer_name || "—")}<small>${escapeHtml(order.customer_email || "—")}</small></td>
      <td>${date.format(new Date(order.created_at))}</td>
      <td><strong>${money.format(Number(order.total_amount))}</strong></td>
      <td><span class="status status-${order.payment_status}">${statusLabels[order.payment_status] || order.payment_status}</span></td>
      <td></td>`;

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
  const email = document.querySelector("#adminEmail").value.trim();
  const password = document.querySelector("#adminPassword").value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !(await verifyAdmin(data.user))) {
    await supabase.auth.signOut();
    els.loginMessage.textContent = "NIEPRAWIDŁOWE DANE LUB BRAK UPRAWNIEŃ ADMINISTRATORA.";
    button.disabled = false;
    return;
  }
  await showDashboard(data.user);
  button.disabled = false;
});

async function showDashboard(user) {
  setView(true);
  els.adminUser.textContent = user.email;
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
