// —— 1) Your aggregated dummy data from Excel ——
// (first four unique expiry dates & counts by CourseId)
const rawData = [
  { Expiry: "2024-08-07", CourseId: "BBT", Count: 1 },
  { Expiry: "2024-08-26", CourseId: "BBT", Count: 1 },
  { Expiry: "2024-09-01", CourseId: "BAn", Count: 5 },
  { Expiry: "2024-09-01", CourseId: "BBT", Count: 8 },
  { Expiry: "2024-09-08", CourseId: "BAn", Count: 3 },
  { Expiry: "2024-09-08", CourseId: "BBT", Count: 6 }
];

// —— 2) Pull out the unique Expiry dates & Course IDs —— 
const dates = [...new Set(rawData.map(r => r.Expiry))].sort();
const courses = [...new Set(rawData.map(r => r.CourseId))];

// —— 3) Loop over each date & render one stacked-bar chart per canvas ——
dates.forEach((date, idx) => {
  // Filter to rows matching this expiry date
  const slice = rawData.filter(r => r.Expiry === date);

  // Build one dataset per course (stack segment)
  const datasets = courses.map((course, i) => ({
    label: course,
    data: [ slice.find(r => r.CourseId === course)?.Count || 0 ],
    backgroundColor: `hsl(${i * 60}, 60%, 60%)`
  }));

  // Instantiate Chart.js
  new Chart(document.getElementById(`chart-${idx+1}`), {
    type: 'bar',
    data: {
      labels: [ date ],  // single x-axis label per mini-chart
      datasets
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: date
        },
        legend: {
          position: 'bottom'
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });
});
