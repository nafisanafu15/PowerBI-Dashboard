import { renderChart } from "../chartLoader.js";
import { $, $$ } from "../dataApi.js";

// Display visa breakdown chart with sorting options
let baseRows=[], currentRows=[];
const ctx=document.getElementById("chart");

function mapRows(rows){
  // Convert API rows to chart.js dataset structure
  return {
    labels: rows.map(r=>r.visa_type),
    datasets: [{ data: rows.map(r=>r.total) }]
  };
}
async function boot(){
  // Fetch data and initialise chart
  const res=await renderChart({ endpoint:"/api/visa-breakdown", canvas:ctx, type:"doughnut", map:mapRows });
  if(!res) return; baseRows=res.rows.slice(); currentRows=res.rows.slice(); wireButtons();
}
function rerender(){
  // Update chart with current row order
  const {labels,datasets}=mapRows(currentRows); ctx.__chart.data.labels=labels; ctx.__chart.data.datasets=datasets; ctx.__chart.update();
}
function wireButtons(){
  // Hook sorting and reset buttons
  $("#btn-asc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(a.total??0)-(b.total??0)); rerender();});
  $("#btn-desc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(b.total??0)-(a.total??0)); rerender();});
  $("#btn-clear-filters")?.addEventListener("click", ()=>{ currentRows=baseRows.slice(); rerender();});
}
document.addEventListener("DOMContentLoaded", boot);

