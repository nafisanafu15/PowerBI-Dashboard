
// Start minimal; chartLoader will add rules for every dataset column at runtime.
export const FIELD_RULES_BY_KEY = {
  // Virtual measures (always safe)
  __count__:           { type:"numeric", roles:["measure"],  virtual:true, label:"count_of_records" },
  __pct_of_total__:    { type:"numeric", roles:["measure"],  virtual:true, label:"percent_of_total" },

  // Example derived (only used if you later add 'age' during bootstrap)
  __avg_age__:         { type:"numeric", roles:["measure"],  virtual:true, label:"avg_age", derivesFrom:"age", agg:"avg" },
};

// =============== Global guards & caps ===============
export const GLOBAL_GUARDS = {
  minSampleSize: 5,
  maxAxisCategories: 50,   // allow many categories since user asked "all fields"
};

// =============== Normalization / validation ===============
export function normalizeValue(fieldKey, value) {
  const rule = FIELD_RULES_BY_KEY[fieldKey];
  if (!rule || value == null) return value;

  if (rule.type==="boolean" && typeof value==="string") {
    const v = value.trim().toLowerCase();
    if (["yes","y","true","1"].includes(v)) return "Yes";
    if (["no","n","false","0"].includes(v)) return "No";
  }
  return value;
}

export function validateRow(row) {
  const toDate = (d) => {
    if (!d) return null;
    if (typeof d === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
      const [dd,mm,yyyy] = d.split("/");
      return new Date(+yyyy, +mm-1, +dd);
    }
    const dt = new Date(d);
    return Number.isNaN(+dt) ? null : dt;
  };
  const s = toDate(row.startdate);
  const f = toDate(row.finishdate);
  if (s && f && f < s) return { ok:false, reason:"finishdate before startdate" };
  return { ok:true };
}

// =============== Public API ===============
/**
 * Allowed Y for any X:
 * - __count__, __pct_of_total__
 * - every numeric field present in FIELD_RULES_BY_KEY (chartLoader adds these)
 * - (optionally) __avg_age__ if 'age' exists
 */
export function allowedYForX(_xKey){
  const basics = ["__count__", "__pct_of_total__"];
  const numericMeasures = Object.entries(FIELD_RULES_BY_KEY)
    .filter(([,r]) => r.roles?.includes("measure") && r.type==="numeric")
    .map(([k]) => k);

  // Deduplicate while preserving order (basics first)
  const seen = new Set();
  const out = [];
  for (const k of [...basics, ...numericMeasures]) {
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

function rate(numer, denom){ return (denom||0)===0 ? 0 : (numer/denom)*100; }

/**
 * Compute series values by grouped rows for a given yKey.
 * - __count__: count records
 * - __pct_of_total__: % share of group counts
 * - __avg_age__: average of numeric 'age' if present
 * - numeric columns: sum by default
 */
export function computeSeriesFromGroups(groupedRows, yKey){
  const labels = Object.keys(groupedRows);
  const rule = FIELD_RULES_BY_KEY[yKey];

  if (yKey==="__count__") return labels.map(l=>groupedRows[l].length);

  if (yKey==="__pct_of_total__"){
    const counts = labels.map(l=>groupedRows[l].length);
    const total = counts.reduce((a,b)=>a+b,0)||1;
    return counts.map(c=>rate(c, total)); // percentage
  }

  if (yKey==="__avg_age__"){
    // Use only if age exists; otherwise returns zeros
    return labels.map(l=>{
      const nums = groupedRows[l].map(r=>Number(r.age)).filter(n=>!Number.isNaN(n));
      const sum  = nums.reduce((a,b)=>a+b,0);
      return nums.length ? sum/nums.length : 0;
    });
  }

  // Any declared numeric measure → sum by default
  if (rule && rule.type==="numeric"){
    return labels.map(l => groupedRows[l].reduce((s,r)=>s+(Number(r[yKey])||0),0));
  }

  // Fallback to counts
  return labels.map(l=>groupedRows[l].length);
}

/**
 * Basic selection guardrails.
 * - X must exist
 * - Y must be in allowed list
 * - sample size & category caps
 */
export function enforceSelectionGuards({ type, xField, yField, rows }){
  if (!xField || !yField) return { ok:false, reason:"Please select both X and Y fields." };
  const xRule = FIELD_RULES_BY_KEY[xField], yRule = FIELD_RULES_BY_KEY[yField];
  if (!xRule || !yRule)   return { ok:false, reason:"Invalid field selected." };

  // Ensure Y is allowed for this X
  const allowedY = allowedYForX(xField);
  if (!allowedY.includes(yField)) return { ok:false, reason:`Y "${yField}" is not allowed for X "${xField}".` };

  // sample size
  if ((rows?.length||0) < GLOBAL_GUARDS.minSampleSize)
    return { ok:false, reason:`Not enough rows after filters (min ${GLOBAL_GUARDS.minSampleSize}).` };

  // category cap (non-line)
  if (type!=="line"){
    const categories = new Set((rows||[]).map(r => r[xField] ?? "Unknown"));
    const cap = FIELD_RULES_BY_KEY[xField]?.maxAxisCardinality ?? GLOBAL_GUARDS.maxAxisCategories;
    if (categories.size > cap) return { ok:false, reason:`Too many categories on X (${categories.size}). Add a filter or switch chart.` };
  }
  return { ok:true };
}
