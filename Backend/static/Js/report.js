// static/js/report.js
// Handles generic report pages: fetching data, applying filters and rendering

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.reportConfig || {};
  const chartEl = document.getElementById("mainChart");
  const tableEl = document.getElementById("dataTable");
  const tableWrap = tableEl ? tableEl.parentElement : null;
  const tableBody = tableEl ? tableEl.querySelector("tbody") : null;
  if (!chartEl || !tableWrap || !tableBody) return;

  let chart;
  let baseRows = [];
  let filteredRows = [];
  const isMatrix = Boolean(cfg.matrix && cfg.matrix.rowField && cfg.matrix.columnField && cfg.matrix.valueField);
  const customFilterState = new Map();

  const state = {
    chartType: getDefaultType(cfg),
    sortKey: null,
    intakes: new Set(),
    timeRange: null,
    customFilters: customFilterState
  };

  fetchData(cfg)
    .then(raw => {
      baseRows = isMatrix ? normalizeMatrixRows(raw, cfg) : cleanRows(raw, cfg);
      if (!baseRows.length) {
        showEmpty();
        return;
      }

      setupCustomFilters(baseRows);
      setupInteractions();
      applyFilters();
    })
    .catch(err => showEmpty(`Error: ${err.message}`));

  function setupInteractions() {
    setupChartButtons();
    setupSortButtons();
    setupIntakeButtons();
    setupTimeFilter();
  }

  function setupChartButtons() {
    const buttons = Array.from(document.querySelectorAll(".chart-btn"));
    if (!buttons.length) return;

    const applyActiveState = () => {
      buttons.forEach(btn => {
        const isActive = (btn.dataset.type || "bar") === state.chartType;
        btn.classList.toggle("active", isActive);
      });
    };

    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type || "bar";
        if (type === state.chartType) return;
        state.chartType = type;
        applyActiveState();
        applyFilters();
      });
    });

    applyActiveState();
  }

  function setupSortButtons() {
    const buttons = Array.from(document.querySelectorAll(".sort-buttons [data-sort]"));
    if (!buttons.length) return;

    const updateButtonState = () => {
      buttons.forEach(btn => {
        const key = btn.dataset.sort;
        btn.classList.toggle("active", key === state.sortKey);
      });
    };

    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.sort;
        if (!key) return;
        state.sortKey = state.sortKey === key ? null : key;
        updateButtonState();
        applyFilters();
      });
    });

    updateButtonState();
  }

  function setupIntakeButtons() {
    const checkboxSelectors = [".intake-buttons input[type='checkbox']", ".intake-filter input[type='checkbox']"]; // support legacy classes
    let checkboxes = [];
    checkboxSelectors.some(selector => {
      checkboxes = Array.from(document.querySelectorAll(selector));
      return checkboxes.length;
    });

    if (checkboxes.length) {
      state.intakes = state.intakes instanceof Set ? state.intakes : new Set();
      checkboxes.forEach(input => {
        const value = normalizeIntake(input.value || input.dataset.sem || "");
        if (input.checked) state.intakes.add(value);
        input.addEventListener("change", () => {
          if (input.checked) {
            state.intakes.add(value);
          } else {
            state.intakes.delete(value);
          }
          applyFilters();
        });
      });
      return;
    }

    const buttons = Array.from(document.querySelectorAll(".intake-buttons [data-sem]"));
    if (!buttons.length) return;

    const refreshUi = () => {
      buttons.forEach(btn => {
        const normalized = normalizeIntake(btn.dataset.sem);
        btn.classList.toggle("active", state.intakes.has(normalized));
      });
    };

    buttons.forEach(btn => {
      const value = normalizeIntake(btn.dataset.sem);
      btn.addEventListener("click", () => {
        if (state.intakes.has(value)) {
          state.intakes.delete(value);
        } else {
          state.intakes.add(value);
        }
        refreshUi();
        applyFilters();
      });
    });

    refreshUi();
  }

  function setupTimeFilter() {
    if (typeof window.initTimePeriodFilter !== "function") return;
    const root = document.querySelector(".time-filter");
    if (!root) return;

    window.initTimePeriodFilter(root, (from, to) => {
      if (from && to) {
        const start = startOfDay(from);
        const end = endOfDay(to);
        state.timeRange = start && end ? { from: start, to: end } : null;
      } else {
        state.timeRange = null;
      }
      applyFilters();
    });
  }

  function setupCustomFilters(rows) {
    const filters = Array.isArray(cfg.filters) ? cfg.filters : [];
    filters.forEach(filterCfg => {
      if (!filterCfg || !filterCfg.field || !filterCfg.selector) return;
      const container = document.querySelector(filterCfg.selector);
      if (!container) return;
      const values = unique(rows.map(row => normalizeCategory(getValue(row, filterCfg.field)))).filter(Boolean);
      if (!values.length) {
        container.textContent = 'No options';
        return;
      }
      const filterState = {
        values,
        selected: new Set(values),
        elements: []
      };
      container.classList.remove('text-muted');
      container.innerHTML = '';
      state.customFilters.set(filterCfg.field, filterState);
      renderCustomFilter(container, filterCfg.field, filterState);
    });
  }

  function renderCustomFilter(container, field, filterState) {
    const actions = document.createElement('div');
    actions.className = 'filter-actions d-flex flex-wrap gap-2 mb-2';

    const selectAll = document.createElement('button');
    selectAll.type = 'button';
    selectAll.className = 'btn btn-outline-secondary btn-sm';
    selectAll.textContent = 'Select all';
    selectAll.addEventListener('click', () => {
      filterState.selected = new Set(filterState.values);
      filterState.elements.forEach(entry => { entry.input.checked = true; });
      applyFilters();
    });

    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'btn btn-outline-secondary btn-sm';
    clearAll.textContent = 'Clear';
    clearAll.addEventListener('click', () => {
      filterState.selected.clear();
      filterState.elements.forEach(entry => { entry.input.checked = false; });
      applyFilters();
    });

    actions.append(selectAll, clearAll);
    container.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'd-flex flex-column gap-1';

    filterState.elements = [];
    filterState.values.forEach(value => {
      const id = `${field}-${slugify(value)}`;
      const label = document.createElement('label');
      label.className = 'form-check';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'form-check-input';
      input.id = id;
      input.checked = true;
      input.addEventListener('change', () => {
        if (input.checked) {
          filterState.selected.add(value);
        } else {
          filterState.selected.delete(value);
        }
        applyFilters();
      });

      const span = document.createElement('span');
      span.className = 'form-check-label';
      span.textContent = value;

      label.append(input, span);
      list.appendChild(label);
      filterState.elements.push({ value, input });
    });

    container.appendChild(list);
  }

  function applyFilters() {
    const rows = applySort(
      applyDateFilter(
        applyIntakeFilter(
          applyCustomFilters(baseRows.slice())
        )
      )
    );
    filteredRows = rows;

    if (!filteredRows.length) {
      showEmpty("No data matches the selected filters");
      return;
    }

    if (!hasMeaningfulData(filteredRows, cfg)) {
      showEmpty("Data not available for the selected filters");
      return;
    }

    renderTable(filteredRows, cfg);
    renderChartOrTable();
  }

  function applyCustomFilters(rows) {
    if (!state.customFilters || !state.customFilters.size) return rows;
    return rows.filter(row => {
      for (const [field, filterState] of state.customFilters.entries()) {
        if (!filterState || !filterState.selected || !filterState.selected.size) {
          return false;
        }
        const value = normalizeCategory(getValue(row, field));
        if (!filterState.selected.has(value)) {
          return false;
        }
      }
      return true;
    });
  }

  function applyIntakeFilter(rows) {
    if (!cfg.intakeField) return rows;
    const active = state.intakes instanceof Set ? Array.from(state.intakes).filter(Boolean) : [];
    if (!active.length) return rows;
    const activeSet = new Set(active);
    return rows.filter(row => activeSet.has(normalizeIntake(getValue(row, cfg.intakeField))));
  }

  function applyDateFilter(rows) {
    const range = state.timeRange;
    if (!range || !range.from || !range.to) return rows;
    return rows.filter(row => {
      const date = getRowDate(row);
      return Boolean(date && date >= range.from && date <= range.to);
    });
  }

  function applySort(rows) {
    if (!state.sortKey) return rows;
    const sorter = resolveSorter(state.sortKey, cfg);
    if (typeof sorter !== "function") return rows;
    return rows.sort((a, b) => sorter(a, b));
  }

  function renderChartOrTable() {
    if (state.chartType === "table") {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      chartEl.style.display = "none";
      tableWrap.style.display = "block";
      return;
    }

    tableWrap.style.display = "none";
    chartEl.style.display = "block";
    renderChart(filteredRows, state.chartType);
  }

  // ---------------- helpers ----------------

  async function fetchData(cfg) {
    const list = Array.isArray(cfg.endpoints) ? cfg.endpoints : [cfg.endpoint].filter(Boolean);
    let lastErr;
    for (const url of list) {
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) {
          let message = `Fetch failed: ${r.status}`;
          try {
            const data = await r.json();
            if (data && (data.error || data.message)) {
              message = data.error || data.message;
            }
          } catch (_) {
            // Ignore JSON parse errors and fall back to default message
          }
          throw new Error(message);
        }
        return await r.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No endpoint configured");
  }

  function showEmpty(msg) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    chartEl.style.display = "none";
    tableWrap.style.display = "block";
    tableBody.innerHTML = `<tr><td colspan="${(cfg.columns || []).length || 1}" class="text-center text-muted">${msg || "No data to display"}</td></tr>`;
  }

  function getDefaultType(cfg) {
    if (cfg.defaultChartType) return cfg.defaultChartType;
    if (cfg.special === "deferred") return "bar";
    return "bar";
  }

  function renderChart(rows, type) {
    const { labels, datasets, options } = buildChartData(rows, type, cfg);
    if (chart) chart.destroy();
    chart = new Chart(chartEl, { type, data: { labels, datasets }, options });
  }

  function renderTable(rows, cfg) {
    tableBody.innerHTML = "";
    const cols = cfg.columns || [];
    rows.forEach(r => {
      const tr = document.createElement("tr");
      cols.forEach(c => {
        const td = document.createElement("td");
        td.textContent = r[c.key] ?? "";
        tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });
  }

  function cleanRows(data, cfg) {
    if (!Array.isArray(data)) return [];

    if (cfg.special === "deferred") {
      const looksAgg = data.length && (
        ("term" in data[0] || "Term" in data[0]) &&
        (("deferred" in data[0]) || ("deferred_count" in data[0]) || ("Deferred Count" in data[0]) || ("Deferred_Count" in data[0])) &&
        (("total" in data[0]) || ("total_offers" in data[0]) || ("Total Offers" in data[0]) || ("Total_Offers" in data[0]))
      );
      if (looksAgg) {
        const out = data.map(r => ({
          term: String(r.term ?? r.Term ?? "").trim(),
          deferred: toNum(r.deferred ?? r.deferred_count ?? r["Deferred Count"] ?? r["Deferred_Count"] ?? 0),
          total: toNum(r.total ?? r.total_offers ?? r["Total Offers"] ?? r["Total_Offers"] ?? 0)
        })).filter(x => x.term && !/^unknown$/i.test(x.term));
        return sortTerms(out);
      }

      const getTerm = r => {
        const intake = r["Previous Offer Intake"] ?? r.previous_offer_intake ?? r["Offer Intake"] ?? r.offer_intake ?? r.Intake;
        const year = r["Previous Offer Year"] ?? r.previous_offer_year ?? r["Offer Year"] ?? r.offer_year ?? r.Year;
        if (intake && year != null) return `${intake} ${year}`;
        if (intake) return String(intake);
        if (year != null) return String(year);
        return "Unknown";
      };

      const byTerm = new Map();
      for (const r of data) {
        const term = getTerm(r);
        const status = String(r.Status ?? r.status ?? r["Offer Status"] ?? r.offer_status ?? "").toLowerCase();
        const rec = byTerm.get(term) || { deferred: 0, total: 0 };
        rec.total += 1;
        if (status.startsWith("deferred")) rec.deferred += 1;
        byTerm.set(term, rec);
      }
      const out = [];
      byTerm.forEach((v, k) => {
        if (!/^unknown$/i.test(k)) out.push({ term: k, deferred: v.deferred, total: v.total });
      });
      return sortTerms(out);
    }

    const groupKey = cfg.groupField;
    const columns = Array.isArray(cfg.columns) ? cfg.columns.filter(Boolean) : [];
    const columnKeys = columns.map(c => c.key);
    const columnConfig = new Map(columns.map(col => [col.key, col]));
    const extras = new Set([cfg.intakeField, cfg.dateField].filter(Boolean));
    if (Array.isArray(cfg.extraFields)) {
      cfg.extraFields.forEach(k => extras.add(k));
    }

    const out = [];
    for (const row of data) {
      let label = getValue(row, groupKey);
      if (label == null) {
        label = getValue(row, "term") ?? getValue(row, "offer_status") ??
                getValue(row, "visa_type") ?? getValue(row, "visa_status") ??
                getValue(row, "Visa Type") ?? getValue(row, "Visa Status") ?? "";
      }

      if (typeof label === "string") label = label.trim();

      const isUnknown = !label || /^unknown$/i.test(String(label));
      if (isUnknown && !cfg.allowUnknown) continue;
      if (isUnknown && cfg.allowUnknown) label = "Unknown";

      const cleaned = { ...row };
      cleaned[groupKey] = label;

      for (const key of columnKeys) {
        if (key === groupKey) continue;
        const rawValue = getValue(row, key);
        const colCfg = columnConfig.get(key) || {};
        const keepRaw = colCfg.chart === false || colCfg.isMetric === false || colCfg.keepRaw;
        cleaned[key] = keepRaw ? rawValue : toNum(rawValue);
      }

      extras.forEach(extraKey => {
        if (!extraKey || extraKey === groupKey || columnKeys.includes(extraKey)) return;
        const val = getValue(row, extraKey);
        if (val !== undefined) cleaned[extraKey] = val;
      });

      out.push(cleaned);
    }
    return out;
  }

  function normalizeMatrixRows(data, cfg) {
    if (!Array.isArray(data)) return [];
    const rowField = cfg.matrix?.rowField;
    const columnField = cfg.matrix?.columnField;
    const valueField = cfg.matrix?.valueField;
    if (!rowField || !columnField || !valueField) return [];

    const extras = new Set(Array.isArray(cfg.extraFields) ? cfg.extraFields : []);
    if (Array.isArray(cfg.matrix?.extraFields)) {
      cfg.matrix.extraFields.forEach(field => extras.add(field));
    }

    return data.map(item => {
      const record = {
        [rowField]: normalizeCategory(getValue(item, rowField)),
        [columnField]: normalizeCategory(getValue(item, columnField)),
        [valueField]: toNum(getValue(item, valueField))
      };
      extras.forEach(extra => {
        if (!extra || extra === rowField || extra === columnField || extra === valueField) return;
        const value = getValue(item, extra);
        if (value !== undefined) {
          record[extra] = value;
        }
      });
      return record;
    });
  }

  function resolveSorter(key, cfg) {
    const custom = cfg.sortFns && cfg.sortFns[key];
    if (typeof custom === "function") return custom;

    if (key === "asc" || key === "desc") {
      const metricKey = getPrimaryMetricKey(cfg);
      if (!metricKey) return null;
      return key === "asc"
        ? (a, b) => toNum(a[metricKey]) - toNum(b[metricKey])
        : (a, b) => toNum(b[metricKey]) - toNum(a[metricKey]);
    }

    if (key === "offer") {
      const offerKey = findColumnKey(cfg, /offer/i);
      if (!offerKey) return null;
      return (a, b) => String(getValue(a, offerKey) ?? "").localeCompare(String(getValue(b, offerKey) ?? ""));
    }

    if (key === "status") {
      const statusKey = findColumnKey(cfg, /status/i) || cfg.groupField;
      if (!statusKey) return null;
      return (a, b) => String(getValue(a, statusKey) ?? "").localeCompare(String(getValue(b, statusKey) ?? ""));
    }

    return null;
  }

  function findColumnKey(cfg, pattern) {
    const cols = cfg.columns || [];
    for (const col of cols) {
      if (pattern.test(col.key)) return col.key;
    }
    return null;
  }

  function getPrimaryMetricKey(cfg) {
    const cols = cfg.columns || [];
    const groupKey = cfg.groupField;
    const metric = cols.find(c => c.key !== groupKey);
    return metric ? metric.key : (cols[0] && cols[0].key);
  }

  function getValue(row, key) {
    if (!row || key == null) return undefined;
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];

    const strKey = String(key);
    const snakeToCamel = strKey.replace(/[_\s]+(.)/g, (_, c) => c.toUpperCase());
    if (Object.prototype.hasOwnProperty.call(row, snakeToCamel)) return row[snakeToCamel];

    const pascal = snakeToCamel.charAt(0).toUpperCase() + snakeToCamel.slice(1);
    if (Object.prototype.hasOwnProperty.call(row, pascal)) return row[pascal];

    const spaced = strKey.replace(/_/g, " ");
    if (Object.prototype.hasOwnProperty.call(row, spaced)) return row[spaced];

    const lower = strKey.toLowerCase();
    for (const prop in row) {
      if (!Object.prototype.hasOwnProperty.call(row, prop)) continue;
      if (prop.toLowerCase() === lower) return row[prop];
      if (prop.replace(/[_\s]+/g, "").toLowerCase() === lower.replace(/[_\s]+/g, "")) {
        return row[prop];
      }
    }

    return undefined;
  }

  function normalizeIntake(val) {
    if (val == null) return "";
    const raw = String(val).trim().toLowerCase();
    if (!raw) return "";
    const compact = raw.replace(/\s+/g, "");

    const match = compact.match(/^(?:trimester|semester|term|quarter|t|s|q)(\d)$/);
    if (match) {
      const num = match[1];
      return `trimester ${num}`;
    }

    if (/^t[1-4]$/.test(raw)) {
      return `trimester ${raw.slice(1)}`;
    }

    if (/^trimester\s*[1-4]$/.test(raw)) {
      return raw.replace(/\s+/g, " ");
    }

    return raw.replace(/\s+/g, " ");
  }

  function normalizeCategory(value) {
    const str = value == null ? '' : String(value).trim();
    return str || 'Unknown';
  }

  function getRowDate(row) {
    const field = cfg.dateField || cfg.intakeField || cfg.groupField;
    if (!field) return null;
    return coerceDate(getValue(row, field));
  }

  function coerceDate(value) {
    if (value == null || value === "") return null;

    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isNaN(time) ? null : value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = Date.parse(trimmed.replace(/\./g, "/"));
    if (!Number.isNaN(parsed)) return new Date(parsed);

    return parseTermLikeDate(trimmed);
  }

  function parseTermLikeDate(str) {
    const lower = str.toLowerCase();
    const yearMatch = str.match(/(19\d{2}|20\d{2}|\d{4})/);
    if (!yearMatch) return null;
    const year = Number(yearMatch[1]);
    if (!Number.isFinite(year)) return null;

    let month = 0;
    if (/trimester\s*1|semester\s*1|\bt1\b|\bs1\b|\bq1\b/.test(lower)) month = 0;
    else if (/trimester\s*2|semester\s*2|\bt2\b|\bs2\b|\bq2\b/.test(lower)) month = 4;
    else if (/trimester\s*3|semester\s*3|\bt3\b|\bs3\b|\bq3\b/.test(lower)) month = 8;
    else if (/trimester\s*4|semester\s*4|\bt4\b|\bs4\b|\bq4\b/.test(lower)) month = 10;
    else if (/spring/.test(lower)) month = 8;
    else if (/summer/.test(lower)) month = 0;
    else if (/autumn|fall/.test(lower)) month = 2;
    else if (/winter/.test(lower)) month = 5;
    else if (/^\d{4}$/.test(str.trim())) month = 0;

    return new Date(year, month, 1);
  }

  function startOfDay(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfDay(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function buildChartData(rows, type, cfg) {
    if (cfg.matrix) {
      return buildMatrixChartData(rows, type, cfg);
    }

    if (cfg.special === "deferred") {
      const labels = rows.map(r => r.term);
      const deferred = rows.map(r => toNum(r.deferred));
      const other = rows.map(r => Math.max(toNum(r.total) - toNum(r.deferred), 0));
      return {
        labels,
        datasets: [
          { label: "Deferred", data: deferred, backgroundColor: "#FF6384", stack: "stack1" },
          { label: "Other Offers", data: other, backgroundColor: "#36A2EB", stack: "stack1" }
        ],
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom" } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      };
    }

    const g = cfg.groupField;
    const labels = rows.map(r => r[g]);
    const allCols = Array.isArray(cfg.columns) ? cfg.columns : [];
    let metricCols = allCols.filter(col => {
      if (!col || col.key === g) return false;
      if (col.chart === false || col.isMetric === false) return false;
      if (col.isMetric === true) return true;

      const key = col.key;
      return rows.some(row => isProbablyNumeric(getValue(row, key)));
    });

    if (!metricCols.length && allCols.length) {
      const fallbackKey = getPrimaryMetricKey(cfg);
      const fallbackCol = allCols.find(col => {
        if (!col || col.key === g) return false;
        if (col.chart === false || col.isMetric === false) return false;
        if (fallbackKey && col.key === fallbackKey) return true;
        return true;
      });
      if (fallbackCol) {
        metricCols = [fallbackCol];
      }
    }
    const palette = ["#36A2EB", "#FF6384", "#FF9F40", "#FFCD56", "#4BC0C0", "#9966FF"];

    const datasets = metricCols.map((c, i) => ({
      label: c.label || c.key,
      data: rows.map(r => toNum(r[c.key])),
      backgroundColor: type === "line" ? undefined : palette[i % palette.length],
      borderColor: type === "line" ? palette[i % palette.length] : undefined,
      fill: type === "line" ? false : true,
      tension: type === "line" ? 0.2 : undefined
    }));

    if (type === "doughnut" || type === "pie") {
      if (datasets.length === 1) {
        datasets[0].backgroundColor = colorsForLabels(labels);
        datasets[0].borderWidth = 1;
      }
    }

    let options = { responsive: true, plugins: { legend: { position: "bottom" } } };

    if (cfg.indexAxis) {
      options.indexAxis = cfg.indexAxis;
    }

    if (cfg.indexAxis === "y") {
      options.scales = options.scales || {};
      options.scales.x = Object.assign({ beginAtZero: true }, options.scales.x || {});
    }

    if (cfg.stacked) {
      options.scales = options.scales || {};
      options.scales.x = Object.assign({ stacked: true }, options.scales.x || {});
      options.scales.y = Object.assign({ stacked: true }, options.scales.y || {});
    }

    if (cfg.chartOptions) {
      options = mergeDeep(options, cfg.chartOptions);
    }

    return { labels, datasets, options };
  }

  function isProbablyNumeric(value) {
    if (value == null || value === "") return false;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "").trim();
      if (!cleaned) return false;
      return Number.isFinite(Number(cleaned));
    }
    return false;
  }

  function buildMatrixChartData(rows, type, cfg) {
    const rowField = cfg.matrix.rowField;
    const columnField = cfg.matrix.columnField;
    const valueField = cfg.matrix.valueField;
    const rowLabels = unique(rows.map(row => row[rowField]));
    const columnLabels = unique(rows.map(row => row[columnField]));

    if (!rowLabels.length || !columnLabels.length) {
      return { labels: [], datasets: [], options: { responsive: true } };
    }

    if (type === "doughnut" || type === "pie") {
      const totals = columnLabels.map(label => rows
        .filter(row => row[columnField] === label)
        .reduce((sum, row) => sum + toNum(row[valueField]), 0)
      );
      return {
        labels: columnLabels,
        datasets: [
          {
            data: totals,
            backgroundColor: columnLabels.map((_, idx) => FALLBACK_COLORS[idx % FALLBACK_COLORS.length])
          }
        ],
        options: { responsive: true, plugins: { legend: { position: "bottom" } } }
      };
    }

    const lookup = new Map();
    rows.forEach(row => {
      const key = `${row[rowField]}__${row[columnField]}`;
      lookup.set(key, (lookup.get(key) || 0) + toNum(row[valueField]));
    });

    const datasets = columnLabels.map((label, idx) => ({
      label,
      data: rowLabels.map(rowLabel => lookup.get(`${rowLabel}__${label}`) || 0),
      backgroundColor: type === "line" ? undefined : FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
      borderColor: FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
      fill: type === "line" ? false : true,
      tension: type === "line" ? 0.2 : undefined,
      stack: type === "bar" ? 'matrix' : undefined
    }));

    let options = { responsive: true, plugins: { legend: { position: "bottom" } } };
    if (type === "bar") {
      options.indexAxis = cfg.matrix.orientation === 'horizontal' ? 'y' : 'x';
      options.scales = {
        x: { beginAtZero: true, stacked: true },
        y: { stacked: true }
      };
    } else if (type === "line") {
      options.scales = {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true }
      };
    }

    if (cfg.chartOptions) {
      options = mergeDeep(options, cfg.chartOptions);
    }

    return { labels: rowLabels, datasets, options };
  }

  function hasMeaningfulData(rows, cfg) {
    if (!Array.isArray(rows) || !rows.length) return false;
    if (cfg.matrix) {
      const valueKey = cfg.matrix.valueField;
      return rows.some(row => toNum(row[valueKey]) > 0);
    }
    const metricKeys = (cfg.columns || [])
      .map(col => col && col.key)
      .filter(key => key && key !== cfg.groupField);
    if (!metricKeys.length) return rows.length > 0;
    return rows.some(row =>
      metricKeys.some(key => toNum(row[key]) > 0)
    );
  }

  function sortTerms(rows) {
    const order = { t1: 1, t2: 2, t3: 3, s1: 1, s2: 2, s3: 3, trimester1: 1, trimester2: 2, trimester3: 3 };
    const parseKey = t => {
      const s = String(t);
      const m = s.match(/(t|s)\s*([123])\s*(\d{4})/i) || s.match(/trimester\s*([123])\s*(\d{4})/i);
      if (m && m.length >= 3) {
        let y;
        let k;
        if (/^(t|s)$/i.test(m[1])) {
          k = (m[1] + m[2]).toLowerCase();
          y = Number(m[3]);
        } else {
          k = "trimester" + m[1];
          y = Number(m[2]);
        }
        return { y, ord: order[k] || 99 };
      }
      const m2 = s.match(/(\d{4})/);
      return { y: m2 ? Number(m2[1]) : 0, ord: 99 };
    };
    return rows.sort((a, b) => {
      const A = parseKey(a.term);
      const B = parseKey(b.term);
      return A.y !== B.y ? A.y - B.y : A.ord - B.ord || String(a.term).localeCompare(String(b.term));
    });
  }

  function unique(values) {
    return Array.from(new Set(Array.isArray(values) ? values : []));
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  }

  function mergeDeep(target, source) {
    if (!source || typeof source !== 'object') {
      return target;
    }

    const output = Array.isArray(target) ? target.slice() : { ...target };
    Object.keys(source).forEach(key => {
      const srcVal = source[key];
      if (Array.isArray(srcVal)) {
        output[key] = srcVal.slice();
        return;
      }
      if (srcVal && typeof srcVal === 'object') {
        const base = output[key] && typeof output[key] === 'object' ? output[key] : {};
        output[key] = mergeDeep(base, srcVal);
        return;
      }
      output[key] = srcVal;
    });
    return output;
  }

  const VISA_COLOR_MAP = {
    "Student Visa": "#36A2EB",
    "Temporary Visa": "#FF6384",
    "Permanent Resident": "#FF9F40",
    "Bridging Visa": "#FFCD56",
    PR: "#4BC0C0",
    "Tourist Visa": "#9966FF"
  };
  const FALLBACK_COLORS = ["#36A2EB", "#FF6384", "#FF9F40", "#FFCD56", "#4BC0C0", "#9966FF"];

  function colorsForLabels(labels) {
    return labels.map((lbl, i) => VISA_COLOR_MAP[lbl] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
  }

  function toNum(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const cleaned = v.replace(/,/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
});
