let rawData = [];
let chart;
let currentType = 'bar';
let sortOrder = 'asc';
let rangeStart = null;
let rangeEnd = null;

function parseDate(d){
    if(!d) return null;
    const p = d.split('/');
    if(p.length!==3) return null;
    return new Date(p[2], p[1]-1, p[0]);
}

document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/data')
        .then(r => r.json())
        .then(data => {
            rawData = data.map(r => ({...r, _start: parseDate(r.StartDate)}));
            applyFilters();
        });

    initTimePeriodFilter('.time-filter', (from, to) => { rangeStart = from; rangeEnd = to; applyFilters(); });

    document.getElementById('sortAsc').addEventListener('click', () => { sortOrder='asc'; setSortButtons(); applyFilters(); });
    document.getElementById('sortDesc').addEventListener('click', () => { sortOrder='desc'; setSortButtons(); applyFilters(); });

    document.querySelectorAll('.intake').forEach(btn => btn.addEventListener('click', () => { btn.classList.toggle('active'); applyFilters(); }));
    document.getElementById('managerFilter').addEventListener('input', applyFilters);
    document.querySelectorAll('.course-toggle').forEach(btn => btn.addEventListener('click', () => { btn.classList.toggle('active'); applyFilters(); }));

    document.querySelectorAll('.chart-btn').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentType = btn.dataset.type;
        if(currentType === 'table') {
            if(chart) chart.destroy();
            document.getElementById('reportChart').classList.add('d-none');
        } else {
            document.getElementById('reportChart').classList.remove('d-none');
            drawChart(currentType);
        }
    }));
});

function applyFilters(){
    let data = rawData.slice();
    if(rangeStart) data = data.filter(r => r._start && r._start >= rangeStart);
    if(rangeEnd) data = data.filter(r => r._start && r._start <= rangeEnd);

    const intakes = Array.from(document.querySelectorAll('.intake.active')).map(b => b.dataset.sem);
    if(intakes.length) data = data.filter(r => intakes.includes(r['Previous Offer Intake']));

    const courses = Array.from(document.querySelectorAll('.course-toggle.active')).map(b => b.dataset.course);
    if(courses.length) data = data.filter(r => courses.includes(r.CourseName));

    const manager = document.getElementById('managerFilter').value.trim().toLowerCase();
    if(manager) data = data.filter(r => (r.CourseManager || '').toLowerCase().includes(manager));

    const grouped = {};
    data.forEach(r => {
        const date = r.StartDate || 'Unknown';
        if(!grouped[date]) grouped[date] = {students:0, offers:0};
        if(r.Stage === 'Student') grouped[date].students += 1;
        else if(r.Stage === 'Offer') grouped[date].offers += 1;
    });
    let rows = Object.entries(grouped).map(([d,v]) => ({ date:d, students:v.students, offers:v.offers }));

    if(sortOrder === 'asc') rows.sort((a,b) => (a.students+a.offers) - (b.students+b.offers));
    else if(sortOrder === 'desc') rows.sort((a,b) => (b.students+b.offers) - (a.students+a.offers));

    updateTable(rows);
    if(currentType !== 'table') drawChart(currentType, rows);
}

function updateTable(rows){
    const tbody = document.querySelector('#reportTable tbody');
    tbody.innerHTML = '';
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.date}</td><td>${r.students}</td><td>${r.offers}</td>`;
        tbody.appendChild(tr);
    });
}

function drawChart(type, rows){
    rows = rows || Array.from(document.querySelectorAll('#reportTable tbody tr')).map(tr => {
        const t = tr.querySelectorAll('td');
        return { date:t[0].textContent, students:+t[1].textContent, offers:+t[2].textContent };
    });
    if(chart) chart.destroy();
    const ctx = document.getElementById('reportChart').getContext('2d');
    if(type === 'pie' || type === 'doughnut'){
        const totalS = rows.reduce((s,r)=>s+r.students,0);
        const totalO = rows.reduce((s,r)=>s+r.offers,0);
        chart = new Chart(ctx, {
            type: type,
            data: { labels:['Students','Offers'], datasets:[{ data:[totalS,totalO], backgroundColor:['#5e4ae3','#c72c41'] }] },
            options:{ responsive:true }
        });
    } else {
        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: rows.map(r=>r.date),
                datasets: [
                    { label:'Students', data: rows.map(r=>r.students), backgroundColor:'#5e4ae3' },
                    { label:'Offers', data: rows.map(r=>r.offers), backgroundColor:'#c72c41' }
                ]
            },
            options:{ responsive:true }
        });
    }
}

function setSortButtons(){
    document.getElementById('sortAsc').classList.toggle('active', sortOrder==='asc');
    document.getElementById('sortDesc').classList.toggle('active', sortOrder==='desc');
}
