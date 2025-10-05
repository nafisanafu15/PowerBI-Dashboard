const chartCanvas = document.getElementById("mainChart");
const tableElement = document.getElementById("dataTable");
const tableBody = tableElement?.querySelector("tbody");
const tableWrapper = tableElement?.parentElement;

const statusSelect = document.getElementById("filter-status");
const agentSelect = document.getElementById("filter-agent");
const courseSelect = document.getElementById("filter-course");
const visaSelect = document.getElementById("filter-visa");
const sortButtons = Array.from(document.querySelectorAll(".sort-buttons [data-sort]"));
const chartButtons = Array.from(document.querySelectorAll(".chart-btn"));

const DEFAULT_CHART_TYPE = "line";

const state = {
  chartType: DEFAULT_CHART_TYPE,
  sortKey: "revenue-desc",
  filters: {
    status: "",
    agent: "",
    course: "",
    visa: "",
  },
  dateRange: null,
};

let rawRows = [];
let chartInstance = null;

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

init();

async function init() {
  if (!chartCanvas || !tableBody) return;

  try {
    rawRows = await fetchRows();
    populateFilterOptions();
    setupInteractions();
    applyFilters();
  } catch (error) {
    console.error("revenue forecast report", error);
    showEmptyMessage("Unable to load revenue forecast data");
  }
}

async function fetchRows() {
  const response = await fetch("/api/revenue-forecast", { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function setupInteractions() {
  if (statusSelect) statusSelect.addEventListener("change", () => updateFilter("status", statusSelect.value));
  if (agentSelect) agentSelect.addEventListener("change", () => updateFilter("agent", agentSelect.value));
  if (courseSelect) courseSelect.addEventListener("change", () => updateFilter("course", courseSelect.value));
  if (visaSelect) visaSelect.addEventListener("change", () => updateFilter("visa", visaSelect.value));

  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.sortKey = key;
      updateActiveSort();
      applyFilters();
    });
  });
  updateActiveSort();

  chartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type || DEFAULT_CHART_TYPE;
      if (state.chartType === type) return;
      state.chartType = type;
      updateChartButtonState();
      applyFilters();
    });
  });
  updateChartButtonState();

  if (typeof window.initTimePeriodFilter === "function") {
    const root = document.querySelector(".time-filter");
    window.initTimePeriodFilter(root, (from, to) => {
      if (from && to) {
        const start = startOfDay(from);
        const end = endOfDay(to);
        state.dateRange = { from: start, to: end };
      } else {
        state.dateRange = null;
      }
      applyFilters();
    });
  }
}

function populateFilterOptions() {
  const statusValues = new Set();
  const agentValues = new Set();
  const courseValues = new Set();
  const visaValues = new Set();

  rawRows.forEach((row) => {
    statusValues.add((getValue(row, ["status", "Status"]) || "Unknown").toString().trim());
    agentValues.add((getValue(row, ["agent", "Agent"]) || "Unassigned").toString().trim());
    courseValues.add((getValue(row, ["course_type", "Course Type", "coursetype"]) || "Unknown").toString().trim());
    visaValues.add((getValue(row, ["visa_status", "Visa Status", "visa_type", "Visa Type"]) || "Unknown").toString().trim());
  });

  fillSelect(statusSelect, statusValues);
  fillSelect(agentSelect, agentValues);
  fillSelect(courseSelect, courseValues);
  fillSelect(visaSelect, visaValues);
}

function fillSelect(select, values) {
  if (!select) return;
  const current = select.value;
  const sortedValues = Array.from(values)
    .map((value) => value || "Unknown")
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));

  while (select.options.length > 1) {
    select.remove(1);
  }

  sortedValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if (current && sortedValues.includes(current)) {
    select.value = current;
  }
}

function updateFilter(key, value) {
  state.filters[key] = value || "";
  applyFilters();
}

function updateActiveSort() {
  sortButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sortKey);
  });
}

function updateChartButtonState() {
  chartButtons.forEach((button) => {
    button.classList.toggle("active", (button.dataset.type || DEFAULT_CHART_TYPE) === state.chartType);
  });
}

function applyFilters() {
  if (!Array.isArray(rawRows) || !rawRows.length) {
    showEmptyMessage("No revenue forecast data available");
    return;
  }

  const filtered = rawRows.filter(matchesFilters);
  const aggregated = aggregateByMonth(filtered);

  if (!aggregated.length || aggregated.every((row) => row.revenue === 0 && row.students === 0)) {
    showEmptyMessage("No forecast data matches the selected filters");
    return;
  }

  const sorted = sortAggregatedRows(aggregated);
  render(sorted);
}

function matchesFilters(row) {
  const status = (getValue(row, ["status", "Status"]) || "Unknown").toString().trim();
  const agent = (getValue(row, ["agent", "Agent"]) || "Unassigned").toString().trim();
  const course = (getValue(row, ["course_type", "Course Type", "coursetype"]) || "Unknown").toString().trim();
  const visa = (getValue(row, ["visa_status", "Visa Status", "visa_type", "Visa Type"]) || "Unknown").toString().trim();

  if (state.filters.status && status !== state.filters.status) return false;
  if (state.filters.agent && agent !== state.filters.agent) return false;
  if (state.filters.course && course !== state.filters.course) return false;
  if (state.filters.visa && visa !== state.filters.visa) return false;

  if (!state.dateRange) return true;
  const date = parseDateLike(
    getValue(row, ["forecast_month", "forecastMonth"]) || getValue(row, ["start_date", "Start_Date", "StartDate"])
  );
  if (!date) return false;
  return date >= state.dateRange.from && date <= state.dateRange.to;
}

function aggregateByMonth(rows) {
  const horizon = buildMonthSeries(12, new Date());
  const monthMap = new Map(horizon.map((date) => [monthKey(date), {
    date,
    revenue: 0,
    students: new Set(),
  }]));

  rows.forEach((row, index) => {
    const dateValue =
      parseDateLike(getValue(row, ["forecast_month", "forecastMonth"])) ||
      parseDateLike(getValue(row, ["start_date", "Start_Date", "StartDate"]));
    if (!dateValue) return;
    const key = monthKey(startOfMonth(dateValue));

    if (!monthMap.has(key)) {
      const monthDate = startOfMonth(dateValue);
      monthMap.set(key, { date: monthDate, revenue: 0, students: new Set() });
    }

    const entry = monthMap.get(key);
    entry.revenue += toNumber(getValue(row, ["enrolment_fees", "Enrolment_Fees", "revenue"]));
    const studentId =
      getValue(row, ["student_id", "Student_Id", "Student ID"]) ||
      getValue(row, ["offer_id", "Offer_Id", "Offer ID", "offerId"]) ||
      `row-${index}`;
    entry.students.add(String(studentId));
  });

  const months = Array.from(monthMap.values())
    .filter((entry) => !state.dateRange || (entry.date >= startOfMonth(state.dateRange.from) && entry.date <= startOfMonth(state.dateRange.to)))
    .sort((a, b) => a.date - b.date)
    .map((entry) => ({
      month: monthKey(entry.date),
      label: monthLabel(entry.date),
      revenue: entry.revenue,
      students: entry.students.size,
    }));

  return months;
}

function sortAggregatedRows(rows) {
  const sorted = rows.slice();
  switch (state.sortKey) {
    case "revenue-asc":
      sorted.sort((a, b) => a.revenue - b.revenue || a.month.localeCompare(b.month));
      break;
    case "students-desc":
      sorted.sort((a, b) => b.students - a.students || a.month.localeCompare(b.month));
      break;
    case "students-asc":
      sorted.sort((a, b) => a.students - b.students || a.month.localeCompare(b.month));
      break;
    case "revenue-desc":
    default:
      sorted.sort((a, b) => b.revenue - a.revenue || a.month.localeCompare(b.month));
      break;
  }
  return sorted;
}

function render(rows) {
  if (state.chartType === "table") {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    chartCanvas.style.display = "none";
    tableWrapper.style.display = "block";
    renderTable(rows);
    return;
  }

  tableWrapper.style.display = "none";
  chartCanvas.style.display = "block";
  renderChart(rows);
}

function renderTable(rows) {
  tableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const monthCell = document.createElement("td");
    monthCell.textContent = row.label;
    const revenueCell = document.createElement("td");
    revenueCell.textContent = currencyFormatter.format(row.revenue || 0);
    const studentsCell = document.createElement("td");
    studentsCell.textContent = row.students.toString();
    tr.append(monthCell, revenueCell, studentsCell);
    tableBody.appendChild(tr);
  });
}

function renderChart(rows) {
  const labels = rows.map((row) => row.label);
  const data = rows.map((row) => row.revenue);
  const type = state.chartType === "bar" ? "bar" : "line";

  const dataset = {
    label: "Forecast Revenue",
    data,
    backgroundColor: type === "bar" ? "#2563eb" : "rgba(37, 99, 235, 0.15)",
    borderColor: "#2563eb",
    fill: type !== "bar",
    tension: type === "bar" ? 0 : 0.25,
  };

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(chartCanvas, {
    type,
    data: { labels, datasets: [dataset] },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const value = ctx.parsed.y || 0;
              return ` ${currencyFormatter.format(value)}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback(value) {
              return currencyFormatter.format(value);
            },
          },
        },
      },
    },
  });
}

function showEmptyMessage(message) {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  chartCanvas.style.display = "none";
  tableWrapper.style.display = "block";
  tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">${message}</td></tr>`;
}

function getValue(row, keys) {
  for (const key of keys) {
    if (key in row) return row[key];
    const normalized = key.toLowerCase();
    for (const prop in row) {
      if (!Object.prototype.hasOwnProperty.call(row, prop)) continue;
      if (prop.toLowerCase() === normalized) return row[prop];
      if (prop.replace(/[_\s]+/g, "").toLowerCase() === normalized.replace(/[_\s]+/g, "")) {
        return row[prop];
      }
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const primary = new Date(trimmed);
  if (!Number.isNaN(primary.getTime())) return primary;
  const fallback = new Date(trimmed.replace(/-/g, "/"));
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function buildMonthSeries(count, startDate) {
  const base = startOfMonth(startDate);
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(base.getTime());
    date.setMonth(base.getMonth() + i);
    months.push(date);
  }
  return months;
}

function startOfMonth(date) {
  const d = new Date(date.getTime());
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date) {
  return date.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
