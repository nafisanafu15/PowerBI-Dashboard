// ===============================
// Managerial Landing Dashboard JS
// ===============================

// Helper: fetch data from backend API (placeholder example)
// Replace `/api/...` with your real endpoints that query SQLite
async function fetchData(endpoint) {
    const res = await fetch(endpoint);
    return await res.json();
}

// ===============================
// Current Student vs Enrolled (Bar Chart)
// ===============================
const ctxCurrentEnrolled = document.getElementById('chart-current-enrolled').getContext('2d');
new Chart(ctxCurrentEnrolled, {
    type: 'bar',
    data: {
        labels: ['Unknown'], // replace with dynamic categories
        datasets: [
            {
                label: 'Current Students',
                data: [14], // replace with backend data
                backgroundColor: '#36A2EB'
            },
            {
                label: 'Enrolled',
                data: [2], // replace with backend data
                backgroundColor: '#FF6384'
            }
        ]
    },
    options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } }
    }
});

// ===============================
// Enrolled vs Offer (Bar Chart)
// ===============================
const ctxEnrolledOffer = document.getElementById('chart-enrolled-offer').getContext('2d');
new Chart(ctxEnrolledOffer, {
    type: 'bar',
    data: {
        labels: ['Unknown'], // replace with backend categories
        datasets: [
            {
                label: 'Offers',
                data: [27], // replace with backend data
                backgroundColor: '#36A2EB'
            },
            {
                label: 'Enrolled',
                data: [3], // replace with backend data
                backgroundColor: '#FF6384'
            }
        ]
    },
    options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } }
    }
});

// ===============================
// Visa Breakdown (Doughnut Chart)
// ===============================
const ctxVisa = document.getElementById('chart-visa-breakdown').getContext('2d');
new Chart(ctxVisa, {
    type: 'doughnut',
    data: {
        labels: [
            'Student Visa',
            'Temporary Visa',
            'Permanent Resident',
            'Bridging Visa',
            'PR',
            'Tourist Visa'
        ],
        datasets: [{
            data: [45, 15, 10, 8, 12, 5], // replace with backend query results
            backgroundColor: [
                '#36A2EB', // Student Visa
                '#FF6384', // Temporary Visa
                '#FF9F40', // Permanent Resident
                '#FFCD56', // Bridging Visa
                '#4BC0C0', // PR
                '#9966FF'  // Tourist Visa
            ]
        }]
    },
    options: {
        responsive: true,
        plugins: {
            legend: { position: 'bottom' },
            title: { display: true, text: 'Visa Breakdown' }
        }
    }
});

// ===============================
// Offer Expiry Surge (Line Chart)
// ===============================
const ctxExpiry = document.getElementById('chart-offer-expiry-surge').getContext('2d');
new Chart(ctxExpiry, {
    type: 'line',
    data: {
        labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'], // replace with real dates
        datasets: [{
            label: 'Expiring Offers',
            data: [100, 98, 95, 93, 90], // replace with backend data
            borderColor: '#36A2EB',
            borderWidth: 2,
            fill: false,
            tension: 0.2,
            pointBackgroundColor: '#36A2EB'
        }]
    },
    options: {
        responsive: true,
        plugins: {
            legend: { position: 'bottom' },
            title: { display: true, text: 'Offer Expiry Surge' }
        },
        scales: {
            y: {
                beginAtZero: false,
                ticks: { stepSize: 2 }
            }
        }
    }
});
