const chartCanvas = document.getElementById("mainChart");
const tableElement = document.getElementById("dataTable");
const tableBody = tableElement?.querySelector("tbody");
const tableWrapper = tableElement?.parentElement;

const courseSelect = document.getElementById("filter-course");
const visaSelect = document.getElementById("filter-visa");
const sortButtons = Array.from(document.querySelectorAll(".sort-buttons [data-sort]"));
const chartButtons = Array.from(document.querySelectorAll(".chart-btn"));

const state = {
  chartType: "stacked",
  sortKey: "students-desc",
  selectedCourse: "",
  selectedVisa: "",
  dateRange: null,
};

let rawRows = [];
let chartInstance = null;
let visaOrder = [];

init();

async function init() {
  if (!chartCanvas || !tableBody) return;
  try {
    rawRows = await fetchRows();
    visaOrder = getVisaList(rawRows);
    populateFilterOptions();
    setupInteractions();
    applyFilters();
  } catch (error) {
    console.error("student classification report", error);
    showEmptyMessage("Unable to load student classification data");
  }
}

async function fetchRows() {
  const response = await fetch("/api/student-classification", { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function setupInteractions() {
  if (courseSelect) {
    courseSelect.addEventListener("change", () => {
      state.selectedCourse = courseSelect.value || "";
      applyFilters();
    });
  }
  if (visaSelect) {
    visaSelect.addEventListener("change", () => {
      state.selectedVisa = visaSelect.value || "";
      applyFilters();
    });
  }

  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.sortKey = button.dataset.sort;
      updateSortButtons();
      applyFilters();
    });
  });
  updateSortButtons();

  chartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type || "stacked";
      if (state.chartType === type) return;
      state.chartType = type;
      updateChartButtons();
      applyFilters();
    });
  });
  updateChartButtons();

  if (typeof window.initTimePeriodFilter === "function") {
    const root = document.querySelector(".time-filter");
    window.initTimePeriodFilter(root, (from, to) => {
      if (from && to) {
        state.dateRange = { from: startOfDay(from), to: endOfDay(to) };
      } else {
        state.dateRange = null;
      }
      applyFilters();
    });
  }
}

function populateFilterOptions() {
  const courses = new Set();
  const visas = new Set();

  rawRows.forEach((row) => {
    courses.add((getValue(row, ["course_type", "Course Type", "coursetype"]) || "Unknown").toString().trim());
    visas.add((getValue(row, ["visa_status", "Visa Status", "visa_type", "Visa Type"]) || "Unknown").toString().trim());
  });

  fillSelect(courseSelect, courses);
  fillSelect(visaSelect, visas);
}

function fillSelect(select, values) {
  if (!select) return;
  while (select.options.length > 1) {
    select.remove(1);
  }
  Array.from(values)
    .sort((a, b) => a.localeCompare(b))
    .forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
}

function getVisaList(rows) {
  const visas = new Set();
  rows.forEach((row) => {
    visas.add((getValue(row, ["visa_status", "Visa Status", "visa_type", "Visa Type"]) || "Unknown").toString().trim());
  });
  return Array.from(visas).sort((a, b) => a.localeCompare(b));
}

function applyFilters() {
  if (!rawRows.length) {
    showEmptyMessage("No student data available");
    return;
  }

  const filtered = rawRows.filter(matchesFilters);
  const aggregated = aggregate(filtered);

  if (!aggregated.length) {
    showEmptyMessage("No data matches the selected filters");
    return;
  }

  const sorted = sortAggregated(aggregated);
  render(sorted);
}

function matchesFilters(row) {
  const course = (getValue(row, ["course_type", "Course Type", "coursetype"]) || "Unknown").toString().trim();
  const visa = (getValue(row, ["visa_status", "Visa Status", "visa_type", "Visa Type"]) || "Unknown").toString().trim();

  if (state.selectedCourse && course !== state.selectedCourse) return false;
  if (state.selectedVisa && visa !== state.selectedVisa) return false;

  if (!state.dateRange) return true;
  const date = parseDateLike(getValue(row, ["start_date", "Start_Date", "StartDate"]));
  if (!date) return false;
  return date >= state.dateRange.from && date <= state.dateRange.to;
}

function aggregate(rows) {
  const combos = new Map();

  rows.forEach((row, index) => {
    const course = (getValue(row, ["course_type", "Course Type", "coursetype"]) || "Unknown").toString().trim();
    const visa = (getValue(row, ["visa_status", "Visa Status", "visa_type", "Visa Type"]) || "Unknown").toString().trim();
    const studentId = (getValue(row, ["student_id", "Student_Id", "Student ID"]) || `row-${index}`).toString();
    const key = `${course}|||${visa}`;
    if (!combos.has(key)) combos.set(key, { course, visa, students: new Set() });
    combos.get(key).students.add(studentId);
  });

  return Array.from(combos.values()).map((entry) => ({
    course: entry.course,
    visa: entry.visa,
    students: entry.students.size,
  }));
}

function sortAggregated(rows) {
  const sorted = rows.slice();
  switch (state.sortKey) {
    case "students-asc":
      sorted.sort((a, b) => a.students - b.students || a.course.localeCompare(b.course) || a.visa.localeCompare(b.visa));
      break;
    case "course-asc":
      sorted.sort((a, b) => a.course.localeCompare(b.course) || a.visa.localeCompare(b.visa));
      break;
    case "students-desc":
    default:
      sorted.sort((a, b) => b.students - a.students || a.course.localeCompare(b.course) || a.visa.localeCompare(b.visa));
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
    tr.innerHTML = `<td>${row.course}</td><td>${row.visa}</td><td>${row.students}</td>`;
    tableBody.appendChild(tr);
  });
}

function renderChart(rows) {
  const courseGroups = groupByCourse(rows);
  const labels = Array.from(courseGroups.keys()).sort((a, b) => a.localeCompare(b));

  const datasets = visaOrder.map((visa, index) => ({
    label: visa,
    data: labels.map((course) => courseGroups.get(course).get(visa) || 0),
    backgroundColor: VISA_COLOR_RAMP[index % VISA_COLOR_RAMP.length],
    stack: "visa",
  }));

  const config = {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };

  if (state.chartType === "horizontal") {
    config.options.indexAxis = "y";
  }

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(chartCanvas, config);
}

function groupByCourse(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.course)) map.set(row.course, new Map());
    const visaMap = map.get(row.course);
    visaMap.set(row.visa, row.students);
  });
  return map;
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

function updateSortButtons() {
  sortButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sortKey);
  });
}

function updateChartButtons() {
  chartButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.chartType);
  });
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

const VISA_COLOR_RAMP = [
  "#0ea5e9",
  "#10b981",
  "#f97316",
  "#6366f1",
  "#facc15",
  "#ef4444",
  "#14b8a6",
];
