(function () {
  'use strict';

  /* ---------------- date helpers ---------------- */
  function isoDate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function todayISO() { return isoDate(new Date()); }
  function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
  function weekdayShort(dateStr) { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }); }
  function weekdayLong(dateStr) { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }); }
  function monthDay(dateStr) { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function isWeekday(dateStr) { const d = new Date(dateStr + 'T00:00:00').getDay(); return d >= 1 && d <= 5; }
  function mondayOfWeek(dateStr) { const d = new Date(dateStr + 'T00:00:00'); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return isoDate(d); }
  function makeId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------------- storage ---------------- */
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('Could not save', key, e); }
  }

  const GOAL_MIN = 60;

  const state = {
    workoutPlan: load('workout-plan', {}),
    workTracker: load('work-tracker', {}),
    creativeLog: load('creative-log', {}),
    weightUnit: load('workout-unit', 'kg'),
    selectedExercise: null,
    syncCode: load('sync-code', null),
    syncStatus: 'off', // off | syncing | synced | offline
    selectedDate: todayISO(),
    weekAnchor: mondayOfWeek(todayISO()),
    popoverMonth: todayISO().slice(0, 7),
    showMonthPicker: false,
  };

  function persist() {
    save('workout-plan', state.workoutPlan);
    save('work-tracker', state.workTracker);
    save('creative-log', state.creativeLog);
    save('workout-unit', state.weightUnit);
    pushToCloud();
  }

  /* ---------------- cloud sync (Firebase Firestore) ---------------- */
  let db = null;
  let unsubscribeSnapshot = null;
  let pushTimer = null;
  let lastLocalWriteAt = 0;

  function isFirebaseConfigured() {
    return typeof firebase !== 'undefined' &&
      window.FIREBASE_CONFIG &&
      window.FIREBASE_CONFIG.apiKey &&
      !String(window.FIREBASE_CONFIG.apiKey).startsWith('REPLACE_ME');
  }

  function initSync() {
    if (!isFirebaseConfigured()) { state.syncStatus = 'off'; renderSyncBadge(); return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.firestore();
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    } catch (e) {
      console.error('Firebase init failed', e);
      state.syncStatus = 'off'; renderSyncBadge(); return;
    }
    if (state.syncCode) startListening(state.syncCode);
    else renderSyncBadge();
  }

  function startListening(code) {
    if (!db) return;
    state.syncCode = code;
    save('sync-code', code);
    state.syncStatus = 'syncing';
    renderSyncBadge();
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = db.collection('ledger-sync').doc(code).onSnapshot(
      (doc) => {
        if (!doc.exists) {
          // nothing in the cloud yet under this code — seed it with what we have locally
          pushToCloud(true);
          state.syncStatus = 'synced';
          renderSyncBadge();
          return;
        }
        // Ignore snapshots that are just an echo of our own pending write
        if (!doc.metadata.hasPendingWrites) {
          const data = doc.data();
          const remoteAt = data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : 0;
          if (remoteAt >= lastLocalWriteAt && data.payload) {
            const p = data.payload;
            state.workoutPlan = p.workoutPlan || {};
            state.workTracker = p.workTracker || {};
            state.creativeLog = p.creativeLog || {};
            state.weightUnit = p.weightUnit || 'kg';
            save('workout-plan', state.workoutPlan);
            save('work-tracker', state.workTracker);
            save('creative-log', state.creativeLog);
            save('workout-unit', state.weightUnit);
            render();
          }
        }
        state.syncStatus = 'synced';
        renderSyncBadge();
      },
      (err) => {
        console.error('Sync error', err);
        state.syncStatus = 'offline';
        renderSyncBadge();
      }
    );
  }

  function pushToCloud(immediate) {
    if (!db || !state.syncCode) return;
    lastLocalWriteAt = Date.now();
    state.syncStatus = 'syncing';
    renderSyncBadge();
    clearTimeout(pushTimer);
    const doPush = () => {
      db.collection('ledger-sync').doc(state.syncCode).set({
        payload: {
          workoutPlan: state.workoutPlan,
          workTracker: state.workTracker,
          creativeLog: state.creativeLog,
          weightUnit: state.weightUnit,
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(() => {
        state.syncStatus = 'synced';
        renderSyncBadge();
      }).catch((e) => {
        console.error('Push failed', e);
        state.syncStatus = 'offline';
        renderSyncBadge();
      });
    };
    if (immediate) doPush();
    else pushTimer = setTimeout(doPush, 500);
  }

  function renderSyncBadge() {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    el.className = 'sync-badge' + (state.syncCode ? ' ' + state.syncStatus : '');
    if (!isFirebaseConfigured()) { el.textContent = 'Set up sync'; return; }
    if (!state.syncCode) { el.textContent = 'Set up sync'; return; }
    const labels = { syncing: '↻ Syncing…', synced: '✓ Synced', offline: '⚠ Offline' };
    el.textContent = labels[state.syncStatus] || 'Sync';
  }

  /* ---------------- tiny SVG chart helpers ---------------- */
  function lineChartSVG(points, unit) {
    const w = 600, h = 200, padL = 34, padR = 16, padT = 16, padB = 28;
    const values = points.map(p => p.weight);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const yFor = v => padT + (1 - (v - min) / range) * (h - padT - padB);
    const xFor = i => points.length === 1 ? w / 2 : padL + (i / (points.length - 1)) * (w - padL - padR);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.weight).toFixed(1)}`).join(' ');
    const dots = points.map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.weight).toFixed(1)}" r="4" fill="var(--tab-workout)"><title>${esc(monthDay(p.date))}: ${p.weight}${unit}${p.sets && p.reps ? ' · ' + p.sets + '×' + p.reps : ''}</title></circle>`).join('');
    const labels = points.map((p, i) => `<text x="${xFor(i).toFixed(1)}" y="${h - 8}" font-size="9" text-anchor="middle">${esc(monthDay(p.date))}</text>`).join('');
    const yTicks = [min, (min + max) / 2, max].map(v => `<text x="4" y="${(yFor(v) + 3).toFixed(1)}" font-size="9">${Math.round(v)}${unit}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" height="200" xmlns="http://www.w3.org/2000/svg">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="var(--paper-line)" />
      <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="var(--paper-line)" />
      ${yTicks}
      <path d="${path}" fill="none" stroke="var(--tab-workout)" stroke-width="2.5" />
      ${dots}
      ${labels}
    </svg>`;
  }

  function barChartSVG(days) {
    const w = 600, h = 220, padL = 30, padR = 10, padT = 10, padB = 24;
    const max = Math.max(60, ...days.map(d => Math.max(d.reading, d.writing)));
    const groupW = (w - padL - padR) / days.length;
    const barW = groupW * 0.32;
    const yFor = v => padT + (1 - v / max) * (h - padT - padB);
    let bars = '';
    days.forEach((d, i) => {
      const cx = padL + groupW * i + groupW / 2;
      const rH = yFor(0) - yFor(d.reading), wH = yFor(0) - yFor(d.writing);
      bars += `<rect x="${(cx - barW - 2).toFixed(1)}" y="${yFor(d.reading).toFixed(1)}" width="${barW.toFixed(1)}" height="${rH.toFixed(1)}" fill="var(--tab-work)" rx="2"><title>Reading ${d.reading}m</title></rect>`;
      bars += `<rect x="${(cx + 2).toFixed(1)}" y="${yFor(d.writing).toFixed(1)}" width="${barW.toFixed(1)}" height="${wH.toFixed(1)}" fill="var(--tab-creative)" rx="2"><title>Writing ${d.writing}m</title></rect>`;
      bars += `<text x="${cx.toFixed(1)}" y="${h - 8}" font-size="9" text-anchor="middle">${esc(d.label)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" height="220" xmlns="http://www.w3.org/2000/svg">
      <line x1="${padL}" y1="${yFor(GOAL_MIN).toFixed(1)}" x2="${w - padR}" y2="${yFor(GOAL_MIN).toFixed(1)}" stroke="var(--ink-soft)" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="var(--paper-line)" />
      <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="var(--paper-line)" />
      ${bars}
    </svg>
    <div style="display:flex;gap:14px;font-size:11px;margin-top:4px;">
      <span><span style="display:inline-block;width:9px;height:9px;background:var(--tab-work);border-radius:2px;margin-right:4px;"></span>Reading</span>
      <span><span style="display:inline-block;width:9px;height:9px;background:var(--tab-creative);border-radius:2px;margin-right:4px;"></span>Writing</span>
    </div>`;
  }

  /* ---------------- render: workout ---------------- */
  function buildExerciseHistory(plan) {
    const history = {};
    Object.keys(plan).sort().forEach(date => {
      (plan[date] || []).forEach(ex => {
        if (ex.weight == null || ex.weight === '') return;
        const key = ex.name.trim();
        (history[key] = history[key] || []).push({ date, weight: ex.weight, sets: ex.sets, reps: ex.reps });
      });
    });
    return history;
  }

  function detailLine(ex, unit) {
    const parts = [];
    if (ex.sets && ex.reps) parts.push(`${ex.sets}×${ex.reps}`);
    else if (ex.sets) parts.push(`${ex.sets} sets`);
    else if (ex.reps) parts.push(`${ex.reps} reps`);
    if (ex.weight != null && ex.weight !== '') parts.push(`${ex.weight}${unit}`);
    return parts.join(' · ');
  }

  function allExerciseNames(plan) {
    const names = new Set();
    Object.keys(plan).forEach(date => {
      (plan[date] || []).forEach(ex => {
        const n = (ex.name || '').trim();
        if (n) names.add(n);
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function findLastExerciseByName(name) {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    const dates = Object.keys(state.workoutPlan).sort().reverse();
    for (const d of dates) {
      const match = (state.workoutPlan[d] || []).find(ex => (ex.name || '').trim().toLowerCase() === target);
      if (match) return match;
    }
    return null;
  }

  function renderWorkoutForDay(date) {
    const plan = state.workoutPlan, unit = state.weightUnit;
    const history = buildExerciseHistory(plan);
    const chartable = Object.keys(history).filter(n => history[n].length >= 2).sort((a, b) => a.localeCompare(b));
    if (!state.selectedExercise && chartable.length) state.selectedExercise = chartable[chartable.length - 1];
    if (state.selectedExercise && !chartable.includes(state.selectedExercise)) state.selectedExercise = chartable[chartable.length - 1] || null;

    const exs = plan[date] || [];
    const done = exs.length > 0 && exs.every(e => e.done);
    const rows = exs.length === 0
      ? `<div class="empty-state" style="padding:10px 2px;text-align:left;">No exercises planned for this day</div>`
      : exs.map(ex => `
        <div class="exercise-row ${ex.done ? 'done' : ''}">
          <button class="check-box ${ex.done ? 'checked' : ''}" data-action="toggle-ex" data-date="${date}" data-id="${ex.id}" aria-label="Toggle done">${ex.done ? '✓' : ''}</button>
          <span class="exercise-name">${esc(ex.name)}</span>
          <div class="exercise-fields">
            <input class="ex-field" type="number" min="0" placeholder="sets" value="${ex.sets ?? ''}" data-action="set-ex-field" data-date="${date}" data-id="${ex.id}" data-field="sets" aria-label="Sets for ${esc(ex.name)}" />
            <span class="ex-times">×</span>
            <input class="ex-field" type="number" min="0" placeholder="reps" value="${ex.reps ?? ''}" data-action="set-ex-field" data-date="${date}" data-id="${ex.id}" data-field="reps" aria-label="Reps for ${esc(ex.name)}" />
            <input class="ex-field ex-weight" type="number" min="0" step="0.5" placeholder="wt" value="${ex.weight ?? ''}" data-action="set-ex-field" data-date="${date}" data-id="${ex.id}" data-field="weight" aria-label="Weight for ${esc(ex.name)} in ${unit}" />
            <span class="ex-unit">${unit}</span>
          </div>
          ${history[ex.name.trim()] && history[ex.name.trim()].length >= 2 ? `<button class="icon-btn" data-action="show-progress" data-name="${esc(ex.name.trim())}" aria-label="View progress">📈</button>` : ''}
          <button class="icon-btn" data-action="delete-ex" data-date="${date}" data-id="${ex.id}" aria-label="Remove">✕</button>
        </div>`).join('');

    const chartData = state.selectedExercise ? history[state.selectedExercise] : [];
    const progressPanel = chartable.length === 0
      ? `<div class="empty-state">Log the same exercise with a weight on two or more days to see a progress graph here.</div>`
      : `
        <select class="exercise-select" data-action="select-exercise" aria-label="Select exercise">
          ${chartable.map(n => `<option value="${esc(n)}" ${n === state.selectedExercise ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <div style="margin-top:10px;">${lineChartSVG(chartData, unit)}</div>`;

    return `
      <div class="day-section">
        <div class="section-head accent-workout">
          <h2>🏋️ Workout</h2>
          <button class="unit-toggle" data-action="toggle-unit">weight in ${unit}</button>
        </div>
        ${done ? `<div class="done-pill" style="color:var(--tab-workout);border-color:var(--tab-workout);">✓ Plan done</div>` : ''}
        ${rows}
        <form class="mini-form-inline" data-action="add-ex" data-date="${date}">
          <input name="name" list="exercise-name-options" placeholder="Exercise name" aria-label="Exercise name for ${weekdayLong(date)}" autocomplete="off" />
          <datalist id="exercise-name-options">
            ${allExerciseNames(plan).map(n => `<option value="${esc(n)}"></option>`).join('')}
          </datalist>
          <input name="sets" type="number" min="0" placeholder="Sets" aria-label="Sets" />
          <input name="reps" type="number" min="0" placeholder="Reps" aria-label="Reps" />
          <input name="weight" type="number" min="0" step="0.5" placeholder="${unit}" aria-label="Weight" />
          <button type="submit">+ Add</button>
        </form>
        <div class="progress-panel">
          <div class="section-sub" style="margin-bottom:8px;">📈 WEIGHT PROGRESS</div>
          ${progressPanel}
        </div>
      </div>`;
  }

  /* ---------------- render: work ---------------- */
  function renderWorkForDay(date) {
    const today = todayISO();
    const monday = mondayOfWeek(date);
    const weekdays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
    const tracker = state.workTracker;
    const d = tracker[date] || { reading: 0, writing: 0 };
    const needsReading = d.reading < GOAL_MIN, needsWriting = d.writing < GOAL_MIN;
    const showReminder = date === today && isWeekday(date) && (needsReading || needsWriting);
    const complete = d.reading >= GOAL_MIN && d.writing >= GOAL_MIN;

    const weekReading = weekdays.reduce((s, dd) => s + (tracker[dd]?.reading || 0), 0);
    const weekWriting = weekdays.reduce((s, dd) => s + (tracker[dd]?.writing || 0), 0);

    const metricRow = (field, minutes, label, color) => {
      const pct = Math.min(100, (minutes / GOAL_MIN) * 100);
      return `
        <div class="metric-row">
          <div class="metric-label">${label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
          <input class="minutes-input" type="number" min="0" value="${minutes}" data-action="set-minutes" data-date="${date}" data-field="${field}" aria-label="${label} minutes" />
          <span class="metric-unit">m / ${GOAL_MIN}m</span>
          <div class="quick-add">
            <button data-action="quick-add" data-date="${date}" data-field="${field}" data-amount="15">+15</button>
            <button data-action="quick-add" data-date="${date}" data-field="${field}" data-amount="30">+30</button>
            <button data-action="quick-add" data-date="${date}" data-field="${field}" data-amount="-${minutes}">reset</button>
          </div>
        </div>`;
    };

    const chartData = weekdays.map(dd => ({ label: weekdayShort(dd), reading: tracker[dd]?.reading || 0, writing: tracker[dd]?.writing || 0 }));

    return `
      <div class="day-section">
        <div class="section-head accent-work"><h2>📖 Work</h2><div class="section-sub">Aim: 1hr reading + 1hr writing</div></div>
        ${showReminder ? `<div class="reminder-banner">🔥 Today's goal isn't done yet — ${needsReading ? `${GOAL_MIN - d.reading}m reading left` : ''}${needsReading && needsWriting ? ', ' : ''}${needsWriting ? `${GOAL_MIN - d.writing}m writing left` : ''}.</div>` : ''}
        ${complete ? `<div class="done-pill" style="color:var(--tab-work);border-color:var(--tab-work);">✓ Goal met</div>` : ''}
        ${metricRow('reading', d.reading, '📖 Reading', 'var(--tab-work)')}
        ${metricRow('writing', d.writing, '✍️ Writing', 'var(--tab-creative)')}
        <div class="stat-strip" style="margin-top:14px;">
          <div class="stat-chip"><span>READING THIS WEEK</span><span class="num">${Math.floor(weekReading / 60)}h ${weekReading % 60}m</span></div>
          <div class="stat-chip"><span>WRITING THIS WEEK</span><span class="num">${Math.floor(weekWriting / 60)}h ${weekWriting % 60}m</span></div>
        </div>
        <div style="margin-top:10px;">
          <div class="section-sub" style="margin-bottom:6px;">WEEKLY MINUTES</div>
          ${barChartSVG(chartData)}
        </div>
      </div>`;
  }

  /* ---------------- render: creative ---------------- */
  function renderCreativeForDay(date) {
    const log = state.creativeLog;
    const today = todayISO();
    const monday = mondayOfWeek(date);
    const allDates = Object.keys(log).sort((a, b) => b.localeCompare(a));
    const weekTotal = allDates.filter(dd => dd >= monday && dd <= addDays(monday, 6)).reduce((s, dd) => s + log[dd].reduce((s2, e) => s2 + e.duration, 0), 0);
    const allTimeTotal = allDates.reduce((s, dd) => s + log[dd].reduce((s2, e) => s2 + e.duration, 0), 0);
    const dayEntries = log[date] || [];
    const dayTotal = dayEntries.reduce((s, e) => s + e.duration, 0);

    const entries = dayEntries.length === 0
      ? `<div class="empty-state" style="padding:6px 2px;text-align:left;">No sessions logged for this day yet</div>`
      : dayEntries.map(entry => `
        <div class="log-entry">
          <div class="duration-badge">${entry.duration}m</div>
          <div class="body"><div class="practiced">${esc(entry.practiced)}</div></div>
          <button class="icon-btn" data-action="delete-session" data-date="${date}" data-id="${entry.id}" aria-label="Delete">✕</button>
        </div>`).join('');

    return `
      <div class="day-section">
        <div class="section-head accent-creative"><h2>🥁 Creative — Drumming</h2><div class="section-sub">${dayTotal}m logged this day</div></div>
        <div class="stat-strip">
          <div class="stat-chip"><span>THIS WEEK</span><span class="num">${Math.floor(weekTotal / 60)}h ${weekTotal % 60}m</span></div>
          <div class="stat-chip"><span>ALL TIME</span><span class="num">${Math.floor(allTimeTotal / 60)}h ${allTimeTotal % 60}m</span></div>
        </div>
        <form class="log-form" data-action="add-session">
          <input type="hidden" name="date" value="${date}" />
          <div class="field"><label for="drum-duration">Minutes</label><input id="drum-duration" name="duration" type="number" min="1" placeholder="45" style="width:80px;" /></div>
          <div class="field practiced-field"><label for="drum-practiced">What did you practice?</label><input id="drum-practiced" name="practiced" type="text" placeholder="Paradiddles, groove in 6/8, new fill..." /></div>
          <button type="submit" class="submit-btn">+ Log</button>
        </form>
        ${entries}
      </div>`;
  }

  /* ---------------- render: calendar ---------------- */
  function monthMatrix(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const prevDaysInMonth = new Date(y, m - 1, 0).getDate();
    const cells = [];
    for (let i = startDay - 1; i >= 0; i--) {
      cells.push({ date: isoDate(new Date(y, m - 2, prevDaysInMonth - i)), outside: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: isoDate(new Date(y, m - 1, d)), outside: false });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: addDays(cells[cells.length - 1].date, 1), outside: true });
    }
    return cells;
  }
  function monthLabel(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  function shiftMonth(yearMonth, delta) {
    let [y, m] = yearMonth.split('-').map(Number);
    m += delta;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  function dayHasWorkout(date) { return (state.workoutPlan[date] || []).length > 0; }
  function dayWorkMinutes(date) { return state.workTracker[date] || { reading: 0, writing: 0 }; }
  function dayHasWork(date) { const d = dayWorkMinutes(date); return d.reading > 0 || d.writing > 0; }
  function dayCreativeMinutes(date) { return (state.creativeLog[date] || []).reduce((s, e) => s + e.duration, 0); }

  /* ---------------- day strip + month picker ---------------- */
  function weekDaysFor(anchorMonday) { return Array.from({ length: 7 }, (_, i) => addDays(anchorMonday, i)); }

  function renderMonthPickerPopover() {
    const ym = state.popoverMonth;
    const cells = monthMatrix(ym);
    const today = todayISO();
    const weekdayHeaders = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<div class="cal-weekday">${w}</div>`).join('');
    const gridCells = cells.map(c => {
      const dayNum = parseInt(c.date.slice(8, 10), 10);
      const classes = ['cal-cell'];
      if (c.outside) classes.push('outside');
      if (c.date === today) classes.push('today');
      if (c.date === state.selectedDate) classes.push('selected');
      return `<button class="${classes.join(' ')}" data-action="pick-day" data-date="${c.date}" aria-label="${weekdayLong(c.date)}, ${monthDay(c.date)}"><span class="num">${dayNum}</span></button>`;
    }).join('');
    return `<div class="month-picker-popover">
      <div class="cal-nav">
        <button data-action="pop-prev" aria-label="Previous month">‹</button>
        <div class="cal-month-label">${monthLabel(ym)}</div>
        <button data-action="pop-next" aria-label="Next month">›</button>
      </div>
      <div class="cal-grid">${weekdayHeaders}${gridCells}</div>
    </div>`;
  }

  function renderDayStrip() {
    const days = weekDaysFor(state.weekAnchor);
    const today = todayISO();
    const pills = days.map(date => {
      const dots = [];
      if (dayHasWorkout(date)) dots.push(`<span style="background:var(--tab-workout)"></span>`);
      if (dayHasWork(date)) dots.push(`<span style="background:var(--tab-work)"></span>`);
      if (dayCreativeMinutes(date) > 0) dots.push(`<span style="background:var(--tab-creative)"></span>`);
      const classes = ['day-pill'];
      if (date === state.selectedDate) classes.push('selected');
      if (date === today) classes.push('today');
      return `<button class="${classes.join(' ')}" data-action="pick-day" data-date="${date}">
        <span class="wd">${weekdayShort(date)}</span>
        <span class="dn">${parseInt(date.slice(8, 10), 10)}</span>
        <span class="dots-mini">${dots.join('')}</span>
      </button>`;
    }).join('');

    document.getElementById('day-strip').innerHTML = `
      <div class="day-strip-head">
        <button data-action="day-prev" aria-label="Previous day">‹</button>
        <div class="day-strip-title" data-action="jump-today" style="cursor:pointer;">${weekdayLong(state.selectedDate)}, ${monthDay(state.selectedDate)}${state.selectedDate === today ? ' · Today' : ' · tap for today'}</div>
        <div style="display:flex;gap:2px;">
          <button data-action="toggle-month-picker" aria-label="Pick a date">🗓️</button>
          <button data-action="day-next" aria-label="Next day">›</button>
        </div>
      </div>
      <div class="day-strip-row">${pills}</div>
      ${state.showMonthPicker ? renderMonthPickerPopover() : ''}`;
  }

  function renderHeader() {
    document.getElementById('today-label').textContent = `${weekdayLong(todayISO())}, ${monthDay(todayISO())}`;
  }

  function renderPage() {
    const date = state.selectedDate;
    document.getElementById('page').innerHTML =
      renderWorkoutForDay(date) + renderWorkForDay(date) + renderCreativeForDay(date);
  }

  function render() {
    renderHeader();
    renderDayStrip();
    renderPage();
  }

  /* ---------------- event delegation: day strip ---------------- */
  document.getElementById('day-strip').addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (action === 'pick-day') {
      state.selectedDate = t.dataset.date;
      state.weekAnchor = mondayOfWeek(state.selectedDate);
      state.popoverMonth = state.selectedDate.slice(0, 7);
      state.showMonthPicker = false;
      render(); return;
    }
    if (action === 'jump-today') {
      const t = todayISO();
      state.selectedDate = t;
      state.weekAnchor = mondayOfWeek(t);
      state.popoverMonth = t.slice(0, 7);
      render(); return;
    }
    if (action === 'day-prev') {
      state.selectedDate = addDays(state.selectedDate, -1);
      state.weekAnchor = mondayOfWeek(state.selectedDate);
      state.popoverMonth = state.selectedDate.slice(0, 7);
      render(); return;
    }
    if (action === 'day-next') {
      state.selectedDate = addDays(state.selectedDate, 1);
      state.weekAnchor = mondayOfWeek(state.selectedDate);
      state.popoverMonth = state.selectedDate.slice(0, 7);
      render(); return;
    }
    if (action === 'toggle-month-picker') { state.showMonthPicker = !state.showMonthPicker; renderDayStrip(); return; }
    if (action === 'pop-prev') { state.popoverMonth = shiftMonth(state.popoverMonth, -1); renderDayStrip(); return; }
    if (action === 'pop-next') { state.popoverMonth = shiftMonth(state.popoverMonth, 1); renderDayStrip(); return; }
  });

  /* ---------------- event delegation: page ---------------- */

  document.getElementById('page').addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;

    if (action === 'toggle-ex') {
      const { date, id } = t.dataset;
      state.workoutPlan[date] = (state.workoutPlan[date] || []).map(ex => ex.id === id ? { ...ex, done: !ex.done } : ex);
      persist(); renderPage(); renderDayStrip(); return;
    }
    if (action === 'delete-ex') {
      const { date, id } = t.dataset;
      state.workoutPlan[date] = (state.workoutPlan[date] || []).filter(ex => ex.id !== id);
      persist(); renderPage(); renderDayStrip(); return;
    }
    if (action === 'show-progress') {
      state.selectedExercise = t.dataset.name;
      renderPage(); renderDayStrip(); return;
    }
    if (action === 'toggle-unit') {
      state.weightUnit = state.weightUnit === 'kg' ? 'lb' : 'kg';
      persist(); renderPage(); renderDayStrip(); return;
    }
    if (action === 'quick-add') {
      const { date, field } = t.dataset;
      const amount = parseFloat(t.dataset.amount);
      const day = state.workTracker[date] ? { ...state.workTracker[date] } : { reading: 0, writing: 0 };
      day[field] = Math.max(0, (day[field] || 0) + amount);
      state.workTracker[date] = day;
      persist(); renderPage(); renderDayStrip(); return;
    }
    if (action === 'delete-session') {
      const { date, id } = t.dataset;
      state.creativeLog[date] = (state.creativeLog[date] || []).filter(e => e.id !== id);
      if (state.creativeLog[date].length === 0) delete state.creativeLog[date];
      persist(); renderPage(); renderDayStrip(); return;
    }
  });

  document.getElementById('page').addEventListener('change', (e) => {
    if (e.target.matches('[data-action="select-exercise"]')) {
      state.selectedExercise = e.target.value;
      renderPage(); renderDayStrip();
      return;
    }
    if (e.target.matches('[data-action="set-ex-field"]')) {
      const { date, id, field } = e.target.dataset;
      const raw = e.target.value;
      let val = null;
      if (raw !== '') val = field === 'weight' ? parseFloat(raw) : parseInt(raw, 10);
      if (val != null && isNaN(val)) val = null;
      state.workoutPlan[date] = (state.workoutPlan[date] || []).map(ex =>
        ex.id === id ? { ...ex, [field]: val } : ex
      );
      persist(); renderPage(); renderDayStrip();
    }
  });

  document.getElementById('page').addEventListener('focusout', (e) => {
    if (e.target.matches('[data-action="set-minutes"]')) {
      const { date, field } = e.target.dataset;
      const v = parseInt(e.target.value, 10);
      const day = state.workTracker[date] ? { ...state.workTracker[date] } : { reading: 0, writing: 0 };
      day[field] = isNaN(v) || v < 0 ? 0 : v;
      state.workTracker[date] = day;
      persist(); renderPage(); renderDayStrip();
      return;
    }
    if (e.target.matches('.mini-form-inline input[name="name"]')) {
      const typed = e.target.value.trim();
      if (!typed) return;
      const last = findLastExerciseByName(typed);
      if (!last) return;
      const form = e.target.closest('form');
      const setsInput = form.querySelector('input[name="sets"]');
      const repsInput = form.querySelector('input[name="reps"]');
      const weightInput = form.querySelector('input[name="weight"]');
      if (setsInput && !setsInput.value && last.sets != null) setsInput.value = last.sets;
      if (repsInput && !repsInput.value && last.reps != null) repsInput.value = last.reps;
      if (weightInput && !weightInput.value && last.weight != null) weightInput.value = last.weight;
    }
  });

  document.getElementById('page').addEventListener('submit', (e) => {
    const form = e.target;
    const action = form.dataset.action;

    if (action === 'add-ex') {
      e.preventDefault();
      const date = form.dataset.date;
      const fd = new FormData(form);
      const name = (fd.get('name') || '').trim();
      if (!name) return;
      const ex = {
        id: makeId(), done: false, name,
        sets: fd.get('sets') ? parseInt(fd.get('sets'), 10) : null,
        reps: fd.get('reps') ? parseInt(fd.get('reps'), 10) : null,
        weight: fd.get('weight') ? parseFloat(fd.get('weight')) : null,
      };
      state.workoutPlan[date] = [...(state.workoutPlan[date] || []), ex];
      persist(); renderPage(); renderDayStrip(); return;
    }

    if (action === 'add-session') {
      e.preventDefault();
      const fd = new FormData(form);
      const date = fd.get('date') || todayISO();
      const duration = parseInt(fd.get('duration'), 10);
      const practiced = (fd.get('practiced') || '').trim();
      if (!duration || duration <= 0 || !practiced) return;
      const entry = { id: makeId(), duration, practiced, loggedAt: Date.now() };
      state.creativeLog[date] = [...(state.creativeLog[date] || []), entry];
      persist(); renderPage(); renderDayStrip(); return;
    }
  });

  document.getElementById('sync-badge').addEventListener('click', () => {
    if (!isFirebaseConfigured()) {
      alert('Sync isn\'t set up yet.\n\nOpen SYNC-SETUP.md (included in the app folder) for a 5-minute guide, then reload this page.');
      return;
    }
    const code = prompt(
      'Enter a private sync code.\nUse the exact same code on every device you want to keep in sync:',
      state.syncCode || ''
    );
    if (code && code.trim()) {
      startListening(code.trim());
      pushToCloud(true);
    }
  });

  render();
  initSync();
})();
