const form = document.querySelector("#quota-form");
const tokenInput = document.querySelector("#token-input");
const submitButton = document.querySelector("#submit-button");
const buttonLabel = submitButton.querySelector(".button-label");
const formError = document.querySelector("#form-error");
const resultPanel = document.querySelector("#result-panel");
const detailTableBody = document.querySelector("#detail-table-body");
const modelTableBody = document.querySelector("#model-table-body");
const modelFilter = document.querySelector("#model-filter");
const startDateInput = document.querySelector("#start-date");
const endDateInput = document.querySelector("#end-date");
const pageSizeSelect = document.querySelector("#page-size");

const membershipLabels = {
  free: "Free",
  free_trial: "Free Trial",
  pro: "Pro",
  pro_plus: "Pro+",
  business: "Business",
  team: "Team",
  enterprise: "Enterprise",
  ultra: "Ultra",
};

const detailState = {
  report: null,
  type: "all",
  model: "",
  page: 1,
  pageSize: 20,
};

/** 按 ID 更新纯文本，所有上游内容都通过 textContent 写入。 */
function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

/** 切换提交按钮状态，保持固定尺寸，避免查询期间布局跳动。 */
function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  submitButton.setAttribute("aria-busy", String(loading));
  buttonLabel.textContent = loading ? "查询中" : "查询额度";
}

/** 显示查询错误，不使用遮挡页面的浮层。 */
function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

/** 清空上一次错误。 */
function clearError() {
  formError.textContent = "";
  formError.hidden = true;
}

/** 将 Token 数量按参考页规则转换成“万”。 */
function formatTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number >= 10_000 ? `${(number / 10_000).toFixed(1)}万` : String(number);
}

/** 将美分转换成美元文本。 */
function formatCost(cents, digits = 2) {
  const number = Number(cents);
  return `$${((Number.isFinite(number) ? number : 0) / 100).toFixed(digits)}`;
}

/** 把会员内部值转换成页面标签。 */
function formatMembership(value) {
  const key = String(value || "").toLowerCase();
  return membershipLabels[key] || value || "未知";
}

/** 把账期毫秒值格式化为 MM/DD - MM/DD。 */
function formatBillingCycle(cycle) {
  const start = Number(cycle?.startDateEpochMillis);
  const end = Number(cycle?.endDateEpochMillis);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "-";
  const format = (value) => {
    const date = new Date(value);
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  };
  return `${format(start)} - ${format(end)}`;
}

/** 把事件时间格式化为 MM/DD HH:mm:ss。 */
function formatEventTime(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "-";
  const part = (number) => String(number).padStart(2, "0");
  return `${part(date.getMonth() + 1)}/${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

/** 更新百分比文字和进度条，进度条宽度最多为 100%。 */
function renderUsagePercent(prefix, value) {
  const percent = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  setText(`${prefix}-percent`, percent.toFixed(1));
  document.querySelector(`#${prefix}-progress`).style.width = `${Math.min(100, percent)}%`;
}

/** 创建只包含文本的表格单元格。 */
function createCell(value, tagName = "td") {
  const cell = document.createElement(tagName);
  cell.textContent = String(value ?? "-");
  return cell;
}

/** 渲染模型汇总表，并按请求数从高到低排序。 */
function renderModelBreakdown(modelBreakdown) {
  const entries = Object.entries(modelBreakdown || {})
    .map(([model, values]) => ({ model, ...values }))
    .sort((left, right) => right.requests - left.requests);
  modelTableBody.replaceChildren();
  document.querySelector("#model-panel").hidden = entries.length === 0;

  for (const item of entries) {
    const row = document.createElement("tr");
    row.append(
      createCell(item.model),
      createCell(item.requests),
      createCell(formatTokens(item.tokens)),
      createCell(formatCost(item.costCents)),
    );
    modelTableBody.append(row);
  }
}

/** 用报告中的模型列表更新筛选菜单。 */
function renderModelOptions(modelBreakdown) {
  const models = Object.keys(modelBreakdown || {}).sort((left, right) => left.localeCompare(right));
  modelFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "全部模型";
  modelFilter.append(allOption);

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelFilter.append(option);
  }
}

/** 把日期输入转换成本地日界线毫秒值。 */
function dateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() + (endOfDay ? 86_399_999 : 0);
}

/** 根据类型、模型和日期筛选全部事件。 */
function filteredEvents() {
  const events = detailState.report?.events || [];
  const start = dateBoundary(startDateInput.value);
  const end = dateBoundary(endDateInput.value, true);
  return events.filter((event) => {
    if (detailState.type === "included" && event.isOnDemand) return false;
    if (detailState.type === "ondemand" && !event.isOnDemand) return false;
    if (detailState.model && event.model !== detailState.model) return false;
    if (start !== null && Number(event.timestamp) < start) return false;
    if (end !== null && Number(event.timestamp) > end) return false;
    return true;
  });
}

/** 渲染一页用量事件与筛选统计。 */
function renderDetailTable() {
  const events = filteredEvents();
  const totalPages = Math.max(1, Math.ceil(events.length / detailState.pageSize));
  detailState.page = Math.min(detailState.page, totalPages);
  const startIndex = (detailState.page - 1) * detailState.pageSize;
  const pageRows = events.slice(startIndex, startIndex + detailState.pageSize);
  const includedCount = events.filter((event) => !event.isOnDemand).length;
  const costCents = events.reduce((total, event) => total + Number(event.costCents || 0), 0);

  setText("detail-count-badge", `共 ${events.length} 条`);
  setText("filtered-count", events.length);
  setText("filtered-cost", formatCost(costCents));
  setText("filtered-included", includedCount);
  setText("filtered-ondemand", events.length - includedCount);
  setText("page-indicator", `${detailState.page} / ${totalPages}`);

  detailTableBody.replaceChildren();
  for (const [index, event] of pageRows.entries()) {
    const row = document.createElement("tr");
    const typeCell = document.createElement("td");
    const typeTag = document.createElement("span");
    typeTag.className = `type-tag ${event.isOnDemand ? "type-ondemand" : "type-included"}`;
    typeTag.textContent = event.typeName;
    typeCell.append(typeTag);
    row.append(
      createCell(startIndex + index + 1),
      createCell(formatEventTime(event.timestamp)),
      createCell(event.model),
      typeCell,
      createCell(formatTokens(event.tokens)),
      createCell(event.costUsd || formatCost(event.costCents, 4)),
    );
    detailTableBody.append(row);
  }

  document.querySelector("#detail-empty").hidden = pageRows.length > 0;
  const pagination = document.querySelector("#detail-pagination");
  pagination.hidden = events.length <= detailState.pageSize;
  document.querySelector("#previous-page").disabled = detailState.page <= 1;
  document.querySelector("#next-page").disabled = detailState.page >= totalPages;
}

/** 将完整报告映射到参考图中的汇总、套餐和超额区域。 */
function renderReport(report) {
  detailState.report = report;
  detailState.type = "all";
  detailState.model = "";
  detailState.page = 1;
  detailState.pageSize = Number(pageSizeSelect.value) || 20;
  startDateInput.value = "";
  endDateInput.value = "";
  modelFilter.value = "";

  setText("account-email", report.email || report.name || "未知账号");
  setText("membership-badge", formatMembership(report.membershipType));
  setText("billing-cycle", formatBillingCycle(report.billingCycle));
  setText("total-cost", report.totalCostUsd || formatCost(report.totalCostCents));
  setText("total-requests", report.totalRequests ?? 0);
  setText("total-tokens", formatTokens(report.totalTokens));
  setText("total-percent", `合计 ${Number(report.totalPercentUsed || 0).toFixed(1)}%`);

  const apiUsage = report.includedBreakdown?.api || {};
  const autoUsage = report.includedBreakdown?.auto || {};
  renderUsagePercent("api", apiUsage.percentUsed);
  renderUsagePercent("auto", autoUsage.percentUsed);
  setText("api-tokens", formatTokens(apiUsage.tokens));
  setText("api-cost", apiUsage.costUsd || formatCost(apiUsage.costCents));
  setText("auto-tokens", formatTokens(autoUsage.tokens));
  setText("auto-cost", autoUsage.costUsd || formatCost(autoUsage.costCents));

  setText("ondemand-cost", report.onDemandCostUsd || formatCost(report.onDemandCostCents));
  setText("ondemand-count", report.onDemandCount ?? 0);
  setText("ondemand-tokens", formatTokens(report.onDemandTokens));
  document.querySelector("#ondemand-card").classList.toggle("is-empty", !report.onDemandCount);

  document.querySelectorAll(".filter-tab").forEach((button) => {
    const active = button.dataset.type === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  renderModelBreakdown(report.modelBreakdown);
  renderModelOptions(report.modelBreakdown);
  renderDetailTable();
  resultPanel.hidden = false;
}

/** 提交 Token 到本机代理；Token 仅保存在输入框与本次请求内。 */
async function queryQuota() {
  const token = tokenInput.value.trim();
  clearError();
  if (!token) {
    showError("请先粘贴 Cursor Token");
    tokenInput.focus();
    return;
  }

  setLoading(true);
  try {
    const response = await fetch("/api/quota-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || "查询失败，请稍后重试");
    }
    renderReport(payload.data);
  } catch (error) {
    resultPanel.hidden = true;
    showError(error?.message || "查询失败，请稍后重试");
  } finally {
    setLoading(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  queryQuota();
});

tokenInput.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    queryQuota();
  }
});

tokenInput.addEventListener("input", clearError);

document.querySelectorAll(".filter-tab").forEach((button) => {
  button.addEventListener("click", () => {
    detailState.type = button.dataset.type;
    detailState.page = 1;
    document.querySelectorAll(".filter-tab").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    renderDetailTable();
  });
});

modelFilter.addEventListener("change", () => {
  detailState.model = modelFilter.value;
  detailState.page = 1;
  renderDetailTable();
});

startDateInput.addEventListener("change", () => {
  detailState.page = 1;
  renderDetailTable();
});

endDateInput.addEventListener("change", () => {
  detailState.page = 1;
  renderDetailTable();
});

pageSizeSelect.addEventListener("change", () => {
  detailState.pageSize = Number(pageSizeSelect.value) || 20;
  detailState.page = 1;
  renderDetailTable();
});

document.querySelector("#previous-page").addEventListener("click", () => {
  detailState.page = Math.max(1, detailState.page - 1);
  renderDetailTable();
});

document.querySelector("#next-page").addEventListener("click", () => {
  detailState.page += 1;
  renderDetailTable();
});
