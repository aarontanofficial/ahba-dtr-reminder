(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const KEY_CHECKLIST = 'ahba-dtr-checklist-v1';
  const KEY_HISTORY = 'ahba-dtr-history-v1';
  const KEY_ENDPOINT = 'ahba-dtr-registered-endpoint';
  const KEY_TEST = 'ahba-dtr-last-test-ok';
  const DAY = 24 * 60 * 60 * 1000;
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila is UTC+8, no DST

  const STEPS = [
    'Go to the front for DTR processing.',
    'Use the 1020 PC at Kuya Dey\u2019s station.',
    'Connect to Ahba dev Gate Wi-Fi.',
    'Open ZKBio CVAccess and log in using the authorized admin account.',
    'Open the three-dot menu \u2192 Attendance \u2192 Manual Attendance Calculation.',
    'Select all personnel IDs.',
    'Click Attendance Calculation.',
    'Set the correct Start Time and End Time.',
    'Open Daily Attendance Details.',
    'Set the Time From\u2013To range.',
    'Export the attendance report.'
  ];
  const CHEERS = [
    'Ready when you are.', 'Nice start.', 'Keep going.', 'Getting warmed up.', 'Looking good.',
    'Almost halfway.', 'Halfway there!', 'Over the hump.', 'Three steps left.', 'Two steps left.',
    'One step left!', 'Quest complete!'
  ];
  const RANKS = [[0, 'Newcomer'], [1, 'Extractor'], [4, 'DTR Pro'], [12, 'Attendance Master'], [26, 'Legend']];

  const $ = (id) => document.getElementById(id);
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const configured =
    !!CFG.FUNCTIONS_URL && !CFG.FUNCTIONS_URL.includes('YOUR_PROJECT_REF') &&
    !!CFG.VAPID_PUBLIC_KEY && !CFG.VAPID_PUBLIC_KEY.includes('PASTE_');

  /* ---------- Weekly record (streak, rank) ---------- */
  function weekIndex(nowMs = Date.now()) {
    const d = Math.floor((nowMs + MANILA_OFFSET_MS) / DAY); // days since 1970-01-01 (a Thursday)
    return Math.floor((d + 3) / 7);                          // Monday-start weeks, Manila time
  }
  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(KEY_HISTORY));
      if (Array.isArray(h)) return h.filter(Number.isInteger).sort((a, b) => a - b);
    } catch (e) { /* ignore */ }
    return [];
  }
  function saveHistory(h) {
    try { localStorage.setItem(KEY_HISTORY, JSON.stringify(h)); } catch (e) { /* ignore */ }
  }
  function streakOf(h) {
    if (!h.length) return 0;
    if (h[h.length - 1] < weekIndex() - 1) return 0;          // missed a full week
    let n = 1;
    for (let i = h.length - 1; i > 0 && h[i] - h[i - 1] === 1; i--) n++;
    return n;
  }
  function rankOf(total) {
    let idx = 0;
    RANKS.forEach((r, i) => { if (total >= r[0]) idx = i; });
    const next = RANKS[idx + 1];
    return { name: RANKS[idx][1], toNext: next ? next[0] - total : 0, nextName: next ? next[1] : null };
  }
  function renderStats() {
    const h = loadHistory();
    const total = h.length;
    const rank = rankOf(total);
    $('st-streak').textContent = streakOf(h);
    $('st-total').textContent = total;
    $('st-rank').textContent = rank.name;
    $('st-next').textContent = rank.nextName
      ? `${rank.toNext} more week${rank.toNext === 1 ? '' : 's'} to ${rank.nextName}`
      : 'Top rank reached';
  }

  /* ---------- Checklist ---------- */
  let checked = loadChecked();

  function loadChecked() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_CHECKLIST));
      if (Array.isArray(raw) && raw.length === STEPS.length) return raw.map(Boolean);
    } catch (e) { /* ignore */ }
    return STEPS.map(() => false);
  }
  function saveChecked() {
    try { localStorage.setItem(KEY_CHECKLIST, JSON.stringify(checked)); } catch (e) { /* ignore */ }
  }

  function renderSteps() {
    const ol = $('steps');
    ol.innerHTML = '';
    STEPS.forEach((text, i) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked[i];
      input.addEventListener('change', () => {
        const wasComplete = checked.every(Boolean);
        checked[i] = input.checked;
        saveChecked();
        renderProgress();
        label.classList.remove('flip');
        if (input.checked) { void label.offsetWidth; label.classList.add('flip'); }
        if (!wasComplete && checked.every(Boolean)) completeWeek();
      });
      const box = document.createElement('span');
      box.className = 'box';
      box.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = text;
      label.append(num, input, box, txt);
      li.appendChild(label);
      ol.appendChild(li);
    });
    renderProgress();
  }

  function renderProgress() {
    const done = checked.filter(Boolean).length;
    const all = done === STEPS.length;
    $('progress-text').textContent = all
      ? `All ${STEPS.length} steps completed`
      : `${done} of ${STEPS.length} steps completed`;
    $('cheer').textContent = CHEERS[done];
    $('bar-fill').style.width = `${(done / STEPS.length) * 100}%`;
    $('bar').setAttribute('aria-valuenow', String(done));
    $('bar').classList.toggle('complete', all);
    $('quest').hidden = !all;
    if (all) {
      const streak = streakOf(loadHistory());
      $('quest-sub').textContent = streak > 1 ? `${streak} weeks in a row. Great work.` : 'Great work this week.';
    }
  }

  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset the checklist? All steps will be unchecked. Your streak is kept.')) return;
    checked = STEPS.map(() => false);
    saveChecked();
    renderSteps();
  });

  /* ---------- Reward (game moment) ---------- */
  let lastFocus = null;

  function completeWeek() {
    const h = loadHistory();
    const wk = weekIndex();
    const rankBefore = rankOf(h.length).name;
    let isNew = false;
    if (!h.includes(wk)) {
      h.push(wk);
      h.sort((a, b) => a - b);
      saveHistory(h);
      isNew = true;
    }
    const rankAfter = rankOf(h.length).name;
    renderStats();
    renderProgress();
    openReward(isNew, isNew && rankAfter !== rankBefore ? rankAfter : '');
  }

  function openReward(isNew, newRank) {
    const h = loadHistory();
    $('rw-streak').textContent = streakOf(h);
    $('rw-total').textContent = h.length;
    $('rw-rank').textContent = rankOf(h.length).name;
    $('reward-text').textContent = isNew
      ? 'You\u2019ve completed your weekly DTR extraction. Great work!'
      : 'This week is already counted in your record.';
    $('reward-extra').textContent = newRank ? `New rank unlocked: ${newRank}` : '';
    lastFocus = document.activeElement;
    $('reward').hidden = false;
    document.body.classList.add('modal-open');
    $('reward-close').focus();
    if (isNew) {
      fireConfetti();
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    }
  }

  function closeReward() {
    $('reward').hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $('reward-close').addEventListener('click', closeReward);
  $('reward-open').addEventListener('click', () => openReward(false, ''));
  $('reward').addEventListener('click', (e) => { if (e.target === $('reward')) closeReward(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('reward').hidden) closeReward(); });

  function fireConfetti() {
    if (reduceMotion) return;
    const c = $('confetti');
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = (c.width = Math.floor(window.innerWidth * dpr));
    const h = (c.height = Math.floor(window.innerHeight * dpr));
    const colors = ['#D4AF37', '#EBCB6E', '#F0ECE0', '#7FD1A0', '#FFF3C4'];
    const parts = Array.from({ length: 150 }, () => ({
      x: Math.random() * w, y: -Math.random() * h * 0.6,
      s: (5 + Math.random() * 7) * dpr,
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0]
    }));
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.rot += p.vr;
        if (p.y < h + 20 * dpr) alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (alive && now - start < 6000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    })(start);
  }

  /* ---------- 3D tilt ---------- */
  function enableTilt(el, max) {
    if (!el || reduceMotion) return;
    const set = (rx, ry, gx, gy, glare) => {
      el.style.setProperty('--rx', rx + 'deg');
      el.style.setProperty('--ry', ry + 'deg');
      el.style.setProperty('--gx', gx + '%');
      el.style.setProperty('--gy', gy + '%');
      el.style.setProperty('--glare', glare);
    };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      set((-py * max).toFixed(2), (px * max * 1.4).toFixed(2), (px * 100 + 50).toFixed(0), (py * 100 + 50).toFixed(0), 1);
    };
    const reset = () => set(0, 0, 50, 0, 0);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', reset);
    el.addEventListener('pointercancel', reset);
    el.addEventListener('pointerleave', reset);
  }
  document.querySelectorAll('.tilt').forEach((el) => enableTilt(el, el.classList.contains('hero') ? 12 : 7));

  /* ---------- Countdown (Asia/Manila) ---------- */
  function nextReminderMs(nowMs) {
    const shifted = nowMs + MANILA_OFFSET_MS;
    const m = new Date(shifted);
    const daysAhead = (5 - m.getUTCDay() + 7) % 7;       // 5 = Friday
    let target = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate() + daysAhead, 7, 0, 0);
    if (target <= shifted) target += 7 * DAY;
    return target - MANILA_OFFSET_MS;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const whenFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  function tick() {
    const now = Date.now();
    const target = nextReminderMs(now);
    let s = Math.max(0, Math.floor((target - now) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const mi = Math.floor(s / 60); s -= mi * 60;
    $('cd-d').textContent = d;
    $('cd-h').textContent = pad(h);
    $('cd-m').textContent = pad(mi);
    $('cd-s').textContent = pad(s);
    $('next-when').textContent = `${whenFmt.format(new Date(target))} (Philippine time)`;
  }

  /* ---------- Push helpers ---------- */
  function b64ToBytes(b64url) {
    const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  function bytesToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function getReadyRegistration() {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register('./service-worker.js');
    return withTimeout(
      navigator.serviceWorker.ready, 10000,
      'The background worker did not start. Close the app completely, reopen it, and try again. If it repeats, re-upload service-worker.js and the icon files to GitHub.'
    );
  }

  async function callBackend(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(CFG.FUNCTIONS_URL.replace(/\/$/, '') + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError'
        ? 'The server did not answer in time. Check your internet and try again.'
        : 'Could not reach the server. Check FUNCTIONS_URL in config.js and that the subscribe function is deployed.');
    } finally {
      clearTimeout(timer);
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON response */ }
    if (!res.ok || data.ok === false) throw new Error(data.error || `Server error (${res.status}).`);
    return data;
  }

  async function currentSubscription() {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  /* ---------- Notification UI ---------- */
  function setMsg(text, kind) {
    const el = $('msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function busy(on) {
    $('enable-btn').disabled = on;
    $('test-btn').disabled = on;
  }
  function put(id, text, state) {
    const el = $(id);
    el.textContent = text;
    el.dataset.state = state || '';
  }

  async function renderStatus() {
    let perm = 'Not available on this device';
    if ('Notification' in window) {
      perm = { granted: 'Allowed', denied: 'Blocked in device settings', default: 'Not asked yet' }[Notification.permission];
    }
    put('st-permission', perm, !('Notification' in window) ? 'bad' : { granted: 'ok', denied: 'bad', default: 'warn' }[Notification.permission]);

    put('st-install',
      isStandalone ? 'Installed and open' : (isIOS ? 'Not installed (required on iPhone)' : 'Running in browser'),
      isStandalone ? 'ok' : (isIOS ? 'bad' : 'warn'));

    let backend;
    let registered = false;
    if (!configured) {
      backend = 'Not configured (edit config.js)';
    } else if (!pushSupported) {
      backend = 'Push not supported here';
    } else {
      const sub = await currentSubscription();
      registered = !!sub && localStorage.getItem(KEY_ENDPOINT) === sub.endpoint;
      backend = registered ? 'Registered with backend' : 'Not registered yet';
    }
    put('st-backend', backend, registered ? 'ok' : (!configured ? 'bad' : 'warn'));

    const lastTest = localStorage.getItem(KEY_TEST);
    put('st-test', lastTest ? `Accepted ${new Date(lastTest).toLocaleString()}` : 'None yet', lastTest ? 'ok' : '');

    // Never claims notifications work until a test has been accepted
    let summary;
    if (!configured) summary = 'Backend not configured yet. Notifications are not set up.';
    else if (isIOS && !isStandalone) summary = 'Add this app to your Home Screen, then open it from there.';
    else if (!pushSupported) summary = 'This browser cannot receive push notifications.';
    else if (Notification.permission === 'denied') summary = 'Notifications are blocked. Allow them in your device settings.';
    else if (!registered) summary = 'Tap Enable notifications to register this device.';
    else if (!lastTest) summary = 'Registered. Send a test notification to confirm delivery.';
    else summary = 'Registered. The last test was accepted by the push service.';
    $('setup-summary').textContent = summary;
  }

  async function enableNotifications() {
    setMsg('');
    if (!configured) return setMsg('Add your Supabase function URL and VAPID public key to config.js first.', 'error');
    if (!pushSupported) {
      return setMsg(isIOS && !isStandalone
        ? 'On iPhone, tap Share, then Add to Home Screen, and open the app from there.'
        : 'This browser does not support push notifications.', 'error');
    }
    busy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permission was not granted. Allow notifications for this app in your device settings.');
      const reg = await getReadyRegistration();
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options && sub.options.applicationServerKey &&
          bytesToB64url(sub.options.applicationServerKey) !== CFG.VAPID_PUBLIC_KEY) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) {
        sub = await withTimeout(reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToBytes(CFG.VAPID_PUBLIC_KEY)
        }), 15000, 'The phone did not complete the push registration. Check the VAPID public key in config.js.');
      }
      await callBackend({ action: 'subscribe', subscription: sub.toJSON() });
      localStorage.setItem(KEY_ENDPOINT, sub.endpoint);
      setMsg('This device is registered. Send a test notification to confirm delivery.', 'ok');
    } catch (e) {
      setMsg(e.message || 'Could not enable notifications.', 'error');
    } finally {
      busy(false);
      renderStatus();
    }
  }

  async function sendTest() {
    setMsg('');
    if (!configured) return setMsg('Add your Supabase function URL and VAPID public key to config.js first.', 'error');
    busy(true);
    try {
      const sub = await currentSubscription();
      if (!sub) throw new Error('This device is not registered. Tap Enable notifications first.');
      await callBackend({ action: 'test', endpoint: sub.endpoint });
      localStorage.setItem(KEY_TEST, new Date().toISOString());
      setMsg('The push service accepted the test. It should appear within a few seconds. If it does not, check your device notification settings.', 'ok');
    } catch (e) {
      setMsg(e.message || 'Test failed.', 'error');
    } finally {
      busy(false);
      renderStatus();
    }
  }

  $('enable-btn').addEventListener('click', enableNotifications);
  $('test-btn').addEventListener('click', sendTest);

  /* ---------- Start ---------- */
  renderSteps();
  renderStats();
  tick();
  setInterval(tick, 1000);
  renderStatus();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').then(renderStatus).catch(() => {
        setMsg('Could not start the offline and notification worker. Open this app over HTTPS.', 'error');
      });
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderStatus(); renderStats(); } });
})();
