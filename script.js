/* RoboControl – Final 6
   Plain JavaScript. Talks to an ESP32 over HTTP (see README.md for the endpoints),
   or runs in Simulation mode when no robot is available. */
(() => {
  'use strict';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- persistent settings ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rc6_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('rc6_' + k, JSON.stringify(v)); } catch { /* storage blocked */ } }
  };

  const S = {
    connected: false, connecting: false, mode: 'wifi',
    ip: store.get('ip', '192.168.4.1'),
    ssid: store.get('ssid', 'RoboESP32'),
    camUrl: store.get('camUrl', ''),
    safe: store.get('safe', 30),
    sim: store.get('sim', false),
    speed: 'low', lights: false, moving: null, camOn: false,
    battery: 78, distance: 120, rssi: 4, history: []
  };
  const SPEED_STEP = { low: 3, medium: 6, high: 10 };

  /* ---------- toast ---------- */
  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ---------- robot communication ---------- */
  let bleDevice = null, bleCharacteristic = null;
  const BLE_SERVICE_UUID = '7b3e0001-6a4d-4f2a-9c1e-1234567890ab';
  const BLE_COMMAND_UUID = '7b3e0002-6a4d-4f2a-9c1e-1234567890ab';
  async function send(path) {
    if (!S.connected) { toast('Connect to the robot first', 'warn'); return false; }
    if (S.sim) return true;
    try {
      if (S.mode === 'bluetooth') {
        if (!bleCharacteristic) throw new Error('BLE command characteristic is not connected');
        const command = path === 'stop' ? 'STOP' : path.startsWith('move?') ? `MOVE ${new URLSearchParams(path.split('?')[1]).get('dir')} ${new URLSearchParams(path.split('?')[1]).get('speed')}` : path.startsWith('light?') ? `LIGHT ${new URLSearchParams(path.split('?')[1]).get('state')}` : path.toUpperCase();
        await bleCharacteristic.writeValue(new TextEncoder().encode(command));
        return true;
      }
      const r = await fetch(`http://${S.ip}/${path}`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return true;
    } catch (e) { toast('Robot command failed: ' + (e.message || 'check firmware/network'), 'err'); return false; }
  }

  async function connect() {
    if (S.connecting) return;
    S.connecting = true; renderConn();
    let ok = false;
    try {
      if (S.sim) { await sleep(300); ok = true; }
      else if (S.mode === 'bluetooth') {
        if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Open this page in Chrome/Edge over HTTPS.');
        bleDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [BLE_SERVICE_UUID] });
        bleDevice.addEventListener('gattserverdisconnected', () => { bleCharacteristic = null; S.connected = false; renderConn(); toast('Bluetooth disconnected', 'warn'); });
        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        bleCharacteristic = await service.getCharacteristic(BLE_COMMAND_UUID);
        ok = true;
      } else {
        // Requires an ESP32 HTTP API that returns CORS-enabled responses.
        const r = await fetch(`http://${S.ip}/ping`, { signal: AbortSignal.timeout(3500) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ok = true;
      }
    } catch (e) {
      ok = false;
      toast(e.message || `Could not connect to ${S.ip}. Check the ESP32 firmware.`, 'err');
    }
    S.connecting = false; S.connected = ok;
    if (ok) toast(S.sim ? 'Simulation mode (not a real robot)' : 'Connected to robot', S.sim ? 'warn' : 'ok');
    renderConn();
  }

  function disconnect(quiet) {
    if (S.moving) stopMove();
    try { if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect(); } catch {}
    bleDevice = null; bleCharacteristic = null;
    S.connected = false; S.connecting = false; S.lights = false;
    renderConn(); renderLights(); renderTelemetry();
    if (!quiet) toast('Disconnected');
  }

  /* ---------- rendering ---------- */
  function renderConn() {
    const pill = $('#statusPill'), dot = $('#connDot'), tag = $('#kvStatus');
    const state = S.connecting ? 'wait' : S.connected ? 'on' : 'off';
    const text = S.connecting ? 'Connecting…' : S.connected ? 'Connected to Robot' : 'Not connected';
    pill.classList.toggle('off', state === 'off');
    pill.classList.toggle('wait', state === 'wait');
    dot.className = 'dot' + (state === 'off' ? ' off' : state === 'wait' ? ' wait' : '');
    tag.className = 'tag' + (state === 'off' ? ' off' : state === 'wait' ? ' wait' : '');
    tag.textContent = S.connecting ? 'Connecting' : S.connected ? 'Connected' : 'Offline';
    $('#statusText').textContent = text;
    $('#connText').textContent = text;
    $('#statusMode').textContent = S.mode === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
    $('#kvIp').textContent = S.ip; $('#kvSsid').textContent = S.ssid;
    $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === S.mode));
    renderTelemetry();
  }

  function renderTelemetry() {
    const on = S.connected;
    // distance gauge
    const d = Math.max(0, Math.min(400, S.distance));
    const ang = Math.PI * (1 - d / 400);
    const m = $('#gMarker');
    m.setAttribute('cx', (150 + 120 * Math.cos(ang)).toFixed(1));
    m.setAttribute('cy', (150 - 120 * Math.sin(ang)).toFixed(1));
    $('#gVal').textContent = on ? Math.round(d) : '--';
    const b = $('#safeBadge'), lbl = $('span', b);
    let cls = 'safe', t = 'Safe Distance';
    if (!on) { cls += ' off'; t = 'No data'; }
    else if (d < S.safe) { cls += ' danger'; t = 'Obstacle! Too close'; }
    else if (d < S.safe * 2.5) { cls += ' warn'; t = 'Getting close'; }
    b.className = cls; lbl.textContent = t;

    // battery
    const f = $('#batFill');
    f.style.width = S.battery + '%';
    f.className = S.battery < 15 ? 'crit' : S.battery < 30 ? 'low' : '';
    $('#batPct').textContent = S.battery + '%';

    // signal
    const sig = $('#sigPill'), bars = $$('#signalBars i');
    const lv = on ? S.rssi : 0;
    bars.forEach((x, i) => x.classList.toggle('dim', i >= lv));
    sig.className = 'pill ' + (!on ? 'bad' : lv >= 3 ? 'ok' : lv === 2 ? 'warn' : 'bad');
    sig.innerHTML = '<i class="dot"></i>' + (!on ? 'Offline' : lv >= 3 ? 'Good' : lv === 2 ? 'Fair' : 'Weak');

    // motor
    const mp = $('#motorPill');
    mp.className = 'pill ' + (!on ? 'bad' : S.moving && S.moving !== 'stop' ? 'run' : 'ok');
    mp.innerHTML = '<i class="dot"></i>' + (!on ? 'Offline' : S.moving && S.moving !== 'stop' ? 'Running' : 'Ready');
    drawHistory();
  }

  function renderLights() {
    const b = $('#cmdLights');
    b.classList.toggle('active', S.lights);
    $('span', b).textContent = S.lights ? 'Turn Lights Off' : 'Turn Lights On';
  }

  /* ---------- movement ---------- */
  function startMove(dir) {
    if (dir === 'stop') { stopMove(); return; }
    if (!S.connected) { toast('Connect to the robot first', 'warn'); return; }
    if (dir === 'forward' && S.distance < S.safe) { toast('Obstacle ahead. Moving forward is blocked.', 'warn'); return; }
    S.moving = dir;
    $$('.dbtn').forEach(b => b.classList.toggle('on', b.dataset.dir === dir));
    send(`move?dir=${dir}&speed=${S.speed}`);
    renderTelemetry();
  }
  function stopMove() {
    const was = S.moving;
    S.moving = null;
    $$('.dbtn').forEach(b => b.classList.remove('on'));
    if (was && S.connected) send('stop');
    renderTelemetry();
  }

  // press-and-hold on the pad (mouse, touch and pen)
  $$('.dbtn').forEach(btn => {
    const dir = btn.dataset.dir;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); btn.setPointerCapture?.(e.pointerId); startMove(dir);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev =>
      btn.addEventListener(ev, () => { if (dir !== 'stop' && S.moving === dir) stopMove(); }));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });

  // keyboard
  const KEYS = { ArrowUp: 'forward', w: 'forward', ArrowDown: 'backward', s: 'backward', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
  const held = new Set();
  addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS[k]) { e.preventDefault(); if (!held.has(k)) { held.add(k); startMove(KEYS[k]); } }
    else if (k === ' ') { e.preventDefault(); stopMove(); }
    else if (k === 'l') toggleLights();
    else if (k === 'h') horn();
  });
  addEventListener('keyup', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEYS[k]) { held.delete(k); if (S.moving === KEYS[k]) stopMove(); }
  });
  addEventListener('blur', () => { held.clear(); if (S.moving) stopMove(); });

  $$('.spd').forEach(b => b.addEventListener('click', () => {
    S.speed = b.dataset.speed;
    $$('.spd').forEach(x => x.classList.toggle('active', x === b));
    if (S.moving) send(`move?dir=${S.moving}&speed=${S.speed}`);
  }));

  $('#helpBtn').addEventListener('click', () =>
    toast('Drive: arrows or W A S D · Stop: Space · Lights: L · Horn: H'));

  /* ---------- extra commands ---------- */
  async function toggleLights() {
    if (!S.connected) return toast('Connect to the robot first', 'warn');
    const next = !S.lights;
    if (await send(`light?state=${next ? 'on' : 'off'}`)) { S.lights = next; renderLights(); }
  }
  let audio;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = 380;
      g.gain.setValueAtTime(.12, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .45);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + .45);
    } catch { /* audio unavailable */ }
  }
  async function horn() { if (await send('horn')) { beep(); toast('Horn sounded', 'ok'); } }

  async function calibrate() {
    const b = $('#cmdCal');
    if (!S.connected) return toast('Connect to the robot first', 'warn');
    b.disabled = true; b.classList.add('spin');
    const ok = await send('calibrate'); await sleep(S.sim ? 1400 : 600);
    b.disabled = false; b.classList.remove('spin');
    if (ok) toast('Sensor calibrated', 'ok');
  }
  async function reset() {
    if (!S.connected) return toast('Connect to the robot first', 'warn');
    stopMove();
    if (await send('reset')) {
      S.lights = false; S.speed = 'low';
      $$('.spd').forEach(x => x.classList.toggle('active', x.dataset.speed === 'low'));
      renderLights(); toast('Robot reset', 'ok');
    }
  }

  function screenshot() {
    const c = document.createElement('canvas'); c.width = 960; c.height = 540;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 540); bg.addColorStop(0, '#0c1728'); bg.addColorStop(1, '#060c17');
    g.fillStyle = bg; g.fillRect(0, 0, 960, 540);
    let drewFrame = false;
    const img = $('#camImg');
    if (S.camOn && !img.hidden) { try { g.drawImage(img, 0, 0, 960, 540); drewFrame = true; } catch { /* cross-origin stream */ } }
    if (!drewFrame) {
      g.fillStyle = '#eaf1fb'; g.font = '700 44px Segoe UI, sans-serif'; g.fillText('RoboControl', 40, 90);
      g.font = '28px Segoe UI, sans-serif'; g.fillStyle = '#8fa3bf';
      g.fillText('Camera stream not available', 40, 150);
      g.fillStyle = '#eaf1fb';
      g.fillText(`Distance: ${S.connected ? Math.round(S.distance) + ' cm' : '--'}`, 40, 230);
      g.fillText(`Battery: ${S.battery}%`, 40, 280);
      g.fillText(`Speed: ${S.speed}`, 40, 330);
      g.fillText(`Lights: ${S.lights ? 'on' : 'off'}`, 40, 380);
    }
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 496, 960, 44);
    g.fillStyle = '#fff'; g.font = '20px Segoe UI, sans-serif'; g.fillText(new Date().toLocaleString(), 20, 525);
    const a = document.createElement('a');
    a.download = `robocontrol-${Date.now()}.png`;
    try { a.href = c.toDataURL('image/png'); a.click(); toast('Screenshot saved', 'ok'); }
    catch { toast('Screenshot was blocked by the camera stream source', 'err'); }
  }

  $('#cmdLights').addEventListener('click', toggleLights);
  $('#cmdHorn').addEventListener('click', horn);
  $('#cmdCal').addEventListener('click', calibrate);
  $('#cmdReset').addEventListener('click', reset);
  $('#cmdShot').addEventListener('click', screenshot);

  /* ---------- camera ---------- */
  function setCam(on) {
    const box = $('#camBox'), img = $('#camImg');
    if (on && !S.camUrl) { toast('Add the camera stream URL in Settings to start the camera', 'warn'); return; }
    S.camOn = on;
    box.classList.toggle('live', on);
    img.hidden = !on;
    img.src = on ? S.camUrl : '';
    $('#camLabel').textContent = on ? 'Stop Camera' : 'Start Camera';
    img.onerror = () => { if (S.camOn) { toast('Could not load the camera stream', 'err'); setCam(false); } };
  }
  $('#camPlay').addEventListener('click', () => setCam(!S.camOn));
  $('#camBox').querySelector('.cam-bar span').addEventListener('click', () => setCam(!S.camOn));
  $('#camFull').addEventListener('click', () => {
    const el = $('#camBox');
    if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.();
  });

  /* ---------- telemetry loop ---------- */
  let tick = 0;
  async function poll() {
    tick++;
    if (S.connected) {
      if (S.sim) {
        let step = S.moving ? SPEED_STEP[S.speed] : 0;
        if (S.moving === 'forward')  S.distance -= step;
        else if (S.moving === 'backward') S.distance += step;
        else S.distance += (Math.random() - .5) * 4;
        S.distance = Math.max(8, Math.min(400, S.distance));
        if (!S.moving && Math.abs(S.distance - 120) > 2 && tick % 6 === 0) S.distance += (120 - S.distance) * .08;
        if (tick % 60 === 0 && S.battery > 5) S.battery--;
        S.rssi = Math.random() > .93 ? 3 : 4;
        if (S.moving === 'forward' && S.distance < S.safe) { stopMove(); toast('Stopped: obstacle detected', 'warn'); }
      } else if (S.mode === 'wifi' && tick % 2 === 0) {
        try {
          const r = await fetch(`http://${S.ip}/status`, { signal: AbortSignal.timeout(1500) });
          const j = await r.json();
          if (typeof j.distance === 'number') S.distance = j.distance;
          if (typeof j.battery === 'number') S.battery = Math.round(j.battery);
          if (typeof j.rssi === 'number') S.rssi = j.rssi > -60 ? 4 : j.rssi > -70 ? 3 : j.rssi > -80 ? 2 : 1;
          if (S.moving === 'forward' && S.distance < S.safe) { stopMove(); toast('Stopped: obstacle detected', 'warn'); }
        } catch { /* /status is optional or CORS is off */ }
      }
      S.history.push(S.distance); if (S.history.length > 60) S.history.shift();
    }
    renderTelemetry();
  }
  setInterval(poll, 500);

  /* ---------- distance history chart ---------- */
  function drawHistory() {
    const c = $('#histCanvas');
    if (!c || c.offsetParent === null) return;
    const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    g.strokeStyle = css.getPropertyValue('--line'); g.fillStyle = css.getPropertyValue('--muted'); g.font = '12px sans-serif'; g.lineWidth = 1;
    for (let v = 0; v <= 400; v += 100) {
      const y = h - 18 - (v / 400) * (h - 30);
      g.beginPath(); g.moveTo(34, y); g.lineTo(w - 8, y); g.stroke(); g.fillText(v, 4, y + 4);
    }
    const sy = h - 18 - (S.safe / 400) * (h - 30);
    g.strokeStyle = '#e5332a'; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(34, sy); g.lineTo(w - 8, sy); g.stroke(); g.setLineDash([]);
    const n = S.history.length; if (n < 2) return;
    g.strokeStyle = '#19b8ff'; g.lineWidth = 2.5; g.beginPath();
    S.history.forEach((v, i) => {
      const x = 34 + (i / 59) * (w - 42), y = h - 18 - (v / 400) * (h - 30);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }
  addEventListener('resize', drawHistory);

  /* ---------- navigation ---------- */
  function show(view) {
    if (!['dashboard', 'control', 'camera', 'sensors', 'settings', 'about'].includes(view)) view = 'dashboard';
    $('#main').dataset.view = view;
    $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
    $('#sidebar').classList.remove('open');
    drawHistory();
  }
  addEventListener('hashchange', () => show(location.hash.slice(1)));
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#topSettings').addEventListener('click', () => { location.hash = 'settings'; });

  /* ---------- status menu ---------- */
  const pill = $('#statusPill'), menu = $('#statusMenu');
  function toggleMenu(open) { menu.hidden = !open; pill.setAttribute('aria-expanded', open); }
  pill.addEventListener('click', e => { e.stopPropagation(); toggleMenu(menu.hidden); });
  addEventListener('click', () => toggleMenu(false));
  addEventListener('keydown', e => { if (e.key === 'Escape') toggleMenu(false); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'disconnect') disconnect();
    else { S.mode = a; disconnect(true); renderConn(); connect(); }
  });

  $$('.seg-btn').forEach(b => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    if (S.connected) disconnect(true);
    renderConn(); connect();
  }));

  /* ---------- theme ---------- */
  function setTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); drawHistory(); }
  $('#themeBtn').addEventListener('click', () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  setTheme(store.get('theme', 'dark'));

  /* ---------- power button: stop everything and disconnect ---------- */
  $('#powerBtn').addEventListener('click', () => {
    if (!S.connected) return connect();
    send('stop'); disconnect();
  });

  /* ---------- settings form ---------- */
  function fillSettings() {
    $('#setIp').value = S.ip; $('#setSsid').value = S.ssid; $('#setCam').value = S.camUrl;
    $('#setSafe').value = S.safe; $('#setSim').checked = S.sim;
  }
  $('#settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    const ip = $('#setIp').value.trim();
    if (!/^[\w.\-]+(:\d+)?$/.test(ip)) return toast('Enter a valid IP address, for example 192.168.4.1', 'err');
    const safe = Math.max(5, Math.min(200, +$('#setSafe').value || 30));
    S.ip = ip; S.ssid = $('#setSsid').value.trim() || 'RoboESP32';
    S.camUrl = $('#setCam').value.trim(); S.safe = safe; S.sim = $('#setSim').checked;
    ['ip', 'ssid', 'camUrl', 'safe', 'sim'].forEach(k => store.set(k, S[k]));
    if (S.camOn) setCam(false);
    renderConn(); toast('Settings saved', 'ok');
  });
  $('#testConn').addEventListener('click', async () => {
    $('#settingsForm').requestSubmit();
    if (S.connected) disconnect(true);
    await connect();
  });

  /* ---------- start ---------- */
  fillSettings(); renderLights(); renderConn(); show(location.hash.slice(1));
  // Never auto-connect in simulation: real connection must be explicitly initiated.
})();
