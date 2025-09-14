import { renderChart } from "../chartLoader.js";
import { $, $$ } from "../dataApi.js";

let baseRows=[], currentRows=[];
const ctx = document.getElementById("chart");

function mapRows(rows){
  return {
    labels: rows.map(r=>r.term),
    datasets: [
      { label:"Deferred", data: rows.map(r=>r.deferred_count) },
      { label:"Total Offers", data: rows.map(r=>r.total_offers) }
    ]
  };
}

async function boot(){
  const res = await renderChart({ endpoint:"/api/deferred-offers", canvas:ctx, type:"bar", map:mapRows });
  if (!res) return;
  baseRows = res.rows.slice();
  currentRows = res.rows.slice();
  wireButtons();
}

function rerender(){
  const {labels,datasets}=mapRows(currentRows);
  ctx.__chart.data.labels=labels;
  ctx.__chart.data.datasets=datasets;
  ctx.__chart.update();
}

function wireButtons(){
  $("#btn-asc")?.addEventListener("click", ()=> { currentRows.sort((a,b)=>(a.deferred_count??0)-(b.deferred_count??0)); rerender();});
  $("#btn-desc")?.addEventListener("click", ()=> { currentRows.sort((a,b)=>(b.deferred_count??0)-(a.deferred_count??0)); rerender();});
  $$(".btn-tri").forEach(b=>b.addEventListener("click", ()=>{ const t=b.dataset.tri; currentRows=baseRows.filter(r=>(r.term||"").toLowerCase()===t.toLowerCase()); if(!currentRows.length) currentRows=baseRows.slice(); rerender();}));
  $("#btn-clear-filters")?.addEventListener("click", ()=>{ currentRows=baseRows.slice(); rerender();});
}

document.addEventListener("DOMContentLoaded", boot);

