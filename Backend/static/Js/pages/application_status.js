import { renderChart } from "../chartLoader.js";
import { $, $$ } from "../dataApi.js";

let baseRows = [];
let currentRows = [];
let chartCtx = document.getElementById("chart");

function mapRows(rows){
  return {
    labels: rows.map(r => r.status),
    datasets: [{ label: "Applications", data: rows.map(r => r.total) }]
  };
}

async function boot(){
  const result = await renderChart({
    endpoint: "/api/application-status",
    canvas: chartCtx,
    type: "bar",
    map: mapRows
  });
  if (!result) return;
  baseRows = result.rows.slice();
  currentRows = result.rows.slice();
  wireButtons();
}

function rerender(){
  const { labels, datasets } = mapRows(currentRows);
  chartCtx.__chart.data.labels = labels;
  chartCtx.__chart.data.datasets = datasets;
  chartCtx.__chart.update();
}

function wireButtons(){
  $("#btn-asc")?.addEventListener("click", () => {
    currentRows.sort((a,b)=> (a.total??0) - (b.total??0));
    rerender();
  });
  $("#btn-desc")?.addEventListener("click", () => {
    currentRows.sort((a,b)=> (b.total??0) - (a.total??0));
    rerender();
  });

  $$(".btn-tri").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tri = btn.dataset.tri;
      currentRows = baseRows.filter(r => (r.term||"").toLowerCase() === tri.toLowerCase());
      if (currentRows.length===0) currentRows = baseRows.slice();
      rerender();
    });
  });

  $("#btn-clear-filters")?.addEventListener("click", ()=>{
    currentRows = baseRows.slice();
    rerender();
  });
}

document.addEventListener("DOMContentLoaded", boot);

