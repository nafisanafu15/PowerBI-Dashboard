let rawData = [];
let filteredData = [];
let chart;
let chartType = 'bar';
let sortField = 'OfferId';
let sortOrder = 'asc';
let rangeStart = null;
let rangeEnd = null;

function parseDate(d){
  if(!d) return null;
  const parts = d.split('/');
  if(parts.length!==3) return null;
  return new Date(parts[2], parts[1]-1, parts[0]);
}

document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/data')
    .then(r => r.json())
    .then(data => {
      rawData = data.map(r => ({...r, _expiry: parseDate(r['Offer Expiry Date'])}));
      applyFilters();
    });

  initTimePeriodFilter('.time-filter', (from, to) => { rangeStart = from; rangeEnd = to; applyFilters(); });

  document.querySelectorAll('.sort-field').forEach(btn =>
    btn.addEventListener('click', () => { setActive('.sort-field', btn); sortField = btn.dataset.field; applyFilters(); }));
  document.querySelectorAll('.sort-order').forEach(btn =>
    btn.addEventListener('click', () => { setActive('.sort-order', btn); sortOrder = btn.dataset.order; applyFilters(); }));

  document.querySelectorAll('.intake').forEach(btn =>
    btn.addEventListener('click', () => { btn.classList.toggle('active'); applyFilters(); }));

  document.getElementById('managerFilter').addEventListener('input', applyFilters);
  document.getElementById('offerIdFilter').addEventListener('input', applyFilters);
  document.querySelectorAll('.status-filter').forEach(ch => ch.addEventListener('change', applyFilters));

  document.querySelectorAll('.chart-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartType = btn.dataset.type;
      if(chartType === 'table'){ if(chart) chart.destroy(); document.getElementById('mainChart').classList.add('d-none'); }
      else document.getElementById('mainChart').classList.remove('d-none');
      applyFilters();
    }));

  document.getElementById('downloadCsv').addEventListener('click', () => downloadCSV(filteredData));
});

function setActive(selector, btn){
  document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}


function applyFilters(){
  filteredData = rawData.slice();
  if(rangeStart) filteredData = filteredData.filter(r => r._expiry && r._expiry >= rangeStart);
  if(rangeEnd)   filteredData = filteredData.filter(r => r._expiry && r._expiry <= rangeEnd);

  const intakes = Array.from(document.querySelectorAll('.intake.active')).map(b => b.dataset.sem);
  if(intakes.length) filteredData = filteredData.filter(r => intakes.includes(r['Previous Offer Intake']));

  const manager = document.getElementById('managerFilter').value.trim().toLowerCase();
  if(manager) filteredData = filteredData.filter(r => (r.CourseManager || '').toLowerCase().includes(manager));

  const offerId = document.getElementById('offerIdFilter').value.trim();
  if(offerId) filteredData = filteredData.filter(r => String(r.OfferId || '').includes(offerId));

  const statuses = Array.from(document.querySelectorAll('.status-filter:checked')).map(c => c.value);
  if(statuses.length) filteredData = filteredData.filter(r => statuses.includes(r.Status));

  filteredData.sort((a,b) => {
    const A = a[sortField] || '';
    const B = b[sortField] || '';
    return sortOrder==='asc' ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
  });

  updateTable(filteredData);
  if(chartType !== 'table') drawChart(chartType, filteredData);
  else document.getElementById('noData').classList.add('d-none');
}

function updateTable(data){
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';
  if(!data.length){ document.getElementById('noData').classList.remove('d-none'); return; }
  document.getElementById('noData').classList.add('d-none');
  data.forEach(r => {
    const tr=document.createElement('tr');
    const count = Number(r['Number of Study Periods']) || 0;
    tr.innerHTML = `<td>${r.Nationality||''}</td><td>${count}</td><td>${r.CourseName||''}</td>`;
    tbody.appendChild(tr);
  });
}

function drawChart(type,data){
  const counts={};
  data.forEach(r=>{
    if(!r._expiry) return;
    const m = r._expiry.getFullYear()+'-'+String(r._expiry.getMonth()+1).padStart(2,'0');
    counts[m]=(counts[m]||0)+1;
  });
  const labels=Object.keys(counts);
  const values=Object.values(counts);
  if(chart) chart.destroy();
  chart=new Chart(document.getElementById('mainChart'),{
    type: type,
    data:{labels:labels,datasets:[{label:'Expiring Offers',data:values,backgroundColor:'#7D60A7'}]},
    options:{indexAxis:type==='bar'?'y':'x',responsive:true}
  });
}

function downloadCSV(data){
  let csv='Nationality,Number of Study Periods,Course Name\n';
  data.forEach(r=>{ csv+=`${r.Nationality||''},${r['Number of Study Periods']||''},${r.CourseName||''}\n`; });
  const blob=new Blob([csv],{type:'text/csv'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download='offer_expiry.csv';
  link.click();
}
