(() => {
  'use strict';

  const STORE_KEY = 'shellShiftDiary.v1';

  // UK National Minimum Wage / National Living Wage from 1 April 2026.
  const MIN_WAGE = {
    '21+': { rate: 12.71, label: '21 and over' },
    '18-20': { rate: 10.85, label: '18 to 20' },
    '16-17': { rate: 8.00, label: '16 to 17' },
    apprentice: { rate: 8.00, label: 'apprentice' },
  };

  // Holiday accrual for irregular-hours workers (UK, leave years from 1 April 2024).
  const HOLIDAY_ACCRUAL = 0.1207;

  const TYPE_LABELS = {
    normal: 'Normal', overtime: 'Overtime', sunday: 'Sunday', bankholiday: 'Bank hol', night: 'Night',
  };

  const DEFAULT_SETTINGS = {
    name: 'Michelle',
    ageBand: '21+',
    rate: 12.71,
    defaultBreak: 30,
    weekStart: 1,
    payFrequency: 'weekly',
    periodAnchor: '2026-01-05',
    multipliers: { normal: 1, overtime: 1, sunday: 1, bankholiday: 1, night: 1 },
    theme: 'auto',
  };

  // ---------- storage ----------
  let state = load();

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* ignore */ }
    return normalise(raw);
  }

  function normalise(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    settings.multipliers = Object.assign({}, DEFAULT_SETTINGS.multipliers, (raw.settings || {}).multipliers || {});
    return {
      settings,
      shifts: Array.isArray(raw.shifts) ? raw.shifts : [],
      checks: Array.isArray(raw.checks) ? raw.checks : [],
      active: raw.active || null,
    };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save on this device — download a backup!');
    }
  }

  // ---------- date helpers (dates are 'YYYY-MM-DD', handled as UTC day numbers) ----------
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  function toDayNum(str) {
    const [y, m, d] = str.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY);
  }
  function fromDayNum(n) {
    const d = new Date(n * DAY);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function dayOfWeek(n) { return (n + 4) % 7; } // 1970-01-01 was a Thursday; 0 = Sunday
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function nowTime() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function asDate(str) { return new Date(toDayNum(str) * DAY); }
  function fmtDate(str, opts) {
    return asDate(str).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts));
  }
  function fmtShortDate(str) { return fmtDate(str, { day: 'numeric', month: 'short' }); }

  function weekStartOf(dateStr) {
    const n = toDayNum(dateStr);
    const back = (dayOfWeek(n) - Number(state.settings.weekStart) + 7) % 7;
    return fromDayNum(n - back);
  }

  function periodFor(dateStr, offset = 0) {
    const s = state.settings;
    if (s.payFrequency === 'monthly') {
      const [y, m] = dateStr.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1 + offset, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
      const f = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      return { from: f(first), to: f(last) };
    }
    const len = { weekly: 7, fortnightly: 14, fourweekly: 28 }[s.payFrequency] || 7;
    const anchor = toDayNum(s.periodAnchor || DEFAULT_SETTINGS.periodAnchor);
    const idx = Math.floor((toDayNum(dateStr) - anchor) / len) + offset;
    const start = anchor + idx * len;
    return { from: fromDayNum(start), to: fromDayNum(start + len - 1) };
  }

  // ---------- money / time helpers ----------
  const gbp = (n) => '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtHours(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins - h * 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const decHours = (mins) => (Math.round((mins / 60) * 100) / 100).toString();
  function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

  function shiftMinutes(s) {
    const a = toMin(s.start);
    let b = toMin(s.end);
    if (b < a) b += 1440; // finished after midnight
    return Math.max(0, b - a - (Number(s.break) || 0));
  }
  function shiftPay(s) {
    return (shiftMinutes(s) / 60) * (Number(s.rate) || 0) * (Number(s.mult) || 1);
  }
  function totals(shifts) {
    let mins = 0, pay = 0;
    for (const s of shifts) { mins += shiftMinutes(s); pay += shiftPay(s); }
    return { mins, pay };
  }
  const shiftsBetween = (from, to) => state.shifts.filter((s) => s.date >= from && s.date <= to);
  const sortedShifts = () => [...state.shifts].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------- theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  // ---------- navigation ----------
  function showTab(name) {
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
    $$('.tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    window.scrollTo({ top: 0 });
    if (name === 'check' && !$('#check-form').from.value) fillPeriod(0);
  }

  // ---------- rendering ----------
  function shiftCard(s, withActions) {
    const mins = shiftMinutes(s);
    const dateN = toDayNum(s.date);
    const dow = asDate(s.date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const tag = s.type && s.type !== 'normal' ? `<span class="tag">${esc(TYPE_LABELS[s.type] || s.type)}${Number(s.mult) !== 1 ? ' ×' + esc(s.mult) : ''}</span>` : '';
    const meta = [`${gbp(Number(s.rate))}/hr`, s.break ? `${esc(s.break)}m break` : 'no break', s.note ? esc(s.note) : '']
      .filter(Boolean).join(' · ');
    return `
      <div class="shift" data-id="${esc(s.id)}">
        <div class="shift-date"><small>${esc(dow)}</small><b>${new Date(dateN * DAY).getUTCDate()}</b></div>
        <div class="shift-main">
          <div class="times">${esc(s.start)} – ${esc(s.end)}${tag}</div>
          <div class="meta">${meta}</div>
        </div>
        <div class="shift-right">
          <div class="pay">${gbp(shiftPay(s))}</div>
          <div class="hrs">${fmtHours(mins)}</div>
          ${withActions ? `<div class="shift-actions">
            <button class="icon-btn" data-edit="${esc(s.id)}" aria-label="Edit shift">✏️</button>
            <button class="icon-btn" data-delete="${esc(s.id)}" aria-label="Delete shift">🗑️</button>
          </div>` : ''}
        </div>
      </div>`;
  }

  function emptyState(msg) {
    return `<div class="card empty"><div class="big">🌷</div><p>${msg}</p>
      <button class="btn btn-small" data-action="add-shift">＋ Add your first shift</button></div>`;
  }

  function renderHome() {
    const s = state.settings;
    $('#hello-name').textContent = s.name || 'gorgeous';
    $('#today-label').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    const today = todayStr();
    const wk = weekStartOf(today);
    const wkT = totals(shiftsBetween(wk, fromDayNum(toDayNum(wk) + 6)));
    $('#stat-week-hours').textContent = fmtHours(wkT.mins);
    $('#stat-week-pay').textContent = gbp(wkT.pay);

    const p = periodFor(today);
    const pT = totals(shiftsBetween(p.from, p.to));
    $('#stat-period-label').textContent = `Pay period ${fmtShortDate(p.from)} – ${fmtShortDate(p.to)}`;
    $('#stat-period-hours').textContent = fmtHours(pT.mins);
    $('#stat-period-pay').textContent = gbp(pT.pay);

    const all = totals(state.shifts);
    $('#stat-all-hours').textContent = fmtHours(all.mins);
    $('#stat-all-pay').textContent = gbp(all.pay);
    $('#stat-holiday').textContent = fmtHours(all.mins * HOLIDAY_ACCRUAL);

    const mw = MIN_WAGE[s.ageBand] || MIN_WAGE['21+'];
    const rate = Number(s.rate) || 0;
    const wc = $('#wage-check');
    if (rate + 1e-9 >= mw.rate) {
      wc.className = 'card wage-check is-good';
      wc.innerHTML = `<div class="notice"><span class="emoji">👑</span><div><strong>Your rate is legal, queen</strong>
        <p class="small">${gbp(rate)}/hr is at or above the ${gbp(mw.rate)} minimum for ${esc(mw.label)}.</p></div></div>`;
    } else {
      wc.className = 'card wage-check is-bad';
      wc.innerHTML = `<div class="notice"><span class="emoji">🚨</span><div><strong>That's below minimum wage!</strong>
        <p class="small">${gbp(rate)}/hr is under the ${gbp(mw.rate)} legal minimum for ${esc(mw.label)}. Double-check your rate in Settings — if it's right, speak to payroll.</p></div></div>`;
    }

    const recent = sortedShifts().slice(0, 4);
    $('#recent-list').innerHTML = recent.length
      ? recent.map((x) => shiftCard(x, true)).join('')
      : emptyState('No shifts yet. Clock in or add one to start tracking 💕');

    renderClock();
  }

  function renderShifts() {
    const list = sortedShifts();
    if (!list.length) {
      $('#weeks-list').innerHTML = emptyState('Your shifts will show up here, grouped by week.');
      return;
    }
    const groups = new Map();
    for (const s of list) {
      const k = weekStartOf(s.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    let html = '';
    for (const [wk, shifts] of groups) {
      const t = totals(shifts);
      const end = fromDayNum(toDayNum(wk) + 6);
      html += `<div class="week">
        <div class="week-head"><h3>${fmtShortDate(wk)} – ${fmtShortDate(end)}</h3><span>${fmtHours(t.mins)} · ${gbp(t.pay)}</span></div>
        <div class="shift-list">${shifts.map((s) => shiftCard(s, true)).join('')}</div>
      </div>`;
    }
    $('#weeks-list').innerHTML = html;
  }

  function renderSettings() {
    const f = $('#settings-form');
    const s = state.settings;
    f.name.value = s.name;
    f.ageBand.value = s.ageBand;
    f.rate.value = s.rate;
    f.defaultBreak.value = s.defaultBreak;
    f.weekStart.value = String(s.weekStart);
    f.payFrequency.value = s.payFrequency;
    f.periodAnchor.value = s.periodAnchor;
    f.periodAnchor.closest('label').classList.toggle('hidden', s.payFrequency === 'monthly');
    for (const k of ['overtime', 'sunday', 'bankholiday', 'night']) f['mult_' + k].value = s.multipliers[k];
    f.theme.value = s.theme;
  }

  function renderChecks() {
    const box = $('#check-history');
    if (!state.checks.length) {
      box.innerHTML = '<p class="muted small center">Nothing checked yet.</p>';
      return;
    }
    box.innerHTML = state.checks.slice().reverse().map((c) => {
      const cls = c.diff > 0.5 ? 'is-bad' : c.diff < -0.5 ? 'is-warn' : 'is-good';
      const emoji = c.diff > 0.5 ? '😤' : c.diff < -0.5 ? '🤔' : '💅';
      const txt = c.diff > 0.5 ? `Short by ${gbp(c.diff)}` : c.diff < -0.5 ? `Paid ${gbp(-c.diff)} extra` : 'All correct';
      return `<div class="card ${cls}"><div class="notice"><span class="emoji">${emoji}</span><div class="grow">
        <strong>${txt}</strong>
        <p class="small">${fmtShortDate(c.from)} – ${fmtShortDate(c.to)} · logged ${gbp(c.expected)}, paid ${gbp(c.paidPay)}</p></div>
        <button class="icon-btn" data-del-check="${esc(c.id)}" aria-label="Remove check">✖️</button></div></div>`;
    }).join('');
  }

  function renderAll() {
    applyTheme();
    renderHome();
    renderShifts();
    renderSettings();
    renderChecks();
  }

  // ---------- clock in / out ----------
  let timerHandle = null;
  function renderClock() {
    const a = state.active;
    $('#clock-idle').classList.toggle('hidden', !!a);
    $('#clock-active').classList.toggle('hidden', !a);
    clearInterval(timerHandle);
    if (!a) return;
    $('#clock-since').textContent = `${a.start}${a.date !== todayStr() ? ' (' + fmtShortDate(a.date) + ')' : ''}`;
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - a.ts) / 1000));
      $('#clock-timer').textContent = `${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
    };
    tick();
    timerHandle = setInterval(tick, 1000);
  }

  // ---------- shift dialog ----------
  const dialog = $('#shift-dialog');
  const sform = $('#shift-form');
  let fromClock = false;

  function openShift(shift, opts = {}) {
    fromClock = !!opts.fromClock;
    const s = state.settings;
    const isEdit = !!(shift && shift.id);
    $('#shift-dialog-title').textContent = isEdit ? 'Edit shift ✏️' : fromClock ? 'Nice work! 🎉' : 'New shift ✨';
    sform.id.value = isEdit ? shift.id : '';
    sform.date.value = (shift && shift.date) || todayStr();
    sform.start.value = (shift && shift.start) || '09:00';
    sform.end.value = (shift && shift.end) || '17:00';
    sform.break.value = shift && shift.break != null ? shift.break : s.defaultBreak;
    sform.type.value = (shift && shift.type) || 'normal';
    sform.rate.value = shift && shift.rate != null ? shift.rate : s.rate;
    sform.note.value = (shift && shift.note) || '';
    updatePreview();
    dialog.showModal();
  }

  function readShiftForm() {
    const type = sform.type.value;
    const existing = state.shifts.find((x) => x.id === sform.id.value);
    // Keep a shift's saved multiplier when editing unless its type changes.
    const mult = existing && existing.type === type ? existing.mult : (state.settings.multipliers[type] ?? 1);
    return {
      id: sform.id.value || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      date: sform.date.value,
      start: sform.start.value,
      end: sform.end.value,
      break: Math.max(0, parseInt(sform.break.value, 10) || 0),
      type,
      mult: Number(mult) || 1,
      rate: Number(sform.rate.value) || 0,
      note: sform.note.value.trim(),
    };
  }

  function updatePreview() {
    if (!sform.start.value || !sform.end.value) { $('#shift-preview').textContent = ''; return; }
    const s = readShiftForm();
    const overnight = toMin(s.end) < toMin(s.start) ? ' 🌙 (finishes next day)' : '';
    $('#shift-preview').textContent = `${fmtHours(shiftMinutes(s))} paid · ${gbp(shiftPay(s))}${overnight}`;
  }

  sform.addEventListener('input', updatePreview);
  sform.addEventListener('change', updatePreview);
  $('#btn-shift-cancel').addEventListener('click', () => dialog.close());

  sform.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sform.reportValidity()) return;
    const shift = readShiftForm();
    const i = state.shifts.findIndex((x) => x.id === shift.id);
    if (i >= 0) state.shifts[i] = shift; else state.shifts.push(shift);
    if (fromClock) state.active = null;
    save();
    dialog.close();
    renderAll();
    sparkle();
    toast(i >= 0 ? 'Shift updated 💖' : `Saved! ${fmtHours(shiftMinutes(shift))} = ${gbp(shiftPay(shift))} 💸`);
  });

  // ---------- payslip check ----------
  const cform = $('#check-form');
  function fillPeriod(offset) {
    const p = periodFor(todayStr(), offset);
    cform.from.value = p.from;
    cform.to.value = p.to;
  }
  $('#btn-period-current').addEventListener('click', () => fillPeriod(0));
  $('#btn-period-last').addEventListener('click', () => fillPeriod(-1));
  $('#btn-period-before').addEventListener('click', () => fillPeriod(-2));

  cform.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = cform.from.value, to = cform.to.value;
    if (from > to) { toast('"From" needs to be before "To" 💭'); return; }
    const shifts = shiftsBetween(from, to);
    const t = totals(shifts);
    const paidHours = cform.paidHours.value === '' ? null : Number(cform.paidHours.value);
    const paidPay = Number(cform.paidPay.value) || 0;
    const diff = t.pay - paidPay;
    const check = {
      id: Date.now().toString(36), from, to, shiftCount: shifts.length,
      loggedMins: t.mins, expected: t.pay, paidHours, paidPay, diff, at: new Date().toISOString(),
    };
    state.checks.push(check);
    if (state.checks.length > 50) state.checks = state.checks.slice(-50);
    save();
    renderChecks();
    renderCheckResult(check);
  });

  function renderCheckResult(c) {
    const mw = MIN_WAGE[state.settings.ageBand] || MIN_WAGE['21+'];
    let cls, emoji, title, body;
    if (c.diff > 0.5) {
      cls = 'is-bad'; emoji = '😤'; title = "You've been underpaid!";
      body = `Based on your logged shifts you should have got <b>${gbp(c.expected)}</b> but were paid <b>${gbp(c.paidPay)}</b>. Take this to your manager or payroll — you've earned it.`;
    } else if (c.diff < -0.5) {
      cls = 'is-warn'; emoji = '🤔'; title = 'Paid more than you logged';
      body = `Could be holiday pay, a bonus, back pay, or a shift you forgot to log. Worth a quick look.`;
    } else {
      cls = 'is-good'; emoji = '💅'; title = 'Paid correctly — slay!';
      body = `Your payslip matches your logged shifts.`;
    }
    const hoursRow = c.paidHours != null
      ? `<tr><td>Hours</td><td>${decHours(c.loggedMins)}</td><td>${c.paidHours}</td><td>${(Math.round((c.loggedMins / 60 - c.paidHours) * 100) / 100)}</td></tr>`
      : '';
    let rateNote = '';
    if (c.paidHours) {
      const eff = c.paidPay / c.paidHours;
      if (eff + 0.005 < mw.rate) {
        rateNote = `<p class="small"><strong>⚠️ ${gbp(eff)}/hr effective rate</strong> — that's below the ${gbp(mw.rate)} minimum wage for ${esc(mw.label)}.</p>`;
      }
    }
    $('#check-result').innerHTML = `
      <div class="card ${cls}">
        <div class="notice"><span class="emoji">${emoji}</span><div><strong>${title}</strong><p class="small">${body}</p></div></div>
        ${c.diff > 0.5 ? `<p class="big-diff">${gbp(c.diff)}</p>` : ''}
        <table class="result-table">
          <tr><th></th><th>Logged</th><th>Payslip</th><th>Difference</th></tr>
          ${hoursRow}
          <tr><td>Pay</td><td>${gbp(c.expected)}</td><td>${gbp(c.paidPay)}</td><td>${gbp(c.diff)}</td></tr>
        </table>
        ${rateNote}
        <p class="small muted">${c.shiftCount} shift${c.shiftCount === 1 ? '' : 's'} logged ${fmtShortDate(c.from)} – ${fmtShortDate(c.to)}. Compare against basic pay before tax, NI and pension come off.</p>
      </div>`;
    if (c.diff <= 0.5 && c.diff >= -0.5) sparkle();
    $('#check-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- settings ----------
  const setForm = $('#settings-form');
  setForm.payFrequency.addEventListener('change', () => {
    setForm.periodAnchor.closest('label').classList.toggle('hidden', setForm.payFrequency.value === 'monthly');
  });
  setForm.ageBand.addEventListener('change', () => {
    const mw = MIN_WAGE[setForm.ageBand.value];
    if (mw && Number(setForm.rate.value) < mw.rate) setForm.rate.value = mw.rate.toFixed(2);
  });
  setForm.theme.addEventListener('change', () => {
    state.settings.theme = setForm.theme.value;
    applyTheme();
  });
  setForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = setForm;
    const num = (v, d) => (v === '' || isNaN(Number(v)) ? d : Number(v));
    state.settings = {
      name: f.name.value.trim(),
      ageBand: f.ageBand.value,
      rate: num(f.rate.value, DEFAULT_SETTINGS.rate),
      defaultBreak: Math.max(0, parseInt(f.defaultBreak.value, 10) || 0),
      weekStart: Number(f.weekStart.value),
      payFrequency: f.payFrequency.value,
      periodAnchor: f.periodAnchor.value || DEFAULT_SETTINGS.periodAnchor,
      multipliers: {
        normal: 1,
        overtime: num(f.mult_overtime.value, 1),
        sunday: num(f.mult_sunday.value, 1),
        bankholiday: num(f.mult_bankholiday.value, 1),
        night: num(f.mult_night.value, 1),
      },
      theme: f.theme.value,
    };
    save();
    renderAll();
    sparkle();
    toast('Settings saved 🌸');
  });

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  $('#btn-backup').addEventListener('click', () => {
    download(`shift-diary-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
    toast('Backup downloaded 💾');
  });

  $('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.shifts)) throw new Error('bad file');
      if (!confirm(`Restore ${data.shifts.length} shifts from this backup? This replaces what's on this phone.`)) return;
      state = normalise(data);
      save();
      renderAll();
      toast('Backup restored ✨');
    } catch (err) {
      toast("Hmm, that doesn't look like a Shift Diary backup");
    }
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('Delete ALL shifts, checks and settings? Download a backup first if you might need them.')) return;
    state = normalise(null);
    save();
    renderAll();
    toast('All cleared');
  });

  $('#btn-export-csv').addEventListener('click', () => {
    const rows = [['Date', 'Day', 'Start', 'Finish', 'Unpaid break (mins)', 'Paid hours', 'Type', 'Multiplier', 'Hourly rate (£)', 'Pay (£)', 'Notes']];
    for (const s of [...state.shifts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))) {
      rows.push([
        s.date, fmtDate(s.date, { weekday: 'long' }), s.start, s.end, s.break,
        decHours(shiftMinutes(s)), TYPE_LABELS[s.type] || s.type, s.mult, Number(s.rate).toFixed(2),
        shiftPay(s).toFixed(2), s.note || '',
      ]);
    }
    const csv = rows.map((r) => r.map((v) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')).join('\r\n');
    download(`my-shifts-${todayStr()}.csv`, '﻿' + csv, 'text/csv');
    toast('Spreadsheet downloaded 📊');
  });

  // ---------- global clicks ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-action]');
    if (!t) return;
    if (t.dataset.tab) return showTab(t.dataset.tab);
    if (t.dataset.action === 'add-shift') return openShift(null);
    if (t.dataset.edit) return openShift(state.shifts.find((s) => s.id === t.dataset.edit));
    if (t.dataset.delete) {
      const s = state.shifts.find((x) => x.id === t.dataset.delete);
      if (s && confirm(`Delete the ${fmtShortDate(s.date)} shift (${s.start}–${s.end})?`)) {
        state.shifts = state.shifts.filter((x) => x.id !== s.id);
        save();
        renderAll();
        toast('Shift deleted');
      }
      return;
    }
    if (t.dataset.delCheck) {
      state.checks = state.checks.filter((c) => c.id !== t.dataset.delCheck);
      save();
      renderChecks();
    }
  });

  $('#btn-clock-in').addEventListener('click', () => {
    state.active = { date: todayStr(), start: nowTime(), ts: Date.now() };
    save();
    renderClock();
    sparkle();
    toast(`Clocked in at ${state.active.start} — have a fab shift! 💕`);
  });
  $('#btn-clock-out').addEventListener('click', () => {
    const a = state.active;
    if (!a) return;
    openShift({ date: a.date, start: a.start, end: nowTime() }, { fromClock: true });
  });
  $('#btn-clock-cancel').addEventListener('click', () => {
    if (!confirm('Cancel this clock-in? The timer will be thrown away.')) return;
    state.active = null;
    save();
    renderClock();
  });

  // ---------- fun bits ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const SPARKS = ['✨', '💖', '🌸', '💕', '⭐', '🎀', '💗'];
  function sparkle() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = $('#sparkles');
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('span');
      el.className = 'sparkle';
      el.textContent = SPARKS[i % SPARKS.length];
      const ang = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
      const dist = 90 + Math.random() * 120;
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      el.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      el.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      el.style.setProperty('--rot', (Math.random() * 360 - 180) + 'deg');
      box.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }
  }

  // Refresh "today" figures when the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderHome(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderAll();
})();
