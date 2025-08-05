let rawData=[];
let currentSort='';
let chart;
let chartType='bar';
let rangeFrom=null;
let rangeTo=null;

function parseDate(d){
  if(!d) return null;
  const p=d.split('/');
  if(p.length!==3) return null;
  return new Date(p[2],p[1]-1,p[0]);
}

document.addEventListener('DOMContentLoaded',()=>{
  fetch('/api/data').then(r=>r.json()).then(data=>{
    rawData=data.map(r=>({...r,_start:parseDate(r.StartDate)}));
    applyFilters();
    hideTable();
  });

  initTimePeriodFilter('.time-filter', (from,to)=>{ rangeFrom=from; rangeTo=to; applyFilters(); });

  document.querySelectorAll('.sort-buttons button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.sort-buttons button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentSort=btn.dataset.sort;
      applyFilters();
    });
  });

  document.querySelectorAll('.intake-buttons button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      btn.classList.toggle('active');
      applyFilters();
    });
  });

  document.getElementById('barChartBtn').addEventListener('click',()=>{
    setChartType('bar');
  });
  document.getElementById('donutChartBtn').addEventListener('click',()=>{
    setChartType('doughnut');
  });
  document.getElementById('pieChartBtn').addEventListener('click',()=>{
    setChartType('pie');
  });
  document.getElementById('tableChartBtn').addEventListener('click',()=>{
    showTable();
    document.querySelectorAll('.widget-list button').forEach(b=>b.classList.remove('active'));
    document.getElementById('tableChartBtn').classList.add('active');
    applyFilters();
  });
});

function applyFilters(){
  let data=rawData.slice();
  if(rangeFrom){
    data=data.filter(r=>r._start && r._start>=rangeFrom);
  }
  if(rangeTo){
    data=data.filter(r=>r._start && r._start<=rangeTo);
  }
  const intakes=Array.from(document.querySelectorAll('.intake-buttons button.active')).map(b=>b.dataset.sem);
  if(intakes.length) data=data.filter(r=>intakes.includes(r['Previous Offer Intake']));

  updateChart(data);
  updateTable(data);
}

function updateChart(data){
  const counts={};
  data.forEach(r=>{
    const v=r['Visa Status']||'Unknown';
    counts[v]=(counts[v]||0)+1;
  });
  let labels=Object.keys(counts);
  let values=Object.values(counts);

  if(chart) chart.destroy();
  const ctx=document.getElementById('visaChart').getContext('2d');
  let config={
    type:chartType,
    data:{
      labels:labels,
      datasets:[{label:'Applications',data:values,backgroundColor:'#7D60A7'}]
    },
    options:{responsive:true}
  };
  if(chartType==='bar') config.options.indexAxis='y';
  chart=new Chart(ctx,config);
}

function updateTable(data){
  let rows=data.map(r=>({
    nat:r.Nationality||'Unknown',
    periods:Number(r['Number of Study Periods'])||0,
    course:r.CourseName||'' ,
    offer:r.OfferId||'',
    status:r.Status||''
  }));
  if(currentSort==='asc') rows.sort((a,b)=>a.periods-b.periods);
  else if(currentSort==='desc') rows.sort((a,b)=>b.periods-a.periods);
  else if(currentSort==='offer') rows.sort((a,b)=>String(a.offer).localeCompare(String(b.offer)));
  else if(currentSort==='status') rows.sort((a,b)=>String(a.status).localeCompare(String(b.status)));

  const tbody=document.querySelector('#dataTable tbody');
  tbody.innerHTML='';
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${r.nat}</td><td>${r.periods}</td><td>${r.course}</td>`;
    tbody.appendChild(tr);
  });
}

function setChartType(type){
  chartType=type;
  hideTable();
  document.querySelectorAll('.widget-list button').forEach(b=>b.classList.remove('active'));
  const idMap={bar:'barChartBtn',doughnut:'donutChartBtn',pie:'pieChartBtn'};
  const btnId=idMap[type];
  if(btnId) document.getElementById(btnId).classList.add('active');
  applyFilters();
}

function showTable(){
  document.getElementById('visaChart').style.display='none';
  document.querySelector('.table-container').style.display='block';
}

function hideTable(){
  document.getElementById('visaChart').style.display='block';
  document.querySelector('.table-container').style.display='none';
}
