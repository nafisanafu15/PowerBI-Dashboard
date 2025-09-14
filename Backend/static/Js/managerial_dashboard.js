 (function(){
  let rawData=[];
  let currentSort='';
  let chart;
  let chartType='bar';
  let rangeFrom=null;
  let rangeTo=null;
  const palette=['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF'];

  function parseDate(d){
    if(!d) return null;
    const p=d.split('/');
    if(p.length!==3) return null;
    return new Date(p[2],p[1]-1,p[0]);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    fetch('/api/data').then(r=>r.json()).then(data=>{
      rawData=data.map(r=>({
        ...r,
        _start:parseDate(r.StartDate || r.startdate)
      }));
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
    if(intakes.length) data=data.filter(r=>{
      const intake = r['Previous Offer Intake'] || r['previous_offer_intake'];
      return intakes.includes(intake);
    });

    updateChart(data);
    updateTable(data);
  }

  function updateChart(data){
    const counts={};
    data.forEach(r=>{
      const v = r['Visa Status'] || r['visa_status'] || 'Unknown';
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
        datasets:[{label:'Applications',data:values,backgroundColor:palette.slice(0,labels.length)}]
      },
      options:{responsive:true}
    };
    if(chartType==='bar') config.options.indexAxis='y';
    chart=new Chart(ctx,config);
  }

  function updateTable(data){
    let rows=data.map(r=>({
      nat:(r.Nationality||r.nationality||'Unknown'),
      periods:Number(r['Number of Study Periods']||r['number_of_study_periods'])||0,
      course:(r.CourseName||r.coursename||''),
      offer:(r.OfferId||r.offerid||''),
      status:(r.Status||r.status||'')
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
})();
