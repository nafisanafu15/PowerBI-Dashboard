// Application Status Bar Chart
new Chart(document.getElementById("applicationStatusChart"), {
  type: 'bar',
  data: {
    labels: ['Submitted', 'In Review', 'Accepted', 'Rejected'],
    datasets: [{
      label: 'Applications',
      backgroundColor: '#4e73df',
      data: [45, 25, 15, 5]
    }]
  },
  options: {
    responsive: true,
    plugins: {
      title: {
        display: false,
        text: 'Application Status'
      }
    }
  }
});

// Deferred Offers Overview Bar Chart
new Chart(document.getElementById("deferredOffersChart"), {
  type: 'bar',
  data: {
    labels: ['January', 'February', 'March', 'April'],
    datasets: [{
      label: 'Deferred Offers',
      backgroundColor: '#f6c23e',
      data: [8, 12, 9, 6]
    }]
  },
  options: {
    responsive: true,
    plugins: {
      title: {
        display: false,
        text: 'Deferred Offers Overview'
      }
    }
  }
});

// Agent Performance Bar Chart
new Chart(document.getElementById("agentPerformanceChart"), {
  type: 'bar',
  data: {
    labels: ['Agent A', 'Agent B', 'Agent C', 'Agent D'],
    datasets: [{
      label: 'Performance',
      backgroundColor: ['#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b'],
      data: [30, 50, 40, 20]
    }]
  },
  options: {
    responsive: true,
    plugins: {
      title: {
        display: false,
        text: 'Agent Performance'
      }
    }
  }
});

// Student Classification Pie Chart
new Chart(document.getElementById("studentClassificationChart"), {
  type: 'doughnut',
  data: {
    labels: ['Full-time', 'Part-time', 'Online'],
    datasets: [{
      backgroundColor: ['#ff6384', '#36a2eb', '#ffce56'],
      borderColor: '#ffffff',
      borderWidth: 2,
      hoverOffset: 8,
      data: [55, 25, 20]
    }]
  },
  options: {
    responsive: true,
    plugins: {
      title: {
        display: false,
        text: 'Student Classification'
      }
    }
  }
});
