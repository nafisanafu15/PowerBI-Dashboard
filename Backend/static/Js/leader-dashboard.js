// static/js/leader-dashboard.js
async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("HTTP " + res.status + " @ " + url);
  return res.json();
}

function pick(o, ...names) {
  for (const n of names) if (o && o[n] != null) return o[n];
  return null;
}

const palette = ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"];

document.addEventListener("DOMContentLoaded", () => {
  loadApplicationStatus();
  loadDeferredOffers();     // fixed here
  loadAgentPerformance();
  loadStudentClassification();
});

/* ------------------------------ Application Status ------------------------------ */
async function loadApplicationStatus() {
  try {
    const rows = await fetchJSON("/api/application-status");
    const labels = rows.map(r => pick(r, "status", "Status"));
    const data   = rows.map(r => Number(pick(r, "total", "Total")) || 0);
    new Chart(document.getElementById("applicationStatusChart"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Applications", backgroundColor: palette.slice(0, labels.length), data }] },
      options: { responsive: true }
    });
  } catch (e) { console.error("application status", e); }
}

/* ------------------------------ Deferred Offers (frontend-only) ------------------------------ */
async function loadDeferredOffers() {
  const el = document.getElementById("deferredOffersChart");
  if (!el) return;

  // Try these endpoints in order (no app.py edits needed)
  const endpoints = [
    "/api/deferred-offers",            // most likely to exist
    "/api/deferred-offers-overview",
    // optional raw rows endpoints if you have any:
    "/api/reportdata",
    "/api/applications",
    "/api/all"
  ];

  // first endpoint that returns JSON without throwing
  let rows = null;
  for (const url of endpoints) {
    try { rows = await fetchJSON(url); break; } catch { /* keep trying */ }
  }

  const normalized = normalizeDeferred(rows || []);
  renderDeferred(el, normalized);
}

/** Accepts aggregated or raw rows and outputs:
 *   [{ term: "T1 2025", deferred: n, total: m }, ...]
 */
function normalizeDeferred(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // aggregated?
  const agg = r =>
    ("term" in r || "Term" in r) &&
    (("deferred" in r) || ("deferred_count" in r) || ("Deferred Count" in r) || ("Deferred_Count" in r)) &&
    (("total" in r) || ("total_offers" in r) || ("Total Offers" in r) || ("Total_Offers" in r));

  if (agg(rows[0])) {
    return rows.map(r => ({
      term: String(pick(r, "term", "Term")),
      deferred: Number(pick(r, "deferred", "deferred_count", "Deferred Count", "Deferred_Count")) || 0,
      total:    Number(pick(r, "total", "total_offers", "Total Offers", "Total_Offers")) || 0
    })).filter(x => x.term && !/^unknown$/i.test(x.term));
  }

  // raw -> aggregate on the client. Works with your Excel columns.
  const getTerm = r => {
    const intake = pick(r, "Previous Offer Intake", "previous_offer_intake", "Offer Intake", "offer_intake", "Intake");
    const year   = pick(r, "Previous Offer Year", "previous_offer_year", "Offer Year", "offer_year", "Year");
    if (intake && year != null) return `${intake} ${year}`;
    if (intake) return String(intake);
    if (year != null) return String(year);
    return "Unknown";
  };

  const byTerm = new Map();
  for (const r of rows) {
    const term = getTerm(r);
    const status = String(pick(r, "Status", "status", "Offer Status", "offer_status") || "").toLowerCase();
    const rec = byTerm.get(term) || { deferred: 0, total: 0 };
    rec.total += 1;
    if (status.startsWith("deferred")) rec.deferred += 1;
    byTerm.set(term, rec);
  }

  const out = [];
  byTerm.forEach((v, k) => { if (!/^unknown$/i.test(k)) out.push({ term: k, deferred: v.deferred, total: v.total }); });
  return out;
}

function renderDeferred(el, data) {
  // Sort terms like T1/T2/T3 by year if present
  const order = { t1: 1, t2: 2, t3: 3, s1: 1, s2: 2, s3: 3, trimester1:1, trimester2:2, trimester3:3 };
  const parseKey = s => {
    const t = String(s);
    const m = t.match(/(t|s)\s*([123])\s*(\d{4})/i) || t.match(/trimester\s*([123])\s*(\d{4})/i);
    if (m && m.length >= 3) {
      let y, k;
      if (/^(t|s)$/i.test(m[1])) { k = (m[1] + m[2]).toLowerCase(); y = Number(m[3]); }
      else { k = "trimester" + m[1]; y = Number(m[2]); }
      return { y, ord: order[k] || 99 };
    }
    const m2 = t.match(/(\d{4})/);
    return { y: m2 ? Number(m2[1]) : 0, ord: 99 };
  };

  // Merge duplicate terms, compute nonDeferred
  const byTerm = new Map();
  for (const r of data) {
    const term = String(r.term);
    const cur = byTerm.get(term) || { deferred: 0, total: 0 };
    cur.deferred += Number(r.deferred ?? 0);
    cur.total    += Number(r.total ?? 0);
    byTerm.set(term, cur);
  }

  const labels = [...byTerm.keys()].sort((a,b) => {
    const A = parseKey(a), B = parseKey(b);
    return A.y !== B.y ? A.y - B.y : A.ord - B.ord || a.localeCompare(b);
  });

  const deferred = labels.map(l => byTerm.get(l).deferred);
  const nonDeferred = labels.map(l => Math.max(byTerm.get(l).total - byTerm.get(l).deferred, 0));

  if (el._chart) el._chart.destroy();
  el._chart = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Deferred",     backgroundColor: palette[0], data: deferred,    stack: "stack1" },
        { label: "Other Offers", backgroundColor: palette[1], data: nonDeferred, stack: "stack1" }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
    }
  });
}

/* ------------------------------ Agent Performance ------------------------------ */
async function loadAgentPerformance() {
  try {
    const rows = await fetchJSON("/api/agent-performance");
    const labels = rows.map(r => pick(r, "agent", "Agent"));
    const apps   = rows.map(r => Number(pick(r, "applications", "Applications")) || 0);
    const offers = rows.map(r => Number(pick(r, "offers", "Offers")) || 0);
    const enrolled = rows.map(r => Number(pick(r, "enrolled", "Enrolled")) || 0);
    new Chart(document.getElementById("agentPerformanceChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Applications", backgroundColor: palette[0], data: apps },
          { label: "Offers",       backgroundColor: palette[1], data: offers },
          { label: "Enrolled",     backgroundColor: palette[2], data: enrolled }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: "top" } } }
    });
  } catch (e) { console.error("agent performance", e); }
}

/* ------------------------------ Student Classification ------------------------------ */
async function loadStudentClassification() {
  try {
    const rows = await fetchJSON("/api/student-classification");
    const labels = rows.map(r => pick(r, "classification", "Classification"));
    const data   = rows.map(r => Number(pick(r, "total", "Total")) || 0);
    new Chart(document.getElementById("studentClassificationChart"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          backgroundColor: palette.slice(0, labels.length),
          borderColor: "#F4F1DE",
          borderWidth: 2,
          hoverOffset: 8,
          data
        }]
      },
      options: { responsive: true }
    });
  } catch (e) { console.error("student classification", e); }
}
