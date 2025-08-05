// JS for current students report page
let rawData = [];
let chart;
let currentType = 'bar';
let sortOrder = null;
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
            rawData = data.map(r => ({...r, _start: parseDate(r.StartDate)}));
            applyFilters();
        });

    initTimePeriodFilter('.time-filter', (from, to) => { rangeStart = from; rangeEnd = to; applyFilters(); });

    document.getElementById('sortAsc').addEventListener('click', () => { sortOrder = 'asc'; setSortButtons(); applyFilters(); });
    document.getElementById('sortDesc').addEventListener('click', () => { sortOrder = 'desc'; setSortButtons(); applyFilters(); });

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

function applyFilters() {
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
        const nat = r.Nationality || 'Unknown';
        if(!grouped[nat]) grouped[nat] = { count:0, course: r.CourseName };
        grouped[nat].count += 1;
    });
    let rows = Object.entries(grouped).map(([k,v]) => ({ nat:k, count:v.count, course:v.course }));

    if(sortOrder === 'asc') rows.sort((a,b) => a.count - b.count);
    else if(sortOrder === 'desc') rows.sort((a,b) => b.count - a.count);

    updateTable(rows);
    if(currentType !== 'table') drawChart(currentType, rows);
}

function updateTable(rows) {
    const tbody = document.querySelector('#reportTable tbody');
    tbody.innerHTML = '';
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.nat}</td><td>${r.count}</td><td>${r.course}</td>`;
        tbody.appendChild(tr);
    });
}

function drawChart(type, rows) {
    rows = rows || Array.from(document.querySelectorAll('#reportTable tbody tr')).map(tr => {
        const tds = tr.querySelectorAll('td');
        return { nat: tds[0].textContent, count: +tds[1].textContent };
    });
    if(chart) chart.destroy();
    const ctx = document.getElementById('reportChart').getContext('2d');
    chart = new Chart(ctx, {
        type: type,
        data: {
            labels: rows.map(r=>r.nat),
            datasets: [{ label: 'Count', data: rows.map(r=>r.count) }]
        },
        options: { responsive: true }
    });
}


function setSortButtons() {
    document.getElementById('sortAsc').classList.toggle('active', sortOrder==='asc');
    document.getElementById('sortDesc').classList.toggle('active', sortOrder==='desc');
}
