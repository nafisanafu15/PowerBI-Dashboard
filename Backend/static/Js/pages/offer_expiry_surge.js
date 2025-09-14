import { renderChart } from "../chartLoader.js";
import { $, $$ } from "../dataApi.js";

let baseRows=[], currentRows=[];
const ctx=document.getElementById("chart");

function mapRows(rows){
  return {
    labels: rows.map(r=>r.expiry_day),
    datasets: [{ label:"Expiring Offers", data: rows.map(r=>r.expiring_offers) }]
  };
}
async function boot(){
  const res=await renderChart({ endpoint:"/api/offer-expiry-surge", canvas:ctx, type:"line", map:mapRows });
  if(!res) return; baseRows=res.rows.slice(); currentRows=res.rows.slice(); wireButtons();
}
function rerender(){ const {labels,datasets}=mapRows(currentRows); ctx.__chart.data.labels=labels; ctx.__chart.data.datasets=datasets; ctx.__chart.update(); }
function wireButtons(){
  $("#btn-asc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=> (a.expiring_offers??0)-(b.expiring_offers??0)); rerender();});
  $("#btn-desc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=> (b.expiring_offers??0)-(a.expiring_offers??0)); rerender();});
  $("#btn-clear-filters")?.addEventListener("click", ()=>{ currentRows=baseRows.slice(); rerender();});
}
document.addEventListener("DOMContentLoaded", boot);

