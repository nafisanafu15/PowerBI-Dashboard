// ===============================
// Managerial Landing Dashboard JS
// ===============================

// Helper: fetch data from backend API (placeholder example)
// Replace `/api/...` with your real endpoints that query SQLite
async function fetchData(endpoint) {
    const res = await fetch(endpoint);
    return await res.json();
}

const STORYBOARD_FALLBACK = 'AI insight is not available right now.';
const STORYBOARD_THEMES = ['blue', 'orange', 'green', 'purple', 'teal', 'slate'];

const storyboardUI = (() => {
    let lastUpdatedText = '';
    let modalElements = null;

    function ensureModal() {
        if (modalElements) return modalElements;
        const modal = document.getElementById('storyboard-modal');
        if (!modal) return null;
        const dialog = modal.querySelector('.storyboard-modal__dialog');
        const titleEl = document.getElementById('storyboard-modal-title');
        const summaryEl = document.getElementById('storyboard-modal-summary');
        const detailsEl = document.getElementById('storyboard-modal-details');
        const timestampEl = document.getElementById('storyboard-modal-timestamp');

        modal.querySelectorAll('[data-modal-dismiss]').forEach((el) => {
            el.addEventListener('click', closeModal);
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal.classList.contains('is-active')) {
                closeModal();
            }
        });

        modalElements = { modal, dialog, titleEl, summaryEl, detailsEl, timestampEl };
        return modalElements;
    }

    function closeModal() {
        const els = ensureModal();
        if (!els) return;
        els.modal.classList.remove('is-active');
        els.modal.setAttribute('aria-hidden', 'true');
    }

    function renderDetails(container, detailsText, summaryText) {
        if (!container) return;
        container.innerHTML = '';
        const lines = String(detailsText || '')
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean);
        const filtered = summaryText ? lines.filter((line) => line !== summaryText.trim()) : lines;
        if (!filtered.length) return;
        filtered.forEach((line) => {
            const p = document.createElement('p');
            p.textContent = line;
            container.appendChild(p);
        });
    }

    function openModal({ title, summary, details, timestamp }) {
        const els = ensureModal();
        if (!els) return;
        els.titleEl.textContent = title || 'AI Insight';
        els.summaryEl.textContent = summary || STORYBOARD_FALLBACK;
        renderDetails(els.detailsEl, details, summary);
        els.timestampEl.textContent = timestamp || lastUpdatedText || '';
        els.modal.classList.add('is-active');
        els.modal.setAttribute('aria-hidden', 'false');
        if (els.dialog) {
            requestAnimationFrame(() => {
                els.dialog.focus({ preventScroll: true });
            });
        }
    }

    function splitStory(rawText) {
        const text = String(rawText || '').trim();
        if (!text) {
            return { summary: STORYBOARD_FALLBACK, details: STORYBOARD_FALLBACK };
        }
        const parts = text
            .split(/\n+/)
            .map((part) => part.trim())
            .filter(Boolean);
        const summaryLine = parts.shift() || STORYBOARD_FALLBACK;
        const cleanedSummary = summaryLine.replace(/^Summary:\s*/i, '').trim() || summaryLine;
        const detailLines = parts.map((part) => part.replace(/^\s+/g, '').replace(/\s+/g, ' '));
        const detailsText = detailLines.length ? detailLines.join('\n') : cleanedSummary;
        return { summary: cleanedSummary, details: detailsText };
    }

    function bindCard(summaryEl, storyText) {
        if (!summaryEl) return;
        const card = summaryEl.closest('.storyboard-card, .kpi-card, [data-story-trigger]');
        const { summary, details } = splitStory(storyText);
        summaryEl.textContent = summary;
        if (!card) return;
        card.dataset.storySummary = summary;
        card.dataset.storyDetails = details;
        card.dataset.storyTimestamp = lastUpdatedText;
        if (!card.dataset.storyTitle) {
            const titleEl = card.querySelector('.storyboard-card__title, h4, [data-story-title-text]');
            const textContent = titleEl ? titleEl.textContent.trim() : '';
            if (textContent) card.dataset.storyTitle = textContent;
        }

        if (!card.hasAttribute('tabindex')) {
            card.tabIndex = 0;
        }
        card.setAttribute('role', card.getAttribute('role') || 'button');

        if (card.dataset.modalBound !== 'true') {
            const open = () => {
                openModal({
                    title: card.dataset.storyTitle,
                    summary: card.dataset.storySummary,
                    details: card.dataset.storyDetails,
                    timestamp: card.dataset.storyTimestamp,
                });
            };

            card.addEventListener('click', open);
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
            card.dataset.modalBound = 'true';
        }
    }

    return {
        setLastUpdated(text) {
            lastUpdatedText = text || '';
        },
        applyStory(summaryEl, storyText) {
            bindCard(summaryEl, storyText);
        },
        applyFallback(summaryEl) {
            bindCard(summaryEl, STORYBOARD_FALLBACK);
        },
    };
})();

const CHART_PALETTE = ['#36A2EB', '#FF6384', '#FF9F40', '#FFCD56', '#4BC0C0', '#9966FF', '#8E44AD', '#2ECC71'];
const chartRegistry = new Map();

function updateChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    if (chartRegistry.has(canvasId)) {
        chartRegistry.get(canvasId).destroy();
        chartRegistry.delete(canvasId);
    }
    if (container) {
        const empty = container.querySelector('.chart-empty');
        if (empty) empty.remove();
    }
    canvas.style.display = 'block';
    const chart = new Chart(ctx, config);
    chartRegistry.set(canvasId, chart);
}

function showChartMessage(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartRegistry.has(canvasId)) {
        chartRegistry.get(canvasId).destroy();
        chartRegistry.delete(canvasId);
    }
    const container = canvas.parentElement;
    canvas.style.display = 'none';
    if (!container) return;
    let placeholder = container.querySelector('.chart-empty');
    if (!placeholder) {
        placeholder = document.createElement('p');
        placeholder.className = 'chart-empty text-muted text-center mt-3';
        container.appendChild(placeholder);
    }
    placeholder.textContent = message;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function unique(values) {
    return Array.from(new Set(values));
}

function normalizeIntake(value) {
    if (value == null) return 'Unknown';
    const raw = String(value).trim().toLowerCase();
    if (!raw) return 'Unknown';
    const compact = raw.replace(/\s+/g, '');
    const match = compact.match(/^(?:trimester|semester|term|quarter|t|s|q)(\d)$/);
    if (match) {
        return `Trimester ${match[1]}`;
    }
    if (/^trimester\s*[1-4]$/.test(raw)) {
        return raw.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    }
    return raw.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

async function renderStudyReasonChart() {
    const canvasId = 'chart-study-reason';
    try {
        const rows = await fetchData('/api/study-reason-by-course');
        if (!Array.isArray(rows) || !rows.length) {
            showChartMessage(canvasId, 'No study reason data available');
            return;
        }

        const courseTotals = new Map();
        rows.forEach((row) => {
            const course = String(row.course_name || row.course || 'Unknown').trim() || 'Unknown';
            const count = toNumber(row.student_count);
            courseTotals.set(course, (courseTotals.get(course) || 0) + count);
        });

        const courses = unique(rows.map((row) => String(row.course_name || row.course || 'Unknown').trim() || 'Unknown'))
            .sort((a, b) => (courseTotals.get(b) || 0) - (courseTotals.get(a) || 0));
        const reasons = unique(rows.map((row) => String(row.study_reason || row.reason || 'Unknown').trim() || 'Unknown'));

        const dataMap = new Map();
        rows.forEach((row) => {
            const course = String(row.course_name || row.course || 'Unknown').trim() || 'Unknown';
            const reason = String(row.study_reason || row.reason || 'Unknown').trim() || 'Unknown';
            const key = `${course}__${reason}`;
            dataMap.set(key, (dataMap.get(key) || 0) + toNumber(row.student_count));
        });

        const datasets = reasons.map((reason, idx) => ({
            label: reason,
            data: courses.map((course) => dataMap.get(`${course}__${reason}`) || 0),
            backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length],
            stack: 'study-reason'
        }));

        updateChart(canvasId, {
            type: 'bar',
            data: { labels: courses, datasets },
            options: {
                indexAxis: 'y',
                responsive: true,
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    x: { beginAtZero: true, stacked: true },
                    y: { stacked: true }
                }
            }
        });
    } catch (error) {
        console.error('study reason chart failed', error);
        showChartMessage(canvasId, 'Unable to load study reason insights');
    }
}

async function renderTrimesterChart() {
    const canvasId = 'chart-trimester';
    try {
        const rows = await fetchData('/api/students-by-trimester');
        if (!Array.isArray(rows) || !rows.length) {
            showChartMessage(canvasId, 'No trimester data available');
            return;
        }

        const ordered = rows
            .map((row) => ({
                term: String(row.term || 'Unknown').trim() || 'Unknown',
                count: toNumber(row.student_count)
            }))
            .sort((a, b) => a.term.localeCompare(b.term));

        updateChart(canvasId, {
            type: 'bar',
            data: {
                labels: ordered.map((row) => row.term),
                datasets: [
                    {
                        label: 'Students',
                        data: ordered.map((row) => row.count),
                        backgroundColor: '#36A2EB'
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    } catch (error) {
        console.error('trimester chart failed', error);
        showChartMessage(canvasId, 'Unable to load trimester totals');
    }
}

async function renderVisaBreakdownChart() {
    const canvasId = 'chart-visa-breakdown';
    try {
        const rows = await fetchData('/api/visa-breakdown');
        if (!Array.isArray(rows) || !rows.length) {
            showChartMessage(canvasId, 'No visa data available');
            return;
        }

        const labels = rows.map((row) => String(row.visa_type || row.visa || 'Unknown').trim() || 'Unknown');
        const data = rows.map((row) => toNumber(row.student_count));

        updateChart(canvasId, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [
                    {
                        data,
                        backgroundColor: labels.map((_, idx) => CHART_PALETTE[idx % CHART_PALETTE.length])
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    } catch (error) {
        console.error('visa chart failed', error);
        showChartMessage(canvasId, 'Unable to load visa breakdown');
    }
}

async function renderCourseByManagerChart() {
    const canvasId = 'chart-course-by-manager';
    try {
        const rows = await fetchData('/api/course-by-manager');
        if (!Array.isArray(rows) || !rows.length) {
            showChartMessage(canvasId, 'No course manager data available');
            return;
        }

        const totals = new Map();
        const labels = unique(
            rows.map((row) => {
                const course = String(row.course_name || row.Course_Name || 'Unknown').trim() || 'Unknown';
                const count = toNumber(row.student_count);
                totals.set(course, (totals.get(course) || 0) + count);
                return course;
            })
        );
        const managers = unique(
            rows.map((row) => String(row.course_manager || row.Course_Manager || 'Unknown').trim() || 'Unknown')
        );

        if (!labels.length || !managers.length) {
            showChartMessage(canvasId, 'Course or manager details are unavailable');
            return;
        }

        labels.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));

        const lookup = new Map();
        rows.forEach((row) => {
            const course = String(row.course_name || row.Course_Name || 'Unknown').trim() || 'Unknown';
            const manager = String(row.course_manager || row.Course_Manager || 'Unknown').trim() || 'Unknown';
            const key = `${course}__${manager}`;
            lookup.set(key, (lookup.get(key) || 0) + toNumber(row.student_count));
        });

        const datasets = managers.map((manager, idx) => ({
            label: manager,
            data: labels.map((course) => lookup.get(`${course}__${manager}`) || 0),
            backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length],
            stack: 'total'
        }));

        if (!datasets.length) {
            showChartMessage(canvasId, 'No course manager data available');
            return;
        }

        updateChart(canvasId, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                indexAxis: 'y',
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    x: { beginAtZero: true, stacked: true },
                    y: { stacked: true }
                }
            }
        });
    } catch (error) {
        console.error('course by manager chart failed', error);
        showChartMessage(canvasId, 'Unable to load course manager data');
    }
}

// ===============================
// AI Storyboards
// ===============================
function resolveTheme(story, index) {
    const desired = (story && typeof story.theme === 'string') ? story.theme.trim() : '';
    if (desired && STORYBOARD_THEMES.includes(desired)) {
        return desired;
    }
    return STORYBOARD_THEMES[index % STORYBOARD_THEMES.length];
}

function renderStoryboardCards(containerId, stories) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    const list = Array.isArray(stories) ? stories : [];

    if (!list.length) {
        const card = document.createElement('div');
        card.classList.add('kpi-card', STORYBOARD_THEMES[0]);
        card.setAttribute('data-story-trigger', '');
        const titleEl = document.createElement('h4');
        titleEl.textContent = 'AI Insight';
        const summaryEl = document.createElement('p');
        card.append(titleEl, summaryEl);
        container.appendChild(card);
        storyboardUI.applyFallback(summaryEl);
        return;
    }

    list.forEach((story, index) => {
        const card = document.createElement('div');
        const theme = resolveTheme(story, index);
        card.classList.add('kpi-card', theme);
        card.setAttribute('data-story-trigger', '');
        card.dataset.storyKey = story?.key || `story-${index}`;
        const titleText = story?.title || 'AI Insight';
        card.dataset.storyTitle = titleText;

        const titleEl = document.createElement('h4');
        titleEl.textContent = titleText;
        const summaryEl = document.createElement('p');
        summaryEl.id = `story-${story?.key || index}`;

        card.append(titleEl, summaryEl);
        container.appendChild(card);

        storyboardUI.applyStory(summaryEl, story?.text || STORYBOARD_FALLBACK);
    });
}

async function loadStoryboards(role, containerId, timestampId) {
    try {
        const response = await fetch(`/api/storyboards/${role}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const stories = Array.isArray(payload.stories) ? payload.stories : [];

        let formattedTimestamp = '';
        if (payload.updated_at) {
            const parsed = new Date(payload.updated_at);
            formattedTimestamp = isNaN(parsed.getTime())
                ? `Updated ${payload.updated_at}`
                : `Updated ${parsed.toLocaleString()}`;
        }

        if (!formattedTimestamp) {
            formattedTimestamp = 'Updated just now';
        }

        if (timestampId) {
            const tsEl = document.getElementById(timestampId);
            if (tsEl) {
                tsEl.textContent = formattedTimestamp;
            }
        }

        storyboardUI.setLastUpdated(formattedTimestamp);

        renderStoryboardCards(containerId, stories);
    } catch (error) {
        console.error('storyboards (manager)', error);
        storyboardUI.setLastUpdated('Updated: unavailable');
        renderStoryboardCards(containerId, []);
        if (timestampId) {
            const tsEl = document.getElementById(timestampId);
            if (tsEl) tsEl.textContent = 'Updated: unavailable';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadStoryboards('manager', 'storyboard-card-container', 'storyboards-updated');
    renderStudyReasonChart();
    renderTrimesterChart();
    renderVisaBreakdownChart();
    renderCourseByManagerChart();
});
