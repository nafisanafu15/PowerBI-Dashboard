// Simple helpers for API requests and DOM selection

apiFetch("yourEndpoint").then(data => {
    rawData = data.map(r => {
        const rr = { ...r };
        rr["Visa Status"] = normalizeValue("Visa Status", rr["Visa Status"]);
        rr.Campus_Name    = normalizeValue("Campus_Name", rr.Campus_Name);
        return rr;
    }).filter(r => validateRow(r).ok);

    applyFilters();
});

// Shorthand query selectors
export const $ = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// Basic DOM utilities
export function setText(el, t){ if (el) el.textContent = t; }
export function show(el, disp="inline"){ if (el) el.style.display = disp; }
export function hide(el){ if (el) el.style.display = "none"; }

