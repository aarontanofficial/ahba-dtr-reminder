(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const KEY_CHECKLIST = 'ahba-dtr-checklist-v1';
  const KEY_ENDPOINT = 'ahba-dtr-registered-endpoint';
  const KEY_TEST = 'ahba-dtr-last-test-ok';
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

  const $ = (id) => document.getElementById(id);
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const configured =
    !!CFG.FUNCTIONS_URL && !CFG.FUNCTIONS_URL.includes('YOUR_PROJECT_REF') &&
    !!CFG.VAPID_PUBLIC_KEY && !CFG.VAPID_PUBLIC_KEY.includes('PASTE_');

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
    try { localStorage.setItem(KEY_CHECKLIST, JSON.stringify(checked)); } catch (e) { /* storage full or blocked */ }
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
        checked[i] = input.checked;
        saveChecked();
        renderProgress();
      });
      const box = document.createElement('span');
      box.className = 'box';
      box.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = text;
      label.append(num, input, box, txt);
      // grid order: number, box (input is visually hidden), text
      li.appendChild(label);
      ol.appendChild(li);
    });
    renderProgress();
  }

  function renderProgress() {
    const done = checked.filter(Boolean).length;
    $('progress-text').textContent = done === STEPS.length
      ? `All ${STEPS.length} steps completed`
      : `${done} of ${STEPS.length} steps completed`;
    $('bar-fill').style.width = `${(done / STEPS.length) * 100}%`;
    $('bar').setAttribute('aria-valuenow', String(done));
  }

  $('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset the checklist? All steps will be unchecked.')) return;
    checked = STEPS.map(() => false);
    saveChecked();
    renderSteps();
  });

  /* ---------- Countdown (Asia/Manila) ---------- */
  function nextReminderMs(nowMs) {
    const shifted = nowMs + MANILA_OFFSET_MS;            // UTC getters now read Manila wall-clock
    const m = new Date(shifted);
    const daysAhead = (5 - m.getUTCDay() + 7) % 7;       // 5 = Friday
    let target = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate() + daysAhead, 7, 0, 0);
    if (target <= shifted) target += 7 * 24 * 60 * 60 * 1000;
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
    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
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
      'The background worker did not start. Close the app completely, reopen it, and try again. If it repeats, re-upload service-worker.js and the icons folder to GitHub.'
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

  /* ---------- UI helpers ---------- */
  function setMsg(text, kind) {
    const el = $('msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function busy(on) {
    $('enable-btn').disabled = on;
    $('test-btn').disabled = on;
  }

  async function renderStatus() {
    // Permission
    let perm = 'Not available on this device';
    if ('Notification' in window) {
      perm = { granted: 'Allowed', denied: 'Blocked in device settings', default: 'Not asked yet' }[Notification.permission];
    }
    $('st-permission').textContent = perm;

    // Install state
    $('st-install').textContent = isStandalone
      ? 'Installed and open'
      : (isIOS ? 'Not installed (required on iPhone)' : 'Running in browser');

    // Backend registration
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
    $('st-backend').textContent = backend;

    const lastTest = localStorage.getItem(KEY_TEST);
    $('st-test').textContent = lastTest
      ? `Accepted ${new Date(lastTest).toLocaleString()}`
      : 'None yet';

    // Summary line: never claims notifications work until a test has been accepted
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

  /* ---------- Actions ---------- */
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
        await sub.unsubscribe();            // old subscription made with a different VAPID key
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderStatus(); });
})();
