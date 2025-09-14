// /static/js/chartLoader.js
// Build custom dashboard with constraints + filters + value labels (dynamic X & Y)

import { apiFetch } from "./dataApi.js";
import {
  FIELD_RULES_BY_KEY,
  GLOBAL_GUARDS,
  normalizeValue,
  validateRow,
  allowedYForX,
  computeSeriesFromGroups,
  enforceSelectionGuards,
} from "./constraints.js";

let dataset = [];

/* ---------------------------------- */
/* Header normalization (CSV/Excel → rules) */
/* ---------------------------------- */
const HEADER_MAP = {
  // Add any friendly→machine mappings here if needed; pass-through otherwise.
  "StudentId": "studentid",
  "FirstName": "firstname",
  "LastName": "lastname",
  "Nickname": "nickname",
  "Age": "age",
  "Statement Count": "statement_count",
  "Number of Study Periods": "number_of_study_periods",
  "CourseAttempt": "courseattempt",
  "Campus_Name": "campus_name",
  "Region": "region",
  "Nationality": "nationality",
  "Visa Status": "visa_status",
  "CourseType": "coursetype",
  "CourseId": "courseid",
  "CourseName": "coursename",
  "Study Reason": "study_reason",
  "Mode of Study": "mode_of_study",
  "Gender": "gender",
  "AgentName": "agentname",
  "Agent Name": "agentname",
  "Education Agent Name (if any)": "education_agent_name_if_any",
  "CourseManager": "coursemanager",
  "Course Manager": "coursemanager",
  "OfferId": "offerid",
  "Stage": "stage",
  "Status": "status",
  "Application Status": "application_status",
  "DOB": "dob",
  "StartDate": "startdate",
  "FinishDate": "finishdate",
  "Offer Expiry Date": "offer_expiry_date",
  "Application Date": "application_date",
  "Do you want to pay more than 50% upfront fee?": "do_you_want_to_pay_more_than_50_upfront_fee",
  "Are you currently or planning to study English whilst in Australia?": "are_you_currently_or_planning_to_study_english_whilst_in_australia",
  "Is the offer deferred?": "is_the_offer_deferred",
  "Previous Offer Intake": "previous_offer_intake",
  "Previous Offer Year": "previous_offer_year",
  "CoENo": "coeno",
};

function normalizeColumns(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[HEADER_MAP[k] || k] = v;
  return out;
}

/**
 * Dynamically register every dataset column in FIELD_RULES_BY_KEY:
 * - All fields become X-eligible via role "dimension" (and "time" for dates)
 * - Numeric fields also become Y-eligible via role "measure"
 * - All fields are filterable
 */
function bootstrapConstraintsFromDataset(rows) {
  if (!rows?.length) return;

  const looksLikeDate = s =>
    typeof s === "string" &&
    (/\d{4}-\d{2}-\d{2}/.test(s) || /\d{2}\/\d{2}\/\d{4}/.test(s));

  // Infer types by scanning a few rows (robust against sparse columns)
  const sampleCount = Math.min(50, rows.length);
  const typeHints = {}; // { key: {num:true, date:true, bool:true, str:true} }

  for (let i=0; i<sampleCount; i++){
    const r = rows[i];
    for (const [key, raw] of Object.entries(r)) {
      const v = raw;
      const t = (typeHints[key] ||= { num:false, date:false, bool:false, str:false });
      if (v == null || v === "") continue;
      if (typeof v === "number") t.num = true;
      else if (typeof v === "boolean") t.bool = true;
      else if (typeof v === "string") {
        if (looksLikeDate(v)) t.date = true;
        else if (["yes","no","true","false","y","n","0","1"].includes(v.trim().toLowerCase())) t.bool = true;
        else if (!Number.isNaN(Number(v)) && v.trim() !== "") t.num = true;
        else t.str = true;
      } else {
        t.str = true;
      }
    }
  }

  Object.keys(rows[0]).forEach(key => {
    if (FIELD_RULES_BY_KEY[key]) return; // keep existing virtuals etc.

    const hint = typeHints[key] || {};
    let type = "categorical";
    if (hint.date) type = "date";
    else if (hint.num && !hint.str) type = "numeric";
    else if (hint.bool && !hint.str) type = "boolean";

    const roles = new Set(["dimension", "filter"]); // ALL fields on X as requested
    if (type === "date") roles.add("time");
    if (type === "numeric") roles.add("measure");

    FIELD_RULES_BY_KEY[key] = {
      type,
      roles: Array.from(roles),
      // generous category cap to honor "all fields" on X
      maxAxisCardinality: 200
    };
  });
}

/* ------------------ DOM helpers ------------------ */
function createSelect(options, className) {
  const sel = document.createElement("select");
  sel.className = `form-select ${className}`;
  options.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = FIELD_RULES_BY_KEY[opt]?.label || opt;
    sel.appendChild(o);
  });
  return sel;
}

function keysForRole(role) {
  return Object.entries(FIELD_RULES_BY_KEY)
    .filter(([, r]) => r.roles?.includes(role))
    .map(([k]) => k);
}

function populateXForChartType(selectEl, chartType) {
  selectEl.innerHTML = "";
  // Put *all* fields as options on X
  const xKeys = new Set([
    ...keysForRole("dimension"),
    ...keysForRole("time"),
  ]);
  Array.from(xKeys).forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = FIELD_RULES_BY_KEY[k]?.label || k;
    selectEl.appendChild(opt);
  });
}

function populateYForX(selectEl, xField) {
  selectEl.innerHTML = "";
  allowedYForX(xField).forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = FIELD_RULES_BY_KEY[k]?.label || k;
    selectEl.appendChild(opt);
  });
}

function uniqueValues(field) {
  return Array.from(new Set(dataset.map(r => r[field]))).sort();
}

function addFilterRow(container) {
  const row = document.createElement("div");
  row.className = "row g-2 align-items-center filter-row mt-1";

  const fieldCol = document.createElement("div");
  fieldCol.className = "col";
  const filterable = Object.keys(FIELD_RULES_BY_KEY); // every field can filter
  const fieldSelect = createSelect(filterable, "filter-field form-select-sm");
  fieldCol.appendChild(fieldSelect);

  const valueCol = document.createElement("div");
  valueCol.className = "col";
  const valueSelect = document.createElement("select");
  valueSelect.className = "form-select form-select-sm filter-value";
  valueCol.appendChild(valueSelect);

  const removeCol = document.createElement("div");
  removeCol.className = "col-auto";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-outline-danger btn-sm";
  removeBtn.textContent = "×";
  removeCol.appendChild(removeBtn);

  row.appendChild(fieldCol); row.appendChild(valueCol); row.appendChild(removeCol);
  container.appendChild(row);

  const updateValues = () => {
    const vals = uniqueValues(fieldSelect.value);
    valueSelect.innerHTML = "";
    vals.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      valueSelect.appendChild(opt);
    });
  };
  fieldSelect.addEventListener("change", updateValues);
  updateValues();

  removeBtn.addEventListener("click", () => row.remove());
}

function applyFilters(data, card) {
  const filters = Array.from(card.querySelectorAll(".filter-row")).map(row => ({
    field: row.querySelector(".filter-field").value,
    value: row.querySelector(".filter-value").value,
  }));
  return data.filter(r => filters.every(f => String(r[f.field]) === f.value));
}

function ensureMsgBox(card) {
  let el = card.querySelector(".chart-error");
  if (!el) {
    el = document.createElement("div");
    el.className = "chart-error text-danger mt-2";
    el.style.display = "none";
    card.querySelector(".card-body").appendChild(el);
  }
  return el;
}

/* --------- Value labels (counts/percentages) --------- */
function drawValueLabels(chart, chartType) {
  const inst = chart.chart || chart;
  const ctx   = inst.ctx;
  const ds    = inst.data?.datasets?.[0];
  if (!ds) return;

  ctx.save();
  ctx.fillStyle   = "#333";
  ctx.textAlign   = "center";
  ctx.textBaseline= "bottom";
  ctx.font        = "bold 11px sans-serif";

  if (chartType === "pie" || chartType === "doughnut") {
    const meta  = inst.getDatasetMeta(0);
    const total = (ds.data || []).reduce((a,b)=>a+(Number(b)||0), 0) || 1;
    (meta.data || []).forEach((arc, i) => {
      const val = Number(ds.data[i]);
      if (!isFinite(val)) return;
      const pos = arc.tooltipPosition ? arc.tooltipPosition() : arc.getCenterPoint();
      const pct = Math.round((val/total) * 100);
      ctx.fillText(`${pct}%`, pos.x, pos.y);
    });
  } else {
    const meta = inst.getDatasetMeta(0);
    (meta.data || []).forEach((elem, i) => {
      const val = ds.data[i];
      if (val == null) return;
      const pos = elem.tooltipPosition ? elem.tooltipPosition() : elem.getCenterPoint();
      ctx.fillText(String(val), pos.x, pos.y - 6);
    });
  }

  ctx.restore();
}

/* ---------------- Chart rendering ---------------- */
function buildChart(card, canvas) {
  const type = card.querySelector(".chart-type").value;
  const xField = card.querySelector(".x-field").value;
  const yField = card.querySelector(".y-field").value;

  const filtered = applyFilters(dataset, card);
  const guard = enforceSelectionGuards({ type, xField, yField, rows: filtered });
  const msg = ensureMsgBox(card);

  if (!guard.ok) {
    msg.textContent = guard.reason;
    msg.style.display = "block";
    if (canvas._chart) canvas._chart.destroy();
    return;
  }
  msg.style.display = "none";

  const grouped = {};
  filtered.forEach(r => {
    const key = r[xField] ?? "Unknown";
    (grouped[key] ||= []).push(r);
  });

  const labels = Object.keys(grouped);
  const values = computeSeriesFromGroups(grouped, yField);

  const ctx = canvas.getContext("2d");
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label: `${(FIELD_RULES_BY_KEY[yField]?.label || yField)} by ${xField}`,
        data: values,
        backgroundColor: "rgba(98,144,195,0.25)",
        borderColor: "rgba(98,144,195,1)",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      animation: false,
      layout: { padding: { top: 16 } },
      scales: (type !== "pie" && type !== "doughnut")
        ? { y: { beginAtZero: true, ticks: { precision: 0 } } }
        : undefined,
      plugins: { legend: { display: true } }
    },
    plugins: [{
      id: "value-labels",
      afterDatasetsDraw: chart => drawValueLabels(chart, type)
    }]
  });
}

/* ---------------- Card UI ---------------- */
function addChartCard() {
  const container = document.getElementById("charts");
  const card = document.createElement("div");
  card.className = "card mb-3 chart-card";
  const body = document.createElement("div");
  body.className = "card-body";

  const row = document.createElement("div"); row.className = "row g-2";

  const typeCol = document.createElement("div"); typeCol.className = "col";
  const typeLabel = document.createElement("label"); typeLabel.textContent = "Chart Type";
  const typeSelect = createSelect(["bar", "line", "pie", "doughnut"], "chart-type");
  typeCol.appendChild(typeLabel); typeCol.appendChild(typeSelect);

  const xCol = document.createElement("div"); xCol.className = "col";
  const xLabel = document.createElement("label"); xLabel.textContent = "X-Axis";
  const xSelect = document.createElement("select"); xSelect.className = "form-select x-field";
  populateXForChartType(xSelect, typeSelect.value);
  xCol.appendChild(xLabel); xCol.appendChild(xSelect);

  const yCol = document.createElement("div"); yCol.className = "col";
  const yLabel = document.createElement("label"); yLabel.textContent = "Y-Axis";
  const ySelect = document.createElement("select"); ySelect.className = "form-select y-field";
  populateYForX(ySelect, xSelect.value);
  yCol.appendChild(yLabel); yCol.appendChild(ySelect);

  row.appendChild(typeCol); row.appendChild(xCol); row.appendChild(yCol);
  body.appendChild(row);

  const filtersDiv = document.createElement("div"); filtersDiv.className = "filters mt-2"; body.appendChild(filtersDiv);

  const addFilterBtn = document.createElement("button");
  addFilterBtn.type = "button"; addFilterBtn.className = "btn btn-secondary btn-sm mt-2"; addFilterBtn.textContent = "Add Filter";
  const genBtn = document.createElement("button");
  genBtn.type = "button"; genBtn.className = "btn btn-success btn-sm mt-2 ms-2"; genBtn.textContent = "Generate";
  const dlBtn = document.createElement("button");
  dlBtn.type = "button"; dlBtn.className = "btn btn-outline-primary btn-sm mt-2 ms-2"; dlBtn.textContent = "Download";
  const rmBtn = document.createElement("button");
  rmBtn.type = "button"; rmBtn.className = "btn btn-outline-danger btn-sm mt-2 ms-2"; rmBtn.textContent = "Remove";

  body.appendChild(addFilterBtn); body.appendChild(genBtn); body.appendChild(dlBtn); body.appendChild(rmBtn);

  const canvas = document.createElement("canvas"); canvas.className = "mt-3 chart"; body.appendChild(canvas);

  card.appendChild(body); container.appendChild(card);

  addFilterBtn.addEventListener("click", () => addFilterRow(filtersDiv));
  typeSelect.addEventListener("change", () => {
    populateXForChartType(xSelect, typeSelect.value);
    populateYForX(ySelect, xSelect.value);
  });
  xSelect.addEventListener("change", () => populateYForX(ySelect, xSelect.value));
  genBtn.addEventListener("click", () => buildChart(card, canvas));
  dlBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png"); link.download = "chart.png"; link.click();
  });
  rmBtn.addEventListener("click", () => card.remove());
}

/* ---------------- Dashboard actions ---------------- */
function resetDashboard() { document.getElementById("charts").innerHTML = ""; }
function saveDashboard() {
  const cfg = Array.from(document.querySelectorAll(".chart-card")).map(card => ({
    type: card.querySelector(".chart-type").value,
    xField: card.querySelector(".x-field").value,
    yField: card.querySelector(".y-field").value,
    filters: Array.from(card.querySelectorAll(".filter-row")).map(row => ({
      field: row.querySelector(".filter-field").value,
      value: row.querySelector(".filter-value").value
    }))
  }));
  console.log("Dashboard configuration", cfg);
  alert("Dashboard configuration saved to console.");
}

/* ---------------- Init ---------------- */
async function init() {
  try {
    const raw = await apiFetch("/api/data");

    dataset = raw
      .map(normalizeColumns)
      .map(r => {
        // basic normalization hooks (safe no-ops if keys absent)
        for (const k of Object.keys(r)) r[k] = normalizeValue(k, r[k]);
        return r;
      })
      .filter(r => validateRow(r).ok);

    // Build rules for every field so ALL are valid X choices
    bootstrapConstraintsFromDataset(dataset);

    document.getElementById("addChart").addEventListener("click", addChartCard);
    document.getElementById("resetDashboard").addEventListener("click", resetDashboard);
    document.getElementById("saveDashboard").addEventListener("click", saveDashboard);

    addChartCard();
  } catch (err) {
    console.error("Failed to load data", err);
  }
}

document.addEventListener("DOMContentLoaded", init);
