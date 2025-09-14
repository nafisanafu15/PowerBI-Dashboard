// /static/js/custom_dashboard.js
// Dashboard with dynamic X→Y logic, counts-only (+ averages), metric filter locked to current Y,
// storytelling under each chart, value labels, and guarded Download (disabled until a chart exists).

/* -------- (Optional) Chart.js visual defaults for this page -------- */
try {
  const root = document.querySelector('.dashboard-page') || document.documentElement;
  const css = (v, fb) => getComputedStyle(root).getPropertyValue(v)?.trim() || fb;

  Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--ink', '#1f2937');

  Chart.defaults.plugins.legend.position = 'top';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;

  Chart.defaults.elements.bar.borderRadius = 8;
  Chart.defaults.elements.bar.borderSkipped = false;

  Chart.defaults.scale.grid.color = 'rgba(148,163,184,.25)';
  Chart.defaults.scale.ticks.color = css('--muted', '#6b7280');
} catch {}

/* -------------------- State & Config -------------------- */
let dataset = [];
let FIELD_RULES_BY_KEY = {}; // key -> { type, roles:[...], label, xEligible, isId, isYear, isContinuous, virtual }
const GLOBAL_GUARDS = { minSampleSize: 5, maxAxisCategories: 200 };

const SKIP_FIELDS = new Set(["_rowid_", "rowid", "__rowid__"]);
let ORIGINAL_LABELS = {};
const MUTEX_PAIRS = new Map();

/* -------------------- Header normalization -------------------- */
const HEADER_MAP = {
  "StudentId":"studentid",
  "FirstName":"firstname",
  "LastName":"lastname",
  "Nickname":"nickname",
  "Age":"age",
  "Age Group":"age_group",
  "Statement Count":"statement_count",
  "Number of Study Periods":"number_of_study_periods",
  "CourseAttempt":"courseattempt",
  "Campus_Name":"campus_name",
  "Region":"region",
  "Nationality":"nationality",
  "Visa Status":"visa_status",
  "CourseType":"coursetype",
  "CourseId":"courseid",
  "CourseName":"coursename",
  "Study Reason":"study_reason",
  "Mode of Study":"mode_of_study",
  "Gender":"gender",
  "AgentName":"agentname",
  "CourseManager":"coursemanager",
  "OfferId":"offerid",
  "Stage":"stage",
  "Status":"status",
  "CoENo":"coeno",
  "DOB":"dob",
  "StartDate":"startdate",
  "FinishDate":"finishdate",
  "Offer Expiry Date":"offer_expiry_date",
  "Application Date":"application_date",
  "Previous Offer Intake":"previous_offer_intake",
  "Previous Offer Year":"previous_offer_year",
  "Do you want to pay more than 50% upfront fee?":"do_you_want_to_pay_more_than_50_upfront_fee",
  "Are you currently or planning to study English whilst in Australia?":"are_you_currently_or_planning_to_study_english_whilst_in_australia"
};

function snake(s){
  return String(s).trim().replace(/\s+/g,"_").replace(/[^\w]/g,"_").replace(/_+/g,"_").toLowerCase();
}
function normalizeRow(row){
  const out = {};
  for (const [k,v] of Object.entries(row)){
    const mapped = HEADER_MAP[k] || snake(k);
    if (!SKIP_FIELDS.has(mapped)) out[mapped] = v;
  }
  return out;
}

/* -------------------- Domain derivations -------------------- */
// Parse YYYY-MM-DD or DD/MM/YYYY safely -> Date | null
function toDate(val){
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  let d = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s);
  else {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
  }
  return isNaN(d?.getTime?.()) ? null : d;
}

function deriveDomainFields(row){
  const start = toDate(row.startdate);
  const finish = toDate(row.finishdate);

  if (start){
    row.intake_year = start.getFullYear();
    const q = Math.floor(start.getMonth() / 3) + 1;
    row.intake_term = `Q${q}`;
  } else {
    row.intake_year = null;
    row.intake_term = null;
  }

  if (start && finish){
    const months = (finish - start) / (1000 * 60 * 60 * 24 * 30.4375);
    row.program_duration_months = Math.max(0, Math.round(months * 10) / 10);
  } else {
    row.program_duration_months = null;
  }

  // Normalize Yes/No for friendly metrics
  const fee = String(row.do_you_want_to_pay_more_than_50_upfront_fee ?? "").toLowerCase();
  row.upfront_fee_preference = ["yes","true","y","1"].includes(fee) ? "Yes" :
                               (["no","false","n","0"].includes(fee) ? "No" : null);

  const eng = String(row.are_you_currently_or_planning_to_study_english_whilst_in_australia ?? "").toLowerCase();
  row.StudyEnglish = ["yes","true","y","1"].includes(eng) ? "Yes" :
                     (["no","false","n","0"].includes(eng) ? "No" : null);

  return row;
}

/* -------------------- Heuristics -------------------- */
function looksLikeDate(s){
  return typeof s === "string" && (/\d{4}-\d{2}-\d{2}/.test(s) || /\d{2}\/\d{2}\/\d{4}/.test(s));
}
function isLikelyIdKey(key) {
  const k = key.toLowerCase();
  return k === "studentid" || k === "offerid" || k === "courseid" || k === "coeno" || k.endsWith("_id");
}
function isLikelyYearKeyOrLabel(key, label) {
  return /(^|[^a-z])year(s)?([^a-z]|$)/i.test(label || key);
}
const CONTINUOUS_NUMERICS = new Set(["age"]);

/* -------------------- Rules bootstrap -------------------- */
function bootstrapRules(rows, originalHeaders){
  FIELD_RULES_BY_KEY = {
    __count__: { type:"numeric", roles:["measure"], virtual:true, label:"Students (count)" }
  };
  if (!rows.length) return;

  const sampleN = Math.min(100, rows.length);
  const hints = {};
  for (let i=0;i<sampleN;i++){
    const r = rows[i];
    for (const [k,raw] of Object.entries(r)){
      if (SKIP_FIELDS.has(k)) continue;
      const h = (hints[k] ||= {num:false,bool:false,date:false,str:false});
      if (raw == null || raw === "") continue;
      if (typeof raw === "number") { h.num = true; continue; }
      if (typeof raw === "boolean") { h.bool = true; continue; }
      if (typeof raw === "string"){
        const t = raw.trim().toLowerCase();
        if (looksLikeDate(raw)) h.date = true;
        else if (["yes","no","true","false","y","n","0","1"].includes(t)) h.bool = true;
        else if (!Number.isNaN(Number(raw)) && raw.trim() !== "") h.num = true;
        else h.str = true;
      } else {
        h.str = true;
      }
    }
  }

  // whitelist of good X candidates (domain-aware)
  const GOOD_X = new Set([
    "age","age_group","campus_name","nationality","visa_status",
    "study_reason","mode_of_study",
    "previous_offer_intake","previous_offer_year",
    "intake_year","intake_term","startdate","finishdate",
    "upfront_fee_preference","StudyEnglish"
  ]);

  const first = rows[0];
  for (const k of Object.keys(first)){
    if (SKIP_FIELDS.has(k)) continue;

    const pretty = originalHeaders[k] || k;
    const forcedCategorical = isLikelyIdKey(k) || isLikelyYearKeyOrLabel(k, pretty);

    const h = hints[k] || {};
    let type = "categorical";
    if (!forcedCategorical) {
      if (h.date) type = "date";
      else if (h.num && !h.str) type = "numeric";
      else if (h.bool && !h.str) type = "boolean";
    }
    const roles = new Set(["dimension","filter"]);
    if (type === "date") roles.add("time");
    if (type === "numeric") roles.add("measure");

    const rule = {
      type,
      roles: Array.from(roles),
      label: pretty,
      maxAxisCardinality: 200,
      isId: isLikelyIdKey(k),
      isYear: isLikelyYearKeyOrLabel(k, pretty),
      isContinuous: CONTINUOUS_NUMERICS.has(k),
      virtual: false
    };

    // X eligibility
    rule.xEligible =
      (rule.roles.includes("dimension") || rule.roles.includes("time")) &&
      !rule.isId &&
      (GOOD_X.has(k) || rule.roles.includes("time"));

    FIELD_RULES_BY_KEY[k] = rule;
  }

  // Friendlier field labels
  if (FIELD_RULES_BY_KEY["StudyEnglish"]) FIELD_RULES_BY_KEY["StudyEnglish"].label = "Study English";
  if (FIELD_RULES_BY_KEY["upfront_fee_preference"]) FIELD_RULES_BY_KEY["upfront_fee_preference"].label = "Upfront fee (Yes/No)";
}

/* -------------------- Code<->Name mutex -------------------- */
function addMutex(a,b){
  if (!MUTEX_PAIRS.has(a)) MUTEX_PAIRS.set(a, new Set());
  if (!MUTEX_PAIRS.has(b)) MUTEX_PAIRS.set(b, new Set());
  MUTEX_PAIRS.get(a).add(b);
  MUTEX_PAIRS.get(b).add(a);
}
function inferCodeNamePairs(){
  const keys = Object.keys(FIELD_RULES_BY_KEY).filter(k => !FIELD_RULES_BY_KEY[k].virtual);
  for (let i=0;i<keys.length;i++){
    for (let j=i+1;j<keys.length;j++){
      const a = keys[i], b = keys[j];
      const mapAB = new Map(), mapBA = new Map();
      let pairs = 0, consistentAB = 0, consistentBA = 0;
      for (const row of dataset){
        const va = row[a], vb = row[b];
        if (va == null || vb == null || va === "" || vb === "") continue;
        pairs++;
        if (!mapAB.has(va)) mapAB.set(va, vb);
        if (!mapBA.has(vb)) mapBA.set(vb, va);
        if (mapAB.get(va) === vb) consistentAB++;
        if (mapBA.get(vb) === va) consistentBA++;
      }
      if (pairs >= 20) {
        if (consistentAB/pairs > 0.97 || consistentBA/pairs > 0.97) addMutex(a,b);
      }
    }
  }
}

/* -------------------- Metric labels & X→Y map -------------------- */
// COUNTS + AVERAGES ONLY (no percentages in menu)
const METRIC_LABELS = {
  "__count__":                             "Students (count)",
  "__avg__age__":                          "Average age",
  "__avg__courseattempt__":                "Average course attempts",
  "__count_yes__upfront_fee_preference__": "Yes — Upfront fee (count)",
  "__count_yes__StudyEnglish__":           "Yes — Study English (count)"
};

// Allowed Y for each X (counts & averages only)
const X_TO_Y = {
  "studentid": ["__count__"],
  "coeno":     ["__count__"],
  "firstname": ["__count__"],
  "lastname":  ["__count__"],
  "nickname":  ["__count__"],

  "age": [
    "__count__",
    "__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__",
    "__count_yes__StudyEnglish__"
  ],
  "age_group": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "dob": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "campus_name": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "nationality": [
    "__count__",
    "__avg__age__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "visa_status": [
    "__count__",
    "__avg__age__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "startdate": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "finishdate": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "intake_year": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "intake_term": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "study_reason": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "mode_of_study": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "upfront_fee_preference": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__StudyEnglish__"
  ],
  "StudyEnglish": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__"
  ],
  "offer_expiry_date": [
    "__count__",
    "__avg__age__","__avg__courseattempt__"
  ],
  "previous_offer_intake": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ],
  "previous_offer_year": [
    "__count__",
    "__avg__age__","__avg__courseattempt__",
    "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
  ]
};

const DEFAULT_Y_SET = [
  "__count__",
  "__avg__age__","__avg__courseattempt__",
  "__count_yes__upfront_fee_preference__","__count_yes__StudyEnglish__"
];

function allowedYForX(xField){
  const keys = X_TO_Y[xField] || DEFAULT_Y_SET;
  return keys.map(key => ({ key, label: METRIC_LABELS[key] || key }));
}
function metricLabelFromKey(key){ return METRIC_LABELS[key] || key; }

/* -------------------- Grouping & metrics -------------------- */
function groupBy(rows, key){
  const g = {};
  rows.forEach(r => {
    const k = r[key] ?? "Unknown";
    (g[k] ||= []).push(r);
  });
  return g;
}

// Compute series for any Y metric key
function computeSeries(grouped, yKey){
  const labels = Object.keys(grouped);

  if (yKey === "__count__") return labels.map(l => grouped[l].length);

  // Count of "Yes" metrics: __count_yes__<field>__
  const yesCountMatch = yKey.match(/^__count_yes__(.+)__$/);
  if (yesCountMatch){
    const field = yesCountMatch[1];
    return labels.map(l => grouped[l].filter(r => String(r[field]) === "Yes").length);
  }

  // average metrics: __avg__<field>__
  const avgMatch = yKey.match(/^__avg__(.+)__$/);
  if (avgMatch){
    const field = avgMatch[1];
    return labels.map(l => {
      const nums = grouped[l].map(r => Number(r[field])).filter(n => !Number.isNaN(n));
      const sum  = nums.reduce((a,b)=>a+b,0);
      return nums.length ? sum/nums.length : 0;
    });
  }

  // fallback
  return labels.map(l => grouped[l].length);
}

/* -------------------- Filters -------------------- */
function createSelect(options, className){
  const sel = document.createElement("select");
  sel.className = `form-select ${className}`;
  options.forEach(opt => {
    const key = typeof opt === "string" ? opt : opt.key;
    const label = typeof opt === "string"
      ? (FIELD_RULES_BY_KEY[key]?.label || key)
      : opt.label;
    const o = document.createElement("option");
    o.value = key; o.textContent = label;
    sel.appendChild(o);
  });
  return sel;
}

function populateX(selectEl){
  selectEl.innerHTML = "";
  Object.keys(FIELD_RULES_BY_KEY)
    .filter(k => FIELD_RULES_BY_KEY[k].xEligible && !FIELD_RULES_BY_KEY[k].virtual && !SKIP_FIELDS.has(k))
    .forEach(k => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = FIELD_RULES_BY_KEY[k].label || k;
      selectEl.appendChild(opt);
    });
}

function populateY(selectEl, xField){
  selectEl.innerHTML = "";
  allowedYForX(xField).forEach(({key,label}) => {
    const opt = document.createElement("option");
    opt.value = key; opt.textContent = label;
    selectEl.appendChild(opt);
  });
}

function uniqueValues(field){
  return Array.from(new Set(dataset.map(r => r[field]))).sort((a,b)=>{
    const na = Number(a), nb = Number(b);
    const aNum = Number.isFinite(na), bNum = Number.isFinite(nb);
    if (aNum && bNum) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

// Field=value
function addFilterRow(container){
  const row = document.createElement("div");
  row.className = "row g-2 align-items-center filter-row mt-1";

  const fieldCol = document.createElement("div"); fieldCol.className = "col";
  const filterKeys = Object.keys(FIELD_RULES_BY_KEY).filter(k => !SKIP_FIELDS.has(k) && !FIELD_RULES_BY_KEY[k].virtual);
  const fieldSelect = createSelect(filterKeys.map(k => ({ key:k, label:FIELD_RULES_BY_KEY[k]?.label || k })), "filter-field form-select-sm");
  fieldCol.appendChild(fieldSelect);

  const valueCol = document.createElement("div"); valueCol.className = "col";
  const valueSelect = document.createElement("select"); valueSelect.className = "form-select form-select-sm filter-value";
  valueCol.appendChild(valueSelect);

  const removeCol = document.createElement("div"); removeCol.className = "col-auto";
  const removeBtn = document.createElement("button"); removeBtn.type="button"; removeBtn.className="btn btn-outline-danger btn-sm"; removeBtn.textContent = "×";
  removeCol.appendChild(removeBtn);

  row.appendChild(fieldCol); row.appendChild(valueCol); row.appendChild(removeCol);
  container.appendChild(row);

  const refreshValues = () => {
    const vals = uniqueValues(fieldSelect.value);
    valueSelect.innerHTML = "";
    vals.forEach(v => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      valueSelect.appendChild(o);
    });
  };
  fieldSelect.addEventListener("change", refreshValues);
  refreshValues();

  removeBtn.addEventListener("click", () => row.remove());
}

function applyFieldFilters(rows, card){
  const filters = Array.from(card.querySelectorAll(".filter-row")).map(r => ({
    field: r.querySelector(".filter-field").value,
    value: r.querySelector(".filter-value").value
  }));
  return rows.filter(r => filters.every(f => String(r[f.field]) === f.value));
}

// Metric filter (SHOW ONLY current Y)
function addMetricFilterRow(container, currentYProvider){
  const row = document.createElement("div");
  row.className = "row g-2 align-items-center metric-filter-row mt-1";

  const metricCol = document.createElement("div"); metricCol.className = "col-5";
  const metricSelect = document.createElement("select");
  metricSelect.className = "form-select form-select-sm metric-key";
  metricCol.appendChild(metricSelect);

  const opCol = document.createElement("div"); opCol.className = "col-3";
  const opSelect = createSelect(
    [{key:">",label:">"},{key:">=",label:">="},{key:"=",label:"="},{key:"<=",label:"<="},{key:"<",label:"<"}],
    "metric-op form-select-sm"
  );
  opCol.appendChild(opSelect);

  const valCol = document.createElement("div"); valCol.className = "col-3";
  const valInput = document.createElement("input");
  valInput.type = "number"; valInput.step = "any"; valInput.className = "form-control form-control-sm metric-threshold"; valInput.placeholder = "value";
  valCol.appendChild(valInput);

  const removeCol = document.createElement("div"); removeCol.className = "col-auto";
  const removeBtn = document.createElement("button"); removeBtn.type="button"; removeBtn.className="btn btn-outline-danger btn-sm"; removeBtn.textContent = "×";
  removeCol.appendChild(removeBtn);

  row.appendChild(metricCol); row.appendChild(opCol); row.appendChild(valCol); row.appendChild(removeCol);
  container.appendChild(row);

  const refreshMetricOption = () => {
    const yKey = currentYProvider();  // ONLY show the current Y metric
    metricSelect.innerHTML = "";
    const o = document.createElement("option");
    o.value = yKey; o.textContent = metricLabelFromKey(yKey);
    metricSelect.appendChild(o);
  };
  refreshMetricOption();

  removeBtn.addEventListener("click", () => row.remove());
  row._refreshMetricOption = refreshMetricOption;
}

function applyMetricFilters(grouped, card){
  const rows = Array.from(card.querySelectorAll(".metric-filter-row"));
  if (!rows.length) return grouped;

  const labels = Object.keys(grouped);
  const pass = {}; labels.forEach(l => pass[l] = true);

  for (const row of rows){
    const key = row.querySelector(".metric-key").value;
    const op  = row.querySelector(".metric-op").value;
    const thr = Number(row.querySelector(".metric-threshold").value);
    if (!Number.isFinite(thr)) continue;

    const series = computeSeries(grouped, key);
    labels.forEach((label, idx) => {
      if (!pass[label]) return;
      const v = Number(series[idx]) || 0;
      let ok = true;
      if (op === ">")  ok = v >  thr;
      if (op === ">=") ok = v >= thr;
      if (op === "=")  ok = v === thr;
      if (op === "<=") ok = v <= thr;
      if (op === "<")  ok = v <  thr;
      if (!ok) pass[label] = false;
    });
  }

  const out = {};
  Object.keys(pass).forEach(l => { if (pass[l]) out[l] = grouped[l]; });
  return out;
}

/* -------------------- Storytelling helpers -------------------- */
function ensureStoryBox(card){ // fallback if needed
  let box = card.querySelector(".chart-story");
  if (!box){
    box = document.createElement("div");
    box.className = "chart-story mt-3 p-2 border rounded bg-light";
    box.innerHTML = `<h6 class="mb-2 fw-bold">Graph Analysis</h6><div class="ga-body" style="white-space: pre-wrap;"></div>`;
    card.querySelector(".card-body").appendChild(box);
  }
  return box;
}
function formatInt(n){ const x = Math.round(Number(n)||0); return x.toLocaleString(); }
function formatFloat(n, d=2){
  const x = Number(n); if (!isFinite(x)) return "0";
  return x.toLocaleString(undefined, { maximumFractionDigits:d, minimumFractionDigits:d });
}
function share(part, total){ return total ? (100*part/total) : 0; }

function summarizeGroups(grouped){
  const labels = Object.keys(grouped);
  const counts = labels.map(l => grouped[l].length);
  const total = counts.reduce((a,b)=>a+b,0);
  const idxMax = counts.length ? counts.indexOf(Math.max(...counts)) : -1;
  const idxMin = counts.length ? counts.indexOf(Math.min(...counts)) : -1;
  return { labels, counts, total, idxMax, idxMin };
}
function overallAverage(grouped, field){
  let sum=0, n=0;
  Object.values(grouped).forEach(rows=>{
    rows.forEach(r=>{
      const v = Number(r[field]);
      if (!Number.isNaN(v)) { sum+=v; n++; }
    });
  });
  return n ? (sum/n) : 0;
}
function overallYesStats(grouped, field){
  let yes=0, base=0;
  Object.values(grouped).forEach(rows=>{
    rows.forEach(r=>{
      const v = r[field];
      if (v!=null) { base++; if (String(v)==="Yes") yes++; }
    });
  });
  return { yes, base, pct: share(yes, base) };
}
function friendlyY(key){ return METRIC_LABELS[key] || key; }

function buildStory({type, xField, yField}, grouped, labels, values){
  const xName = FIELD_RULES_BY_KEY[xField]?.label || xField;
  const yName = friendlyY(yField);

  const { total, idxMax, idxMin } = summarizeGroups(grouped);
  const topLabel = idxMax>=0 ? labels[idxMax] : null;
  const botLabel = idxMin>=0 ? labels[idxMin] : null;
  const topVal   = idxMax>=0 ? values[idxMax] : 0;
  const botVal   = idxMin>=0 ? values[idxMin] : 0;

  let story = `Chart: ${yName} by ${xName}\n`;

  if (yField === "__count__") {
    story += `• Total students: ${formatInt(total)}\n`;
    if (topLabel!=null) story += `• Largest group: ${topLabel} — ${formatInt(topVal)} (${formatFloat(share(topVal,total),0)}%)\n`;
    if (botLabel!=null && botLabel!==topLabel) story += `• Smallest group: ${botLabel} — ${formatInt(botVal)} (${formatFloat(share(botVal,total),0)}%)\n`;
  }
  else if (yField === "__avg__age__") {
    const overall = overallAverage(grouped, "age");
    story += `• Overall average age: ${formatFloat(overall,1)}\n`;
    if (topLabel!=null) story += `• Highest average: ${topLabel} — ${formatFloat(values[idxMax],1)}\n`;
    if (botLabel!=null && botLabel!==topLabel) story += `• Lowest average: ${botLabel} — ${formatFloat(values[idxMin],1)}\n`;
  }
  else if (yField === "__avg__courseattempt__") {
    const overall = overallAverage(grouped, "courseattempt");
    story += `• Overall average course attempts: ${formatFloat(overall,2)}\n`;
    if (topLabel!=null) story += `• Highest average: ${topLabel} — ${formatFloat(values[idxMax],2)}\n`;
    if (botLabel!=null && botLabel!==topLabel) story += `• Lowest average: ${botLabel} — ${formatFloat(values[idxMin],2)}\n`;
  }
  else if (yField === "__count_yes__upfront_fee_preference__") {
    const { yes, base, pct } = overallYesStats(grouped, "upfront_fee_preference");
    story += `• Yes (Upfront fee): ${formatInt(yes)} of ${formatInt(base)} total (${formatFloat(pct,0)}%)\n`;
    if (topLabel!=null) story += `• Most Yes by ${xName}: ${topLabel} — ${formatInt(values[idxMax])}\n`;
    if (botLabel!=null && botLabel!==topLabel) story += `• Fewest Yes by ${xName}: ${botLabel} — ${formatInt(values[idxMin])}\n`;
  }
  else if (yField === "__count_yes__StudyEnglish__") {
    const { yes, base, pct } = overallYesStats(grouped, "StudyEnglish");
    story += `• Yes (Study English): ${formatInt(yes)} of ${formatInt(base)} total (${formatFloat(pct,0)}%)\n`;
    if (topLabel!=null) story += `• Most Yes by ${xName}: ${topLabel} — ${formatInt(values[idxMax])}\n`;
    if (botLabel!=null && botLabel!==topLabel) story += `• Fewest Yes by ${xName}: ${botLabel} — ${formatInt(values[idxMin])}\n`;
  }

  if (type === "line" && yField === "__count__" && labels.length >= 3){
    const first = values[0], last = values[values.length-1];
    if (last > first) story += `• Trend: rising from ${formatInt(first)} to ${formatInt(last)}.\n`;
    else if (last < first) story += `• Trend: falling from ${formatInt(first)} to ${formatInt(last)}.\n`;
    else story += `• Trend: flat overall.\n`;
  }

  const pairs = labels.map((l,i)=>({l, v: values[i]}))
                      .sort((a,b)=> (Number(b.v)||0) - (Number(a.v)||0))
                      .slice(0, Math.min(5, labels.length));
  if (pairs.length){
    story += `\nTop ${pairs.length}:\n`;
    pairs.forEach(p => story += `  - ${p.l}: ${yField.startsWith("__avg__") ? formatFloat(p.v, (yField==="__avg__age__"?1:2)) : formatInt(p.v)}\n`);
  }

  return story.trim();
}

/* -------------------- Chart value labels & guards -------------------- */
function drawValueLabels(chart, type){
  const inst = chart.chart || chart;
  const ctx  = inst.ctx;
  const ds   = inst.data?.datasets?.[0];
  if (!ds) return;

  ctx.save();
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "bold 11px sans-serif";

  if (type === "pie" || type === "doughnut"){
    const meta  = inst.getDatasetMeta(0);
    (meta.data||[]).forEach((arc,i) => {
      const val = Number(ds.data[i]); if (!isFinite(val)) return;
      const pos = arc.tooltipPosition ? arc.tooltipPosition() : arc.getCenterPoint();
      ctx.fillText(String(Math.round(val)), pos.x, pos.y); // counts on slices
    });
  } else {
    const meta = inst.getDatasetMeta(0);
    (meta.data||[]).forEach((elem,i) => {
      const val = ds.data[i]; if (val == null) return;
      const pos = elem.tooltipPosition ? elem.tooltipPosition() : elem.getCenterPoint();
      ctx.fillText(String(Math.round(val * 100) / 100), pos.x, pos.y - 6);
    });
  }
  ctx.restore();
}
function enforceSelectionGuards({ type, xField, yField, rows }){
  if (!xField || !yField) return { ok:false, reason:"Please select both X and Y fields." };
  const mutex = MUTEX_PAIRS.get(xField);
  if (mutex && mutex.has(yField)) return { ok:false, reason:"Choose either the code field or the name field, not both." };

  if ((rows?.length||0) < GLOBAL_GUARDS.minSampleSize)
    return { ok:false, reason:`Not enough rows after filters (min ${GLOBAL_GUARDS.minSampleSize}).` };

  const isTimeX = FIELD_RULES_BY_KEY[xField]?.roles?.includes("time") || ["intake_year","intake_term","startdate","finishdate"].includes(xField);
  if (isTimeX && (type === "pie" || type === "doughnut")) return { ok:false, reason:"Use bar/line for time on X." };

  if (type !== "line"){
    const categories = new Set(rows.map(r => r[xField] ?? "Unknown"));
    const cap = FIELD_RULES_BY_KEY[xField]?.maxAxisCardinality ?? GLOBAL_GUARDS.maxAxisCategories;
    if (categories.size > cap) return { ok:false, reason:`Too many categories on X (${categories.size}). Add a filter or switch chart.` };
  }
  if (type === "pie"){
    const categories = new Set(rows.map(r => r[xField] ?? "Unknown"));
    if (categories.size > 12) return { ok:false, reason:"Pie charts work best with ≤12 categories." };
  }
  return { ok:true };
}

/* -------------------- Build chart -------------------- */
function buildChart(card, canvas){
  const type   = card.querySelector(".chart-type").value;
  const xField = card.querySelector(".x-field").value;
  const yField = card.querySelector(".y-field").value;

  let filteredRows = applyFieldFilters(dataset, card);
  const guard = enforceSelectionGuards({ type, xField, yField, rows: filteredRows });
  const msg = card.querySelector(".chart-error") || (() => {
    const m = document.createElement("div");
    m.className = "chart-error text-danger mt-2";
    m.style.display = "none";
    card.querySelector(".card-body").appendChild(m);
    return m;
  })();
  if (!guard.ok){
    msg.textContent = guard.reason;
    msg.style.display = "block";
    if (canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }
    return;
  }
  msg.style.display = "none";

  let grouped = groupBy(filteredRows, xField);
  grouped = applyMetricFilters(grouped, card); // metric filters use current Y only

  const labels = Object.keys(grouped);
  const values = computeSeries(grouped, yField);

  const ctx = canvas.getContext("2d");
  if (canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }

  const yLabelText = metricLabelFromKey(yField);

  canvas._chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label: `${yLabelText} by ${(FIELD_RULES_BY_KEY[xField]?.label || xField)}`,
        data: values,
        backgroundColor: "rgba(98,144,195,0.25)",
        borderColor: "rgba(98,144,195,1)",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      animation: { duration: 250 },
      layout: { padding: { top: 16, left: 4, right: 8, bottom: 0 } },
      plugins: {
        tooltip: {
          backgroundColor: 'rgba(15,23,42,.95)',
          borderColor: 'rgba(255,255,255,.08)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const val = (typeof ctx.parsed.y === "number") ? ctx.parsed.y : ctx.parsed;
              return `${ctx.dataset.label}: ${Math.round((+val) * 100)/100}`;
            }
          }
        }
      },
      scales: (type !== "pie" && type !== "doughnut")
        ? { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
        : {}
    },
    plugins: [{
      id: "value-labels",
      afterDatasetsDraw: (chart) => drawValueLabels(chart, type)
    }]
  });

  // STORY under the chart (HTML is already in the card)
  const storyBody = card.querySelector(".chart-story .ga-body") || ensureStoryBox(card).querySelector(".ga-body");
  storyBody.textContent = buildStory({ type, xField, yField }, grouped, labels, values);
}

/* -------------------- Card UI -------------------- */
function createSelectSimple(options, className){
  const sel = document.createElement("select");
  sel.className = `form-select ${className}`;
  options.forEach(v => {
    const o = document.createElement("option");
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
  return sel;
}

function addChartCard(){
  const container = document.getElementById("charts");
  const card = document.createElement("div");
  card.className = "card mb-3 chart-card";

  // Card HTML includes Graph Analysis section
  card.innerHTML = `
    <div class="card-body">
      <div class="row g-2">
        <div class="col">
          <label>Chart type</label>
          <select class="form-select chart-type">
            <option>bar</option>
            <option>line</option>
            <option>pie</option>
            <option>doughnut</option>
          </select>
        </div>
        <div class="col">
          <label>X-axis (group by)</label>
          <select class="form-select x-field"></select>
        </div>
        <div class="col">
          <label>Y-axis (metric)</label>
          <select class="form-select y-field"></select>
        </div>
      </div>

      <div class="filters mt-2"></div>
      <div class="metric-filters mt-2"></div>

      <button type="button" class="btn btn-secondary btn-sm mt-2" id="btn-add-filter">Add Filter</button>
      <button type="button" class="btn btn-outline-secondary btn-sm mt-2 ms-2" id="btn-add-metric-filter">Add Metric Filter</button>
      <button type="button" class="btn btn-success btn-sm mt-2 ms-2" id="btn-generate">Generate chart</button>
      <button type="button" class="btn btn-outline-primary btn-sm mt-2 ms-2" id="btn-download" disabled>Download</button>
      <button type="button" class="btn btn-outline-danger btn-sm mt-2 ms-2" id="btn-remove">Delete chart</button>

      <canvas class="mt-3 chart"></canvas>

      <!-- Fixed story section in HTML -->
      <div class="chart-story mt-3 p-2 border rounded bg-light">
        <h6 class="mb-2 fw-bold">Graph Analysis</h6>
        <div class="ga-body" style="white-space: pre-wrap;"></div>
      </div>
    </div>
  `;

  container.appendChild(card);

  // Wire up elements
  const body = card.querySelector(".card-body");
  const xSelect = body.querySelector(".x-field");
  const ySelect = body.querySelector(".y-field");
  const filtersDiv = body.querySelector(".filters");
  const metricFiltersDiv = body.querySelector(".metric-filters");
  const canvas = body.querySelector("canvas");

  const addFilterBtn = body.querySelector("#btn-add-filter");
  const addMetricFilterBtn = body.querySelector("#btn-add-metric-filter");
  const genBtn = body.querySelector("#btn-generate");
  const dlBtn = body.querySelector("#btn-download");
  const rmBtn = body.querySelector("#btn-remove");

  populateX(xSelect);
  populateY(ySelect, xSelect.value);

  addFilterBtn.addEventListener("click", () => addFilterRow(filtersDiv));
  addMetricFilterBtn.addEventListener("click", () =>
    addMetricFilterRow(metricFiltersDiv, () => ySelect.value)
  );
  xSelect.addEventListener("change", () => {
    populateY(ySelect, xSelect.value);
    metricFiltersDiv.querySelectorAll(".metric-filter-row")
      .forEach(r => r._refreshMetricOption && r._refreshMetricOption());
  });
  ySelect.addEventListener("change", () => {
    metricFiltersDiv.querySelectorAll(".metric-filter-row")
      .forEach(r => r._refreshMetricOption && r._refreshMetricOption());
  });

  genBtn.addEventListener("click", () => {
    buildChart(card, canvas);
    // Enable/disable download button based on chart existence
    dlBtn.disabled = !canvas._chart;
  });

  dlBtn.addEventListener("click", () => {
    if (!canvas._chart) return; // guard: no chart, no download

    const xField = card.querySelector(".x-field").value;
    const yField = card.querySelector(".y-field").value;
    const xLabel = FIELD_RULES_BY_KEY[xField]?.label || xField;
    const yLabel = metricLabelFromKey(yField);

    // Safe filename: "Y-by-X.png"
    const safeName = `${yLabel} by ${xLabel}`
      .replace(/\s+/g, "_")
      .replace(/[^\w_-]+/g, "");

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${safeName}.png`;
    a.click();
  });

  rmBtn.addEventListener("click", () => {
    // Ensure any chart instances are cleaned up
    if (canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }
    card.remove();
  });
}

/* -------------------- Init -------------------- */
async function init(){
  try{
    const res = await fetch("/api/data");
    const raw = await res.json();

    ORIGINAL_LABELS = {};
    if (Array.isArray(raw) && raw.length){
      const firstRawRow = raw[0];
      for (const k of Object.keys(firstRawRow)){
        const mapped = HEADER_MAP[k] || snake(k);
        if (!SKIP_FIELDS.has(mapped)) ORIGINAL_LABELS[mapped] = k;
      }
    }

    dataset = raw.map(normalizeRow).map(deriveDomainFields);
    bootstrapRules(dataset, ORIGINAL_LABELS);
    inferCodeNamePairs();

    document.getElementById("addChart").addEventListener("click", addChartCard);
    document.getElementById("resetDashboard").addEventListener("click", () => (document.getElementById("charts").innerHTML = ""));
    document.getElementById("saveDashboard").addEventListener("click", () => {
      const cfg = Array.from(document.querySelectorAll(".chart-card")).map(card => ({
        type:    card.querySelector(".chart-type").value,
        xField:  card.querySelector(".x-field").value,
        yField:  card.querySelector(".y-field").value,
        filters: Array.from(card.querySelectorAll(".filter-row")).map(r => ({
          field: r.querySelector(".filter-field").value,
          value: r.querySelector(".filter-value").value
        })),
        metricFilters: Array.from(card.querySelectorAll(".metric-filter-row")).map(r => ({
          metric: r.querySelector(".metric-key")?.value,
          op:     r.querySelector(".metric-op")?.value,
          value:  r.querySelector(".metric-threshold")?.value
        }))
      }));
      console.log("Dashboard configuration", cfg);
      alert("Dashboard configuration saved to console.");
    });

    addChartCard(); // first card
  } catch (e){
    console.error("Failed to load data", e);
  }
}

document.addEventListener("DOMContentLoaded", init);
