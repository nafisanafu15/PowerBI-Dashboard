import { renderChart } from "../chartLoader.js";
import { $, $$ } from "../dataApi.js";

let baseRows=[], currentRows=[];
const ctx=document.getElementById("chart");

function mapRows(rows){
  return {
    labels: rows.map(r=>r.term),
    datasets: [
      { label:"Current Students", data: rows.map(r=>r.current_students) },
      { label:"Enrolled",         data: rows.map(r=>r.enrolled) }
    ]
  };
}
async function boot(){
  const res=await renderChart({ endpoint:"/api/current-vs-enrolled", canvas:ctx, type:"bar", map:mapRows });
  if(!res) return; baseRows=res.rows.slice(); currentRows=res.rows.slice(); wireButtons();
}
function rerender(){ const {labels,datasets}=mapRows(currentRows); ctx.__chart.data.labels=labels; ctx.__chart.data.datasets=datasets; ctx.__chart.update(); }
function wireButtons(){
  $("#btn-asc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(a.enrolled??0)-(b.enrolled??0)); rerender();});
  $("#btn-desc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(b.enrolled??0)-(a.enrolled??0)); rerender();});
  $$(".btn-tri").forEach(b=>b.addEventListener("click", ()=>{ const t=b.dataset.tri; currentRows=baseRows.filter(r=>(r.term||"").toLowerCase()===t.toLowerCase()); if(!currentRows.length) currentRows=baseRows.slice(); rerender();}));
  $("#btn-clear-filters")?.addEventListener("click", ()=>{ currentRows=baseRows.slice(); rerender();});
}
document.addEventListener("DOMContentLoaded", boot);

