// static/js/report.js
document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.reportConfig || {};
  const chartEl = document.getElementById("mainChart");
  const tableEl = document.getElementById("dataTable");
  const tableWrap = tableEl ? tableEl.parentElement : null;
  const tableBody = tableEl ? tableEl.querySelector("tbody") : null;
  if (!chartEl || !tableWrap || !tableBody) return;

  let chart;

  fetchData(cfg)
    .then(raw => {
      const rows = cleanRows(raw, cfg);
      if (!rows.length) return showEmpty();

      renderChart(rows, getDefaultType(cfg));
      renderTable(rows, cfg);

      document.querySelectorAll(".chart-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".chart-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          const t = btn.dataset.type;
          if (t === "table") {
            chartEl.style.display = "none";
            tableWrap.style.display = "block";
          } else {
            tableWrap.style.display = "none";
            chartEl.style.display = "block";
            renderChart(rows, t);
          }
        });
      });
    })
    .catch(err => showEmpty(`Error: ${err.message}`));

  // ---------------- helpers ----------------

  async function fetchData(cfg) {
    const list = Array.isArray(cfg.endpoints) ? cfg.endpoints : [cfg.endpoint].filter(Boolean);
    let lastErr;
    for (const url of list) {
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("No endpoint configured");
  }

  function showEmpty(msg) {
    if (chart) chart.destroy();
    chartEl.style.display = "none";
    tableWrap.style.display = "block";
    tableBody.innerHTML = `<tr><td colspan="${(cfg.columns||[]).length || 1}" class="text-center text-muted">${msg || "No data to display"}</td></tr>`;
  }

  function getDefaultType(cfg) {
    if (cfg.special === 'deferred') return "bar";
    if ((cfg.endpoint||"").includes("offer-expiry-surge")) return "line";
    return "bar";
  }

  function renderChart(rows, type) {
    const { labels, datasets, options } = buildChartData(rows, type, cfg);
    if (chart) chart.destroy();
    chart = new Chart(chartEl, { type, data: { labels, datasets }, options });
  }

  function renderTable(rows, cfg) {
    tableBody.innerHTML = "";
    rows.forEach(r => {
      const tr = document.createElement("tr");
      (cfg.columns || []).forEach(c => {
        const td = document.createElement("td");
        td.textContent = r[c.key] ?? "";
        tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });
  }

  function cleanRows(data, cfg) {
    if (!Array.isArray(data)) return [];

    // Special handling: Deferred (accept aggregated or raw)
    if (cfg.special === 'deferred') {
      // aggregated already?
      const looksAgg = data.length && (
        ("term" in data[0] || "Term" in data[0]) &&
        (("deferred" in data[0]) || ("deferred_count" in data[0]) || ("Deferred Count" in data[0]) || ("Deferred_Count" in data[0])) &&
        (("total" in data[0]) || ("total_offers" in data[0]) || ("Total Offers" in data[0]) || ("Total_Offers" in data[0]))
      );
      if (looksAgg) {
        const out = data.map(r => ({
          term: String(r.term ?? r.Term ?? "").trim(),
          deferred: toNum(r.deferred ?? r.deferred_count ?? r["Deferred Count"] ?? r["Deferred_Count"] ?? 0),
          total:    toNum(r.total ?? r.total_offers ?? r["Total Offers"] ?? r["Total_Offers"] ?? 0)
        })).filter(x => x.term && !/^unknown$/i.test(x.term));
        return sortTerms(out);
      }

      // raw -> aggregate with your Excel columns
      const getTerm = r => {
        const intake = r["Previous Offer Intake"] ?? r.previous_offer_intake ?? r["Offer Intake"] ?? r.offer_intake ?? r.Intake;
        const year   = r["Previous Offer Year"]   ?? r.previous_offer_year   ?? r["Offer Year"]   ?? r.offer_year   ?? r.Year;
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
      byTerm.forEach((v,k) => { if (!/^unknown$/i.test(k)) out.push({ term: k, deferred: v.deferred, total: v.total }); });
      return sortTerms(out);
    }

    // Generic cleaner
    const g = cfg.groupField;
    const keys = (cfg.columns || []).map(c => c.key);
    const out = [];
    for (const row of data) {
      let label = row[g];
      if (label == null) {
        label =
          row.term ?? row.offer_status ?? row.visa_type ?? row.visa_status ??
          row["Visa Type"] ?? row["Visa Status"] ?? "";
      }
      if (typeof label === "string") label = label.trim();

      const isUnknown = !label || /^unknown$/i.test(label);
      if (isUnknown && !cfg.allowUnknown) continue;
      if (isUnknown && cfg.allowUnknown) label = "Unknown";

      const cleaned = { [g]: label };
      for (const k of keys) {
        if (k === g) continue;
        const alt1 = k.replace(/_(.)/g, (_, c) => c.toUpperCase());
        const alt2 = alt1.charAt(0).toUpperCase() + alt1.slice(1);
        const alt3 = k.replace(/_/g, " ");
        const v = row[k] ?? row[alt1] ?? row[alt2] ?? row[alt3] ?? 0;
        cleaned[k] = toNum(v);
      }
      out.push(cleaned);
    }
    return out;
  }

  function sortTerms(rows) {
    const order = { t1: 1, t2: 2, t3: 3, s1: 1, s2: 2, s3: 3, trimester1:1, trimester2:2, trimester3:3 };
    const parseKey = t => {
      const s = String(t);
      const m = s.match(/(t|s)\s*([123])\s*(\d{4})/i) || s.match(/trimester\s*([123])\s*(\d{4})/i);
      if (m && m.length >= 3) {
        let y, k;
        if (/^(t|s)$/i.test(m[1])) { k = (m[1] + m[2]).toLowerCase(); y = Number(m[3]); }
        else { k = "trimester" + m[1]; y = Number(m[2]); }
        return { y, ord: order[k] || 99 };
      }
      const m2 = s.match(/(\d{4})/);
      return { y: m2 ? Number(m2[1]) : 0, ord: 99 };
    };
    return rows.sort((a,b) => {
      const A = parseKey(a.term), B = parseKey(b.term);
      return A.y !== B.y ? A.y - B.y : A.ord - B.ord || a.term.localeCompare(b.term);
    });
  }

  function buildChartData(rows, type, cfg) {
    // deferred stacked bar
    if (cfg.special === 'deferred') {
      const labels = rows.map(r => r.term);
      const deferred = rows.map(r => toNum(r.deferred));
      const other = rows.map(r => Math.max(toNum(r.total) - toNum(r.deferred), 0));
      return {
        labels,
        datasets: [
          { label: "Deferred",     data: deferred, backgroundColor: "#FF6384", stack: "stack1" },
          { label: "Other Offers", data: other,    backgroundColor: "#36A2EB", stack: "stack1" }
        ],
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom" } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      };
    }

    // default bar/pie/doughnut/line
    const g = cfg.groupField;
    const labels = rows.map(r => r[g]);
    const metricCols = (cfg.columns || []).filter(c => c.key !== g);
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

    return {
      labels,
      datasets,
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    };
  }

  // visa colors (kept for your donut consistency)
  const VISA_COLOR_MAP = {
    "Student Visa":       "#36A2EB",
    "Temporary Visa":     "#FF6384",
    "Permanent Resident": "#FF9F40",
    "Bridging Visa":      "#FFCD56",
    "PR":                 "#4BC0C0",
    "Tourist Visa":       "#9966FF"
  };
  const FALLBACK_COLORS = ["#36A2EB","#FF6384","#FF9F40","#FFCD56","#4BC0C0","#9966FF"];
  function colorsForLabels(labels) {
    return labels.map((lbl, i) => VISA_COLOR_MAP[lbl] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
  }

  function toNum(v) {
    const n = typeof v === "string" ? v.replace(/,/g, "") : v;
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }
});
