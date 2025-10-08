// Build a time period selector with preset options and custom range
function initTimePeriodFilter(rootSelector, onChange) {
  const root = typeof rootSelector === "string" ? document.querySelector(rootSelector) : rootSelector;
  if (!root) return;

  const radios = Array.from(root.querySelectorAll('input[name="time"]'));
  if (!radios.length) return;

  const rangeDiv = root.querySelector(".date-range");
  const input = root.querySelector('input[type="text"]');
  const applyBtn = root.querySelector(".apply-range");
  const cancelBtn = root.querySelector(".cancel-range");

  const state = {
    preset: null,
    range: { from: null, to: null },
    defaultPreset: null
  };

  const presetGetters = {
    all() {
      return { from: null, to: null };
    },
    today(now) {
      return normalizeRange(startOfDay(now), endOfDay(now));
    },
    week(now) {
      const start = startOfDay(now);
      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek);
      const end = endOfDay(new Date(start));
      end.setDate(start.getDate() + 6);
      return normalizeRange(start, endOfDay(end));
    },
    month(now) {
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      return normalizeRange(start, end);
    },
    year(now) {
      const start = startOfDay(new Date(now.getFullYear(), 0, 1));
      const end = endOfDay(new Date(now.getFullYear(), 11, 31));
      return normalizeRange(start, end);
    },
    current_year(now) {
      const start = startOfDay(new Date(now.getFullYear(), 0, 1));
      const end = endOfDay(new Date(now.getFullYear(), 11, 31));
      return normalizeRange(start, end);
    },
    last_12_months(now) {
      const end = endOfDay(now);
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 11, 1));
      return normalizeRange(start, end);
    },
    last_24_months(now) {
      const end = endOfDay(now);
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 23, 1));
      return normalizeRange(start, end);
    }
  };

  const fp = input
    ? flatpickr(input, {
        mode: "range",
        dateFormat: "Y-m-d",
        onClose(selectedDates) {
          if (selectedDates.length === 2) {
            const range = normalizeRange(selectedDates[0], selectedDates[1]);
            state.range = range;
            state.preset = "custom";
            updateRadios();
            notify();
          }
        }
      })
    : null;

  function normalizeRange(rawFrom, rawTo) {
    if (!rawFrom || !rawTo) return { from: null, to: null };
    const start = startOfDay(rawFrom);
    const end = endOfDay(rawTo);
    if (start > end) return { from: end, to: start };
    return { from: start, to: end };
  }

  function startOfDay(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfDay(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function setRange(range, { silent = false } = {}) {
    state.range = range;
    if (fp && range.from && range.to) {
      fp.setDate([range.from, range.to], false);
    } else if (fp) {
      fp.clear();
    }
    if (!silent) notify();
  }

  function applyPreset(value, { openPicker = false } = {}) {
    state.preset = value;
    if (value === "custom") {
      toggleRange(true);
      if (openPicker && fp) fp.open();
      return;
    }

    toggleRange(false);
    const getter = presetGetters[value];
    if (!getter) {
      setRange({ from: null, to: null });
      return;
    }

    const range = getter(new Date());
    setRange(range);
  }

  function toggleRange(shouldShow) {
    if (!rangeDiv) return;
    rangeDiv.style.display = shouldShow ? "flex" : "none";
  }

  function updateRadios() {
    radios.forEach(radio => {
      const isMatch = radio.value === state.preset;
      radio.checked = isMatch;
    });
  }

  function notify() {
    if (typeof onChange === "function") {
      const { from, to } = state.range;
      onChange(from, to);
    }
  }

  radios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.preset = radio.value;
      if (state.preset !== "custom") {
        applyPreset(state.preset);
      } else {
        toggleRange(true);
        if (fp) fp.open();
      }
    });

    if (radio.checked && !state.defaultPreset) {
      state.defaultPreset = radio.value;
    }
  });

  if (!state.defaultPreset && radios.length) {
    state.defaultPreset = radios[0].value;
    radios[0].checked = true;
  }

  state.preset = state.defaultPreset;
  applyPreset(state.preset, { openPicker: false });

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!fp) {
        notify();
        return;
      }
      const [from, to] = fp.selectedDates;
      if (from && to) {
        setRange(normalizeRange(from, to));
      }
      notify();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      if (fp) fp.clear();
      toggleRange(false);
      state.preset = state.defaultPreset;
      updateRadios();
      applyPreset(state.preset);
    });
  }
}

// Expose initializer globally
window.initTimePeriodFilter = initTimePeriodFilter;
