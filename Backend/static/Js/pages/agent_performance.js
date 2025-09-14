import { renderChart } from "../chartLoader.js";
import { $, $$ } from "../dataApi.js";

let baseRows=[], currentRows=[];
const ctx=document.getElementById("chart");

function mapRows(rows){
  return {
    labels: rows.map(r=>r.agent),
    datasets: [
      { label:"Applications", data: rows.map(r=>r.applications) },
      { label:"Offers",       data: rows.map(r=>r.offers) },
      { label:"Enrolled",     data: rows.map(r=>r.enrolled) }
    ]
  };
}

async function boot(){
  const res=await renderChart({ endpoint:"/api/agent-performance", canvas:ctx, type:"bar", map:mapRows,
    options:{ plugins:{ legend:{ position:"top" } } }});
  if(!res) return;
  baseRows=res.rows.slice(); currentRows=res.rows.slice(); wireButtons();
}

function rerender(){ const {labels,datasets}=mapRows(currentRows); ctx.__chart.data.labels=labels; ctx.__chart.data.datasets=datasets; ctx.__chart.update(); }

function wireButtons(){
  $("#btn-asc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(a.enrolled??0)-(b.enrolled??0)); rerender();});
  $("#btn-desc")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(b.enrolled??0)-(a.enrolled??0)); rerender();});
  $("#btn-offer-id")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(b.offers??0)-(a.offers??0)); rerender();});
  $("#btn-offer-status")?.addEventListener("click", ()=>{ currentRows.sort((a,b)=>(b.applications??0)-(a.applications??0)); rerender();});
  $("#btn-clear-filters")?.addEventListener("click", ()=>{ currentRows=baseRows.slice(); rerender();});
}

document.addEventListener("DOMContentLoaded", boot);

