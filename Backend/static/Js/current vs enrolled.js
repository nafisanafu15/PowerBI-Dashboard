const data = {
  labels: [
    'Indian','Chinese','Sri Lankan','Thai','Kenyan','Pakistani',
    'Nepalese','Guinean','Vietnamese','Filipino','Bangladeshi',
    'Laotian','Cambodian','Fijian'
  ],
  datasets: [
    {
      label: 'Bachelor of Analytics',
      data: [1250, 200, 80, 30, 20, 15, 10, 5, 10, 8, 5, 3, 2, 1],
      backgroundColor: '#1e88e5'
    },
    {
      label: 'Bachelor of Business Transformation',
      data: [1020, 180, 50, 25, 18, 12, 8, 4, 8, 6, 4, 2, 1, 1],
      backgroundColor: '#1565c0'
    }
  ]
};

// 2) Draw the grouped bar chart once the DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  // 2a) Grab the canvas by its ID
  const canvas = document.getElementById('grouped-bar');
  if (!canvas) {
    console.error('Canvas #grouped-bar not found');
    return;
  }

  // 2b) Ensure Chart.js is loaded
  if (typeof Chart === 'undefined') {
    console.error('Chart.js not loaded');
    return;
  }

  const ctx = canvas.getContext('2d');

  // 2c) Instantiate the chart
  new Chart(ctx, {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: false }
      },
      scales: {
        x: {
          title: { display: true, text: 'Nationality' },
          stacked: false
        },
        y: {
          title: { display: true, text: 'Sum of Study Periods' },
          beginAtZero: true,
          stacked: false
        }
      }
    }
  });
});
