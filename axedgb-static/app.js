function bytesToMiB(bytes) {
  if (bytes == null) return '-';
  return `${Math.max(0, bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function bytesToGiB(bytes) {
  if (bytes == null) return '-';
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

async function fetchJsonWithRetry(url, { retries = 2, delayMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchJson(url);
    } catch (err) {
      lastErr = err;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '-';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

function computeSyncEtaSeconds(node, key) {
  try {
    const blocks = Number(node && node.blocks);
    const headers = Number(node && node.headers);
    if (!Number.isFinite(blocks) || !Number.isFinite(headers) || headers <= blocks) return null;
    const now = Date.now();
    const prevRaw = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify({ t: now, blocks, headers }));
    if (!prevRaw) return null;
    const prev = JSON.parse(prevRaw);
    const dtS = (now - Number(prev.t || 0)) / 1000;
    const dBlocks = blocks - Number(prev.blocks || 0);
    if (!Number.isFinite(dtS) || dtS <= 5) return null;
    if (!Number.isFinite(dBlocks) || dBlocks <= 0) return null;
    const rate = dBlocks / dtS;
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const remaining = headers - blocks;
    return remaining / rate;
  } catch {
    return null;
  }
}

function formatTHS(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  if (n === 0) return '0';
  if (Math.abs(n) < 0.01) return n.toFixed(4);
  if (Math.abs(n) < 1) return n.toFixed(3);
  if (Math.abs(n) < 10) return n.toFixed(2);
  return n.toFixed(1);
}

function formatHashrateFromTHS(v) {
  if (v == null || v === '') return '-';
  const ths = Number(v);
  if (!Number.isFinite(ths)) return '-';
  if (ths === 0) return '0 H/s';

  const abs = Math.abs(ths);
  // Convert from TH/s into a human unit.
  const units = [
    { unit: 'EH/s', scale: 1e6 },
    { unit: 'PH/s', scale: 1e3 },
    { unit: 'TH/s', scale: 1 },
    { unit: 'GH/s', scale: 1e-3 },
    { unit: 'MH/s', scale: 1e-6 },
    { unit: 'KH/s', scale: 1e-9 },
    { unit: 'H/s', scale: 1e-12 },
  ];

  for (const u of units) {
    const inUnit = abs / u.scale;
    if (inUnit >= 1 || u.unit === 'H/s') {
      const signed = ths / u.scale;
      const digits = Math.abs(signed) < 10 ? 2 : Math.abs(signed) < 100 ? 1 : 0;
      return `${signed.toFixed(digits)} ${u.unit}`;
    }
  }
  return `${formatTHS(ths)} TH/s`;
}

function formatCompactNumber(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const units = [
    { scale: 1e12, suffix: 'T' },
    { scale: 1e9, suffix: 'G' },
    { scale: 1e6, suffix: 'M' },
    { scale: 1e3, suffix: 'K' },
  ];

  for (const u of units) {
    if (abs >= u.scale) {
      const x = n / u.scale;
      const digits = Math.abs(x) < 10 ? 3 : Math.abs(x) < 100 ? 2 : 1;
      return `${x.toFixed(digits)}${u.suffix}`;
    }
  }

  if (abs >= 100) return `${n.toFixed(0)}`;
  if (abs >= 10) return `${n.toFixed(1)}`;
  if (abs >= 1) return `${n.toFixed(2)}`;
  return `${n.toFixed(3)}`;
}

function formatSmallPercent(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return '0%';
  if (n < 0.0001) return `${n.toExponential(2)}%`;
  if (n < 0.01) return `${n.toFixed(4)}%`;
  if (n < 1) return `${n.toFixed(2)}%`;
  if (n < 10) return `${n.toFixed(1)}%`;
  return `${Math.round(n)}%`;
}

function formatEta(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '-';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function setRing(progress) {
  const ring = document.getElementById('ring');
  const label = document.getElementById('ring-label');
  const circumference = 301.6;
  const p = Math.max(0, Math.min(1, progress || 0));
  const offset = circumference * (1 - p);
  ring.style.strokeDashoffset = `${offset}`;
  label.textContent = `${Math.round(p * 100)}%`;
}

function drawSparklineMulti(canvas, series, opts = {}) {
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth;
  if (canvas.width !== width) canvas.width = width;
  const height = canvas.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const allValues = [];
  for (const s of series || []) {
    for (const p of (s && s.points) || []) {
      const v = p && typeof p.v === 'number' ? p.v : NaN;
      if (Number.isFinite(v)) allValues.push(v);
    }
  }

  if (!allValues.length) {
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace';
    ctx.fillText('-', 8, 22);
    return;
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const pad = 10;
  const span = max - min || 1;

  function x(i, n) {
    return pad + (i * (canvas.width - pad * 2)) / Math.max(1, n - 1);
  }
  function y(v) {
    return pad + ((max - v) * (canvas.height - pad * 2)) / span;
  }

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, canvas.height - pad);
  ctx.lineTo(canvas.width - pad, canvas.height - pad);
  ctx.stroke();

  // lines
  ctx.lineWidth = 2;
  for (const s of series || []) {
    const points = (s && s.points) || [];
    if (!points.length) continue;
    ctx.strokeStyle = s.color || 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const v = points[i] && points[i].v;
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      const px = x(i, points.length);
      const py = y(v);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // last dot (last finite point)
    for (let i = points.length - 1; i >= 0; i--) {
      const v = points[i] && points[i].v;
      if (!Number.isFinite(v)) continue;
      ctx.fillStyle = s.color || 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x(i, points.length), y(v), 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  // min/max labels
  ctx.fillStyle = 'rgba(148,163,184,0.65)';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace';
  const fmt = opts.format || ((v) => String(v));
  ctx.fillText(fmt(max), pad, 14);
  ctx.fillText(fmt(min), pad, canvas.height - 4);
}

function drawSparkline(canvas, points, opts = {}) {
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const height = canvas.height;
  if (canvas.width !== width) canvas.width = width;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points.length) {
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    ctx.fillText('-', 8, 22);
    return;
  }

  const values = points.map((p) => p.v).filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!values.length) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 10;
  const span = max - min || 1;

  function x(i) {
    return pad + (i * (canvas.width - pad * 2)) / Math.max(1, points.length - 1);
  }
  function y(v) {
    return pad + ((max - v) * (canvas.height - pad * 2)) / span;
  }

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, canvas.height - pad);
  ctx.lineTo(canvas.width - pad, canvas.height - pad);
  ctx.stroke();

  // line
  const gradient = ctx.createLinearGradient(0, canvas.height, canvas.width, 0);
  gradient.addColorStop(0, 'rgba(0,229,255,0.95)');
  gradient.addColorStop(0.5, 'rgba(255,43,214,0.95)');
  gradient.addColorStop(1, 'rgba(255,154,0,0.95)');

  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = x(i);
    const py = y(points[i].v);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // last dot
  const last = points[points.length - 1];
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(x(points.length - 1), y(last.v), 2.5, 0, Math.PI * 2);
  ctx.fill();

  // min/max labels
  ctx.fillStyle = 'rgba(148,163,184,0.65)';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  const fmt = opts.format || ((v) => String(v));
  ctx.fillText(fmt(max), pad, 14);
  ctx.fillText(fmt(min), pad, canvas.height - 4);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function showActionModal({
  kicker = '',
  title = '',
  bodyHtml = '',
  primaryText = '',
  secondaryText = '',
} = {}) {
  const root = document.getElementById('action-modal');
  if (!root) return Promise.resolve('close');

  const elKicker = document.getElementById('action-modal-kicker');
  const elTitle = document.getElementById('action-modal-title');
  const elBody = document.getElementById('action-modal-body');
  const btnX = document.getElementById('action-modal-x');
  const btnPrimary = document.getElementById('action-modal-primary');
  const btnSecondary = document.getElementById('action-modal-secondary');

  if (elKicker) elKicker.textContent = kicker || '';
  if (elTitle) elTitle.textContent = title || '';
  if (elBody) elBody.innerHTML = bodyHtml || '';

  const setBtn = (btn, label) => {
    if (!btn) return;
    const text = String(label || '').trim();
    if (!text) {
      btn.classList.add('hidden');
      btn.textContent = '';
      return;
    }
    btn.textContent = text;
    btn.classList.remove('hidden');
  };
  setBtn(btnPrimary, primaryText);
  setBtn(btnSecondary, secondaryText);

  return new Promise((resolve) => {
    const close = (result) => {
      root.classList.add('hidden');
      if (btnX) btnX.onclick = null;
      if (btnPrimary) btnPrimary.onclick = null;
      if (btnSecondary) btnSecondary.onclick = null;
      root.onclick = null;
      resolve(result);
    };

    if (btnX) btnX.onclick = () => close('close');
    if (btnPrimary) btnPrimary.onclick = () => close('primary');
    if (btnSecondary) btnSecondary.onclick = () => close('secondary');
    root.onclick = (e) => {
      if (e && e.target === root) close('close');
    };
    document.addEventListener(
      'keydown',
      (e) => {
        if (e && e.key === 'Escape' && !root.classList.contains('hidden')) close('close');
      },
      { once: true }
    );

    root.classList.remove('hidden');
  });
}

function looksLikeOtherChainAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const lowered = s.toLowerCase();
  if (lowered.startsWith('dgb1')) return 'dgb-bech32';
  if (lowered.startsWith('bitcoincash:') || lowered.startsWith('q') || lowered.startsWith('p')) return 'bch';
  if (lowered.startsWith('bc1') || lowered.startsWith('1') || lowered.startsWith('3')) return 'btc';
  return null;
}

async function showRestartRequiredModal({ title, bodyHtml }) {
  await showActionModal({
    kicker: 'Restart Required',
    title: title || 'Restart the app to apply changes',
    bodyHtml:
      bodyHtml ||
      `Your changes were saved, but they will not take effect until you restart AxeDGB.<br><br>
       Restart AxeDGB from the 5tratumOS Apps page to apply changes.`,
    primaryText: 'OK',
  });
}

function showTab(tab) {
  const home = document.getElementById('view-home');
  const pool = document.getElementById('view-pool');
  const blocks = document.getElementById('view-blocks');
  const settings = document.getElementById('view-settings');
  const project = document.getElementById('view-project');
  const tHome = document.getElementById('tab-home');
  const tPool = document.getElementById('tab-pool');
  const tBlocks = document.getElementById('tab-blocks');
  const tSet = document.getElementById('tab-settings');
  const tProject = document.getElementById('tab-project');

  const which = tab || 'home';
  home.classList.toggle('hidden', which !== 'home');
  pool.classList.toggle('hidden', which !== 'pool');
  blocks.classList.toggle('hidden', which !== 'blocks');
  settings.classList.toggle('hidden', which !== 'settings');
  if (project) project.classList.toggle('hidden', which !== 'project');

  tHome.classList.toggle('axe-tab--active', which === 'home');
  tPool.classList.toggle('axe-tab--active', which === 'pool');
  tBlocks.classList.toggle('axe-tab--active', which === 'blocks');
  tSet.classList.toggle('axe-tab--active', which === 'settings');
  if (tProject) tProject.classList.toggle('axe-tab--active', which === 'project');

  window.__activeTab = which;
}

function escapeHtml(s) {
  const str = s == null ? '' : String(s);
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatReadinessPill(ok, label) {
  return `<span class="${ok ? 'axe-pill axe-pill--ok' : 'axe-pill'}">${escapeHtml(label)}</span>`;
}

function formatReadinessCard(check) {
  const blocked = !check.ok;
  const cardClass = blocked
    ? 'rounded-xl border border-red-500/25 bg-red-950/30 px-4 py-3'
    : 'rounded-xl border border-white/10 bg-black/25 px-4 py-3';
  return `
    <div class="${cardClass}">
      <div class="flex items-center justify-between gap-3">
        <div class="axe-stat__k">${escapeHtml(check.label)}</div>
        ${formatReadinessPill(check.ok, check.ok ? 'Ready' : 'Blocked')}
      </div>
      <div class="mt-2 text-sm ${blocked ? 'text-red-200' : 'text-slate-100'}">${escapeHtml(check.value || '-')}</div>
      <div class="mt-1 text-xs text-slate-400">${escapeHtml(check.help || '')}</div>
    </div>
  `;
}

function renderReadiness(state) {
  const checksEl = document.getElementById('readiness-checks');
  const pillEl = document.getElementById('readiness-pill');
  const gateEl = document.getElementById('readiness-gate');
  const nextEl = document.getElementById('readiness-next-step');
  const repairEl = document.getElementById('readiness-repair');
  const bannerNodeEl = document.getElementById('readiness-node-status');
  const bannerPoolEl = document.getElementById('readiness-pool-status');
  const bannerStratumEl = document.getElementById('readiness-stratum-status');
  const bannerMsgEl = document.getElementById('readiness-status-message');
  if (!checksEl) return;

  const checks = Array.isArray(state && state.checks) ? state.checks : [];
  const ready = checks.filter((c) => c && c.ok).length;
  const total = checks.length;
  checksEl.innerHTML = checks.map(formatReadinessCard).join('');

  if (pillEl) {
    pillEl.textContent = total ? `${ready}/${total} checks ready` : 'Checking...';
    pillEl.classList.toggle('axe-pill--ok', total > 0 && ready === total);
  }
  if (bannerNodeEl) bannerNodeEl.textContent = state && state.nodeStatus ? state.nodeStatus : '-';
  if (bannerPoolEl) bannerPoolEl.textContent = state && state.poolStatus ? state.poolStatus : '-';
  if (bannerStratumEl) bannerStratumEl.textContent = state && state.stratumStatus ? state.stratumStatus : '-';
  if (bannerMsgEl) bannerMsgEl.textContent = state && state.message ? state.message : '-';
  if (gateEl) gateEl.textContent = state && state.gate ? state.gate : '-';
  if (nextEl) nextEl.textContent = state && state.nextStep ? state.nextStep : '-';
  if (repairEl) repairEl.textContent = state && state.repair ? state.repair : 'No startup repair recorded.';
}

function shortenLabel(s) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= 28) return str;
  return `${str.slice(0, 10)}...${str.slice(-8)}`;
}

function formatBestShareWorkerLabel(v) {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '-';
  return `by ${shortenLabel(s)}`;
}

function shortenMiner(s) {
  if (!s) return '-';
  const str = String(s);
  if (str.length <= 20) return str;
  return `${str.slice(0, 10)}...${str.slice(-8)}`;
}

function formatAge(v) {
  if (v == null) return '-';
  const n = Number(v);
  let ms = 0;
  if (Number.isFinite(n) && n > 0) {
    ms = n > 1e12 ? n : n * 1000;
  } else {
    const parsed = Date.parse(String(v));
    if (!Number.isFinite(parsed)) return '-';
    ms = parsed;
  }

  const ageS = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ageS < 60) return `${ageS}s`;
  const ageM = Math.floor(ageS / 60);
  if (ageM < 60) return `${ageM}m`;
  const ageH = Math.floor(ageM / 60);
  return `${ageH}h`;
}

function formatAgo(v) {
  const s = formatAge(v);
  return s === '-' ? '-' : `${s} ago`;
}

function isEpochSeconds(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 1_000_000_000 && n < 100_000_000_000;
}

function toEpochSeconds(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const parsed = Date.parse(String(v));
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function formatWinSubtitle(block) {
  const createdS = toEpochSeconds(block && (block.t || block.created || block.Created));
  if (!isEpochSeconds(createdS)) return '';
  return `Mined ${formatAgo(createdS)}`;
}

function playWinConfetti(modal) {
  try {
    const confettiEl = document.getElementById('block-win-confetti');
    const cardEl = modal ? modal.querySelector('.block-win-card') : null;
    if (!confettiEl) return;
    confettiEl.innerHTML = '';
    if (cardEl) cardEl.classList.add('block-win--celebrate');
    const hues = [200, 270, 45, 140, 320];
    const count = 44;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'piece';
      const x = Math.random() * 100;
      const dx = Math.random() * 100;
      const h = hues[i % hues.length];
      const r = `${Math.floor(Math.random() * 360)}deg`;
      const d = `${(Math.random() * 0.4).toFixed(2)}s`;
      piece.style.setProperty('--x', String(x.toFixed(2)));
      piece.style.setProperty('--dx', String(dx.toFixed(2)));
      piece.style.setProperty('--h', String(h));
      piece.style.setProperty('--r', r);
      piece.style.setProperty('--d', d);
      confettiEl.appendChild(piece);
    }
    window.setTimeout(() => {
      try {
        if (confettiEl) confettiEl.innerHTML = '';
        if (cardEl) cardEl.classList.remove('block-win--celebrate');
      } catch {}
    }, 2200);
  } catch {}
}

// Donut-O-Meter (fun only): dynamic glaze + slower vibes.
const __axeHashStr = (s) => {
  const str = String(s || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const __axePick = (key, bucket, arr) => {
  const a = Array.isArray(arr) ? arr : [];
  if (!a.length) return '';
  const idx = (__axeHashStr(`${key}::${bucket}`) % a.length) >>> 0;
  return a[idx];
};

const __axeClamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

const __glazeStateByWorker = window.__glazeStateByWorker || (window.__glazeStateByWorker = {});
const __glazeMetaByWorker = window.__glazeMetaByWorker || (window.__glazeMetaByWorker = {});
const __phraseStateByWorker = window.__phraseStateByWorker || (window.__phraseStateByWorker = {});
const __prevHrByWorker = window.__prevHrByWorker || (window.__prevHrByWorker = {});

function __colorForPct(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  const c0 = { r: 0, g: 229, b: 255 };
  const c1 = { r: 255, g: 43, b: 214 };
  const c2 = { r: 255, g: 154, b: 0 };
  const t = p / 100;
  let r = 0,
    g = 0,
    b = 0;
  if (t <= 0.5) {
    const u = t / 0.5;
    r = lerp(c0.r, c1.r, u);
    g = lerp(c0.g, c1.g, u);
    b = lerp(c0.b, c1.b, u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = lerp(c1.r, c2.r, u);
    g = lerp(c1.g, c2.g, u);
    b = lerp(c1.b, c2.b, u);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function __pickGlazePhrase({ workerKey, tag, lastAgeS }) {
  const wk = String(workerKey || '');
  const now = Date.now();
  // 3m cadence with per-worker jitter so the whole list doesn't update in sync.
  const jitterMs = __axeHashStr(`${wk}::phrase`) % (2 * 60000);
  const bucket = Math.floor((now + jitterMs) / (3 * 60000));

  const prev = __phraseStateByWorker[wk];
  const prevTag = prev && prev.tag ? String(prev.tag) : '';
  const prevBucket = prev && Number.isFinite(prev.bucket) ? Number(prev.bucket) : null;
  // Stable for ~6m unless the tag changes
  if (prev && prevTag === tag && prevBucket != null && bucket - prevBucket < 2 && prev.phrase) return prev.phrase;
  if (prev && prevTag === tag && prevBucket === bucket && prev.phrase) return prev.phrase;

  const age = Number.isFinite(lastAgeS) ? Number(lastAgeS) : null;
  const isVeryStale = age != null && age > 600;
  const isStale = age != null && age > 90;

  const phrases = {
    party: ['Glaze spike detected', 'Sprinkle storm inbound', 'Donut is feeling brave', 'Glaze went turbo', 'Donut is unhinged'],
    spike: ['Glaze just twitched', 'That share had bite', 'Sprinkles standing by', 'Glaze is optimistic today', 'Donut remembers that one'],
    glow: ['Glaze is vibing', 'Oven is warm', 'Quiet confidence', 'Donut is watching', 'Glaze level: acceptable'],
    idle: ['Glaze cooling down', 'Low activity mode', 'Donut is pacing', 'Waiting on a big one', 'Sprinkles on standby'],
    sleep: ['Glaze is asleep', 'Donut went AFK', 'Dozing until a share lands', 'Wake me on a spike', 'Hibernating sprinkles'],
    chill: ['Just donut things', 'Glaze is vibing', 'Sprinkles on standby', 'Oven is warm', 'Donut is watching'],
  };

  const list = phrases[tag] || phrases.chill;
  const phrase = __axePick(`${wk}::${tag}::${isVeryStale ? 'vs' : isStale ? 's' : 'ok'}`, bucket, list);
  __phraseStateByWorker[wk] = { tag, bucket, phrase };
  return phrase;
}

function __updateGlazeLevel({
  workerKey,
  workerThs,
  recordRatio01,
  lastAgeS,
  hrTick,
  recordBroke,
}) {
  const nowS = Date.now() / 1000;
  const prev = __glazeStateByWorker[workerKey];
  const prevLevel = prev && Number.isFinite(prev.level) ? Number(prev.level) : 0.52;
  const prevTs = prev && Number.isFinite(prev.ts) ? Number(prev.ts) : nowS;
  const dt = Math.max(0, Math.min(6, nowS - prevTs));

  const seed01 = __axeHashStr(workerKey) / 0xffffffff;
  const bias = (seed01 - 0.5) * 0.24;
  const temperament = 0.7 + seed01 * 0.9; // per-worker volatility (keeps them from looking identical)

  const ths = Number(workerThs || 0);
  const energy = Number.isFinite(ths) && ths > 0 ? Math.max(0, Math.min(1, Math.log10(1 + ths) / 3)) : 0;

  const age = Number(lastAgeS);
  const activity = Number.isFinite(age) && age >= 0 ? Math.exp(-Math.max(0, age) / 45) : 0;
  const stale01 = Number.isFinite(age) ? __axeClamp01((age - 25) / 260) : 0;

  const rec = __axeClamp01(recordRatio01);
  const recBoost = Math.pow(rec, 0.33);

  const oscA = Math.sin(nowS / 7.3 + seed01 * 6.28318);
  const oscB = Math.sin(nowS / 2.9 + seed01 * 10.9);
  const osc = temperament * (oscA * (0.06 + 0.08 * energy) + oscB * (0.03 + 0.04 * activity));

  const wobbleSeed = __axeHashStr(`${workerKey}::${Math.floor(nowS * 1.8)}`) / 0xffffffff;
  const wobble = temperament * (wobbleSeed - 0.5) * (0.10 + 0.20 * Math.max(activity, energy, recBoost));

  const hr = Number.isFinite(hrTick) ? hrTick : 1;
  const hrBoost = hr > 1.18 ? 0.06 : hr > 1.08 ? 0.03 : 0;
  const hrCool = hr < 0.82 ? 0.06 : hr < 0.92 ? 0.03 : 0;

  let target =
    0.52 +
    bias +
    0.16 * energy +
    0.26 * recBoost +
    0.18 * activity +
    hrBoost -
    hrCool +
    osc +
    wobble;

  if (recordBroke) target += 0.22;

  // Cool down on staleness
  target *= 1 - stale01 * 0.62;

  target = __axeClamp01(target);

  const TAU = 14 + seed01 * 10;
  const alpha = 1 - Math.exp(-dt / TAU);
  const next = prevLevel + (target - prevLevel) * alpha;
  __glazeStateByWorker[workerKey] = { level: next, ts: nowS };
  return __axeClamp01(next);
}

function __maybeUpdateGlazeMeta({ workerKey, tag, recordBroke, hrTick, staleS }) {
  const nowS = Date.now() / 1000;
  const prev = __glazeMetaByWorker[workerKey];
  const prevTs = prev && Number.isFinite(prev.ts) ? Number(prev.ts) : 0;
  const prevTag = prev && prev.tag ? String(prev.tag) : '';
  const seed01 = __axeHashStr(workerKey) / 0xffffffff;
  const holdS = 150 + (seed01 * 60); // 2.5–3.5 minutes per worker (readable, not spammy)
  const shouldUpdate = recordBroke || prevTag !== tag || !prevTs || nowS - prevTs >= holdS;
  if (!shouldUpdate) return;

  const signals = [];
  if (recordBroke) signals.push('record+');
  const hr = Number.isFinite(hrTick) ? hrTick : 1;
  if (hr > 1.18) signals.push('hr+');
  else if (hr < 0.82) signals.push('hr-');
  if (Number.isFinite(staleS) && staleS > 120) signals.push('stale');

  const explain = [];
  if (recordBroke) explain.push('new record');
  if (Number.isFinite(staleS) && staleS > 120) explain.push('quiet');
  if (hr > 1.18) explain.push('hashrate up');
  else if (hr < 0.82) explain.push('hashrate down');

  __glazeMetaByWorker[workerKey] = {
    tag,
    ts: nowS,
    signals: signals.slice(0, 3),
    explain: explain.slice(0, 2),
  };
}

function renderWorkerDetails(miners) {
  const status = document.getElementById('worker-details-status');
  const rows = document.getElementById('worker-details-rows');
  const lastShareEl = document.getElementById('last-share');
  if (!rows) return;

  rows.innerHTML = '';
  const list = Array.isArray(miners) ? miners : [];
  const ACTIVE_WINDOW_S = 300;
  const STALE_WINDOW_S = 86400;
  const nowMs = Date.now();
  const showInactive = Boolean(document.getElementById('workers-show-inactive')?.checked);

  const toNumberLoose = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (!s) return null;
    const cleaned = s.replace(/,/g, '');
    const m = cleaned.match(/^\s*([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  const toMs = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      return v > 1e12 ? v : v * 1000;
    }
    const raw = String(v).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return n > 1e12 ? n : n * 1000;
    }
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  };

  const hasActivitySignal = (m) => {
    if (!m || typeof m !== 'object') return false;
    const hashrateHs = toNumberLoose(m.hashrate_hs) || toNumberLoose(m.hashrate) || null;
    const hashrateThs = toNumberLoose(m.hashrate_ths) || null;
    const hashrate = (hashrateHs != null ? hashrateHs : 0) || (hashrateThs != null ? hashrateThs * 1e12 : 0);
    const sharesPerSecond = toNumberLoose(m.sharesPerSecond) || 0;
    return hashrate > 0 || sharesPerSecond > 0;
  };

  const ageSFor = (m) => {
    const ms = toMs(m && m.lastShare);
    if (ms == null) return null;
    return Math.max(0, Math.floor((nowMs - ms) / 1000));
  };

  const seen = list.filter((m) => {
    const ageS = ageSFor(m);
    return hasActivitySignal(m) || (ageS != null && ageS <= STALE_WINDOW_S);
  });

  const active = seen.filter((m) => {
    const ageS = ageSFor(m);
    return hasActivitySignal(m) || (ageS != null && ageS <= ACTIVE_WINDOW_S);
  });

  const inactive = seen.filter((m) => {
    const ageS = ageSFor(m);
    return !hasActivitySignal(m) && ageS != null && ageS > ACTIVE_WINDOW_S && ageS <= STALE_WINDOW_S;
  });

  let visible = showInactive ? active.concat(inactive) : active;
  if (!visible.length && seen.length) visible = seen;
  // If we got worker rows but couldn't classify them (missing lastShare/hashrate),
  // show the raw list so users still see connected devices.
  if (!visible.length && list.length) visible = list;

  window.__lastWorkers = miners;

  if (!visible.length) {
    if (status) status.textContent = 'No workers connected yet.';
    if (lastShareEl) lastShareEl.textContent = '-';
    rows.innerHTML = '<div class="px-3 py-2 text-xs text-slate-400">Connect a miner to see per-worker stats.</div>';
    return;
  }

  if (status) {
    const inactiveSuffix = showInactive && inactive.length ? ` + ${inactive.length} inactive` : '';
    const seenSuffix = seen.length !== active.length ? ` (${seen.length} seen)` : '';
    status.textContent = `${active.length} worker${active.length === 1 ? '' : 's'} active${inactiveSuffix}${seenSuffix}`;
  }

  if (lastShareEl) {
    let newestMs = 0;
    for (const m of seen) {
      const v = m && m.lastShare;
      if (v == null) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) {
        const ms = n > 1e12 ? n : n * 1000;
        if (ms > newestMs) newestMs = ms;
        continue;
      }
      const parsed = Date.parse(String(v));
      if (Number.isFinite(parsed) && parsed > newestMs) newestMs = parsed;
    }
    lastShareEl.textContent = newestMs ? `${formatAge(newestMs)} ago` : '-';
  }

  const sortKeyFor = (m) => {
    const name = m && m.worker ? String(m.worker) : shortenMiner(m && m.miner);
    return (name || '').toLowerCase();
  };
  const sortByName = (a, b) => sortKeyFor(a).localeCompare(sortKeyFor(b));
  const sortedVisible = visible.slice().sort(sortByName);
  if (!sortedVisible.length) {
    rows.innerHTML = showInactive
      ? '<div class="px-3 py-2 text-xs text-slate-400">No worker stats yet.</div>'
      : '<div class="px-3 py-2 text-xs text-slate-400">No active workers. Turn on \"Show inactive (24h)\" to view recent workers.</div>';
    return;
  }
  const algo = (window.__activeAlgo || '').trim();
  const netByAlgo = window.__networkDifficultyByAlgo && typeof window.__networkDifficultyByAlgo === 'object' ? window.__networkDifficultyByAlgo : {};
  const netDiff = Number(netByAlgo[algo] ?? window.__networkDifficulty);
  const maxBestSince = sortedVisible.reduce((acc, mm) => {
    const n = toNumberLoose(mm && (mm.bestshare_since_block ?? mm.bestShareSinceBlock));
    return n != null && n > acc ? n : acc;
  }, 0);
  const LOG_GAMMA = 7.0;
  const pctVsTarget = (shareDiff) => {
    const v = toNumberLoose(shareDiff);
    if (v == null || v <= 0) return 0;
    const target = Number.isFinite(netDiff) && netDiff > 0 ? netDiff : maxBestSince;
    if (!Number.isFinite(target) || target <= 0) return 0;
    const capped = Math.min(v, target);
    const denom = Math.log10(1 + target);
    if (!Number.isFinite(denom) || denom <= 0) return 0;
    const ratioLog = Math.log10(1 + capped) / denom;
    const pct = Math.pow(Math.max(0, Math.min(1, ratioLog)), LOG_GAMMA) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  const oddsWindow = (() => {
    const raw = (window.__dgbOddsWindow || localStorage.getItem('dgbOddsWindow') || '7d').toLowerCase();
    if (raw === '1m') return { key: '1m', s: 30 * 86400, label: '1 month', short: '1m' };
    if (raw === '1y') return { key: '1y', s: 365 * 86400, label: '1 year', short: '1y' };
    return { key: '7d', s: 7 * 86400, label: '7 days', short: '7d' };
  })();

  const bestByWorker = window.__bestByWorker || (window.__bestByWorker = {});

  for (const m of sortedVisible.slice(0, 50)) {
    const name = m.worker ? String(m.worker) : shortenMiner(m.miner);
    const sub = m.worker ? shortenMiner(m.miner) : '';
    const hrThsRaw = m.hashrate_ths_live_10m != null ? m.hashrate_ths_live_10m : m.hashrate_ths;
    const workerThs = toNumberLoose(hrThsRaw);
    const hr = formatHashrateFromTHS(hrThsRaw);
    const last = formatAge(m.lastShare);
    const bestSinceNum = toNumberLoose(m.bestshare_since_block ?? m.bestShareSinceBlock);
    const bestSinceText = bestSinceNum != null && bestSinceNum > 0 ? formatCompactNumber(bestSinceNum) : '-';
    const bestPct = pctVsTarget(bestSinceNum);
    const bestOver = Number.isFinite(netDiff) && netDiff > 0 && bestSinceNum != null && bestSinceNum > netDiff;
    const bestLinearPct = Number.isFinite(netDiff) && netDiff > 0 && bestSinceNum != null && bestSinceNum > 0 ? (bestSinceNum / netDiff) * 100 : null;
    const bestLinearText = bestLinearPct != null ? `${formatSmallPercent(bestLinearPct)} of target` : 'Log scale';
    const targetText = Number.isFinite(netDiff) && netDiff > 0 ? formatCompactNumber(netDiff) : '-';

    const etaS = workerThs != null && workerThs > 0 && Number.isFinite(netDiff) && netDiff > 0 ? (netDiff * Math.pow(2, 32)) / (workerThs * 1e12) : null;
    const luckFrac = etaS != null && etaS > 0 ? 1 - Math.exp(-oddsWindow.s / etaS) : 0;
    const luckPct = luckFrac * 100;
    const luckText = etaS != null && etaS > 0 ? formatSmallPercent(luckPct) : '-';

    const workerKey = `${m.miner || ''}::${name || ''}`.trim();
    const prevBest = Number(bestByWorker[workerKey] || 0);
    const bestNow = bestSinceNum != null && bestSinceNum > 0 ? bestSinceNum : 0;
    const pulse = bestNow > 0 && bestNow > prevBest * 1.000001;
    if (bestNow > 0) bestByWorker[workerKey] = bestNow;

    const hrPrev = Number(__prevHrByWorker[workerKey] || 0);
    const hrNow = workerThs != null && workerThs > 0 ? Number(workerThs) : 0;
    const hrTick = hrNow > 0 && hrPrev > 0 ? hrNow / hrPrev : 1;
    if (hrNow > 0) __prevHrByWorker[workerKey] = hrNow;

    const recordRatio01 = Number.isFinite(netDiff) && netDiff > 0 && bestNow > 0 ? Math.min(1, bestNow / netDiff) : 0;
    const lastAgeS = ageSFor(m);
    const glaze01 = __updateGlazeLevel({
      workerKey,
      workerThs: hrNow,
      recordRatio01,
      lastAgeS,
      hrTick,
      recordBroke: pulse,
    });
    const glazePct = Math.max(0, Math.min(100, glaze01 * 100));
    const accent = __colorForPct(glazePct);

    const ageTag = Number.isFinite(lastAgeS) ? Number(lastAgeS) : null;
    const isVeryStale = ageTag != null && ageTag > 600;
    const isStale = ageTag != null && ageTag > 90;
    const isSpike = glaze01 > 0.72 || pulse;
    const isGlow = recordRatio01 > 0.05;
    const tag = isVeryStale ? 'sleep' : isStale ? 'idle' : isSpike && isGlow ? 'party' : isSpike ? 'spike' : isGlow ? 'glow' : 'chill';
    __maybeUpdateGlazeMeta({ workerKey, tag, recordBroke: pulse, hrTick, staleS: lastAgeS });
    const meta = __glazeMetaByWorker[workerKey] || {};
    const signalsText = meta.signals && meta.signals.length ? `Signals: ${meta.signals.join(' ')}` : '';
    const explainText = meta.explain && meta.explain.length ? `Why: ${meta.explain.join(', ')}` : '';
    const phrase = __pickGlazePhrase({ workerKey, tag, lastAgeS });

    const left = `
      <div class="min-w-0">
        <div class="truncate font-mono text-white axe-shadow-heavy axe-worker-name">${escapeHtml(name)}</div>
        ${sub ? `<div class="truncate font-mono text-[11px] text-slate-400">${escapeHtml(sub)}</div>` : ''}
      </div>
    `;

    const mid = `
      <div class="axe-worker-mid">
        <div class="axe-worker-mid__k">ODDS</div>
        <div class="axe-worker-mid__v">${escapeHtml(etaS != null && etaS > 0 ? `${luckText} in ${oddsWindow.label}` : '-')}</div>
      </div>
    `;

    const right = `
      <div class="text-right">
        <div class="font-mono text-sm text-white axe-shadow-heavy">${escapeHtml(hr)}</div>
        <div class="font-mono text-[11px] text-slate-400">${escapeHtml(last)}</div>
      </div>
    `;

    const metrics = `
      <div class="axe-worker-metrics">
        <div class="axe-worker-donuts">
          <div class="axe-worker-donut" title="Donut-O-Meter: fun only. Responds to activity, hashrate changes, and record spikes. Not a prediction.">
            <div class="axe-donut axe-donut--luck${pulse ? ' axe-donut--pulse' : ''}" style="--p:${escapeHtml((Math.max(0, Math.min(100, glazePct)) * 3.6).toFixed(2))};--axe-glaze:${escapeHtml(accent)}">
              <div class="axe-donut__meter"></div>
            </div>
            <div class="axe-vibe-card">
              <div class="axe-vibe-card__k">Donut-O-Meter</div>
              <div class="axe-vibe-card__v">Glaze ${escapeHtml(formatSmallPercent(glazePct))}</div>
              ${signalsText ? `<div class="axe-vibe-card__s">${escapeHtml(signalsText)}</div>` : ''}
              ${explainText ? `<div class="axe-vibe-card__s">${escapeHtml(explainText)}</div>` : ''}
              <div class="axe-vibe-card__m">${escapeHtml(phrase)}</div>
            </div>
          </div>
        </div>
        <div class="axe-worker-tracks">
          <div class="axe-worker-tracks__meta">
            <div class="axe-worker-tracks__hint">Log scale</div>
            <div class="axe-worker-tracks__hint">Target ${escapeHtml(targetText)}</div>
          </div>
          <div class="axe-worker-track-row">
            <div class="axe-worker-track-row__label">Record</div>
            <div class="axe-worker-track axe-worker-track--best${bestOver ? ' axe-worker-track--over' : ''}" title="Record share since block vs current network difficulty (log scale)">
              <div class="axe-worker-track__mask" style="left:${bestPct.toFixed(2)}%"></div>
              <div class="axe-worker-track__marker" style="left:${bestPct.toFixed(2)}%" aria-hidden="true"></div>
              <div class="axe-worker-track__coin" aria-hidden="true"></div>
            </div>
          </div>
        </div>
        <div class="axe-worker-metric axe-worker-metric--best" title="Record share since block">
          <div class="axe-worker-metric__label">Record</div>
          <div class="axe-worker-metric__value">${escapeHtml(bestSinceText)}</div>
          <div class="axe-worker-metric__sub">${escapeHtml(bestLinearText)}</div>
          <button type="button" class="axe-worker-metric__pill axe-worker-metric__pill--under js-worker-reset" data-worker-key="${escapeHtml(workerKey)}">Reset...</button>
        </div>
      </div>
    `;

    const el = document.createElement('div');
    el.className = 'axe-worker-item px-3 py-2';
    el.innerHTML = `<div class="axe-worker-head flex items-center justify-between gap-3">${left}${mid}${right}</div>${metrics}`;
    rows.appendChild(el);
  }

  if (sortedVisible.length > 50) {
    const more = document.createElement('div');
    more.className = 'px-3 py-2 text-xs text-slate-400';
    more.textContent = `Showing first 50 of ${sortedVisible.length}.`;
    rows.appendChild(more);
  }

  rows.onclick = (ev) => {
    const t = ev && ev.target;
    const btn = t && t.closest ? t.closest('.js-worker-reset') : null;
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const wk = String(btn.getAttribute('data-worker-key') || '');
    if (!wk) return;
    try {
      delete __glazeStateByWorker[wk];
    } catch {}
    try {
      delete __glazeMetaByWorker[wk];
    } catch {}
    try {
      delete __phraseStateByWorker[wk];
    } catch {}
    // Re-render immediately from last snapshot.
    try {
      renderWorkerDetails(window.__lastWorkers || []);
    } catch {}
  };
}

async function refreshWorkerDetails(algo) {
  try {
    const data = await fetchJsonWithRetry(`/api/pool/miners?algo=${encodeURIComponent(algo || 'sha256')}`, {
      retries: 2,
      delayMs: 300,
    });
    renderWorkerDetails((data && data.miners) || []);
  } catch (err) {
    try {
      console.error('AxeDGB worker details failed:', err);
    } catch {}
    const status = document.getElementById('worker-details-status');
    const rows = document.getElementById('worker-details-rows');
    if (status) {
      const msg = err && typeof err === 'object' && 'message' in err ? String(err.message || '') : '';
      if (msg === 'redirect') {
        status.textContent = 'Worker stats unavailable (auth redirect). Open AxeDGB via the same hostname you used for your OS portal (IP vs hostname).';
      } else if (msg) {
        status.textContent = `Worker stats unavailable (${msg}).`;
      } else {
        status.textContent = 'Worker stats unavailable (app starting).';
      }
    }
    if (rows) rows.innerHTML = '<div class="px-3 py-2 text-xs text-slate-400">-</div>';
  }
}

function blockExplorerUrl(height) {
  const h = Number(height);
  if (!Number.isFinite(h) || h <= 0) return null;
  return `https://chainz.cryptoid.info/dgb/block.dws?${Math.floor(h)}.htm`;
}

function formatBlockStatus(v) {
  const n = Number(v);
  // Miningcore: 0=pending, 1=confirmed, 2=orphaned
  if (n === 1) return 'confirmed';
  if (n === 2) return 'orphaned';
  if (n === 0) return 'pending';
  return String(v ?? '-');
}

let __backscanControlsBound = false;
let __backscanMonthsBuilt = false;
let __backscanState = null;

function ensureBackscanMonthOptions() {
  if (__backscanMonthsBuilt) return;
  __backscanMonthsBuilt = true;

  const sel = document.getElementById('backscan-from-month');
  if (!sel) return;

  const now = new Date();
  for (let i = 0; i < 48; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const value = `${y}-${m}`;
    const label = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
}

function computeBackscanPct(scan) {
  if (!scan || typeof scan !== 'object') return null;
  const nextH = Number(scan.nextHeight);
  const tipH = Number(scan.tipHeightLast || scan.tipHeightAtStart);
  const startH = Number(scan.startHeight);
  const has = Number.isFinite(nextH) && Number.isFinite(tipH) && Number.isFinite(startH) && tipH >= startH;
  if (!has) return null;
  const pct = Math.max(0, Math.min(100, Math.round(((nextH - startH) / Math.max(1, tipH - startH + 1)) * 100)));
  return { pct, nextH, tipH, startH };
}

function getBackscanUiParams() {
  const fromMonth = (document.getElementById('backscan-from-month')?.value || '').trim();
  const speed = (document.getElementById('backscan-speed')?.value || 'normal').trim();
  const payload = { speed };
  if (fromMonth) payload.fromMonth = fromMonth;
  return payload;
}

async function refreshBackscan() {
  try {
    const data = await fetchJson('/api/backscan');
    const scan = data && data.backscan && typeof data.backscan === 'object' ? data.backscan : null;
    __backscanState = scan;
    updateBackscanControls(scan);
  } catch (e) {
    updateBackscanControls(__backscanState);
  }
}

function updateBackscanControls(scan) {
  ensureBackscanMonthOptions();

  const toggleWrap = document.getElementById('backscan-toggle-wrap');
  const toggle = document.getElementById('backscan-enabled');
  const rescan = document.getElementById('backscan-rescan');
  const reset = document.getElementById('backscan-reset');
  const start = document.getElementById('backscan-start');
  const resume = document.getElementById('backscan-resume');
  const pause = document.getElementById('backscan-pause');
  const stop = document.getElementById('backscan-stop');
  const prog = document.getElementById('backscan-progress');
  const bar = document.getElementById('backscan-progressbar');
  const barInner = document.getElementById('backscan-progressbar-inner');
  const fromMonthEl = document.getElementById('backscan-from-month');
  const speedEl = document.getElementById('backscan-speed');

  const complete = Boolean(scan && scan.complete);
  const stale = Boolean(scan && scan.stale);
  const stopRequested = Boolean(scan && scan.stopRequested);
  const stopped = Boolean(scan && scan.stopped === true);
  const enabled = scan ? scan.enabled === true : false;
  const status = scan && typeof scan.status === 'string' ? scan.status : null;
  const error = scan && typeof scan.error === 'string' ? scan.error : null;
  const pctInfo = computeBackscanPct(scan);
  const hasPointers = Boolean(scan && scan.startHeight != null && scan.nextHeight != null);
  const waiting = status === 'waiting';

  const scanFromMonth = scan && scan.fromMonth ? String(scan.fromMonth) : '';
  if (fromMonthEl && scanFromMonth && !String(fromMonthEl.value || '').trim()) {
    fromMonthEl.value = scanFromMonth;
  }
  const scanSpeed = scan && scan.speed ? String(scan.speed) : '';
  if (speedEl && scanSpeed && !String(speedEl.value || '').trim()) {
    speedEl.value = scanSpeed;
  }

  if (prog) {
    const pctLabel = pctInfo ? ` ${pctInfo.pct}% (height ${Math.floor(pctInfo.nextH)} / ${Math.floor(pctInfo.tipH)})` : '';
    if (error) prog.textContent = `Error: ${error}`;
    else if (waiting) prog.textContent = `Waiting for node${pctLabel}`;
    else if (stopRequested || status === 'stopping') prog.textContent = `Stopping${pctLabel}`;
    else if (complete || status === 'complete') prog.textContent = stale ? `Complete (stale)${pctLabel}` : `Complete${pctLabel}`;
    else if (enabled || status === 'running') prog.textContent = `Running${pctLabel}`;
    else if (stopped || status === 'stopped') prog.textContent = `Stopped${pctLabel}`;
    else if (hasPointers) prog.textContent = `Paused${pctLabel}`;
    else prog.textContent = '';
  }

  if (bar && barInner) {
    const show = Boolean(pctInfo) && !error;
    bar.classList.toggle('hidden', !show);
    if (show) barInner.style.width = `${pctInfo.pct}%`;
  }

  if (toggleWrap) toggleWrap.classList.toggle('hidden', complete);
  if (rescan) rescan.classList.toggle('hidden', !complete);
  if (reset) reset.classList.toggle('hidden', !complete);
  // "Start new scan" always restarts pointers using current UI params.
  if (start) start.classList.toggle('hidden', complete || enabled || stopRequested);
  // "Resume" continues from existing pointers.
  if (resume) resume.classList.toggle('hidden', complete || enabled || stopRequested || !hasPointers);
  if (pause) pause.classList.toggle('hidden', complete || !enabled || stopRequested);
  if (stop) stop.classList.toggle('hidden', complete || (!enabled && !stopRequested));

  if (toggle) {
    toggle.checked = Boolean(enabled);
    // Use explicit Rescan/Reset buttons to avoid accidental restarts by clicking the checkbox.
    toggle.disabled = true;
  }

  if (__backscanControlsBound) return;
  __backscanControlsBound = true;

  if (start) {
    start.addEventListener('click', async () => {
      try {
        await postJson('/api/blocks/backscan', { rescan: true, enabled: true, ...getBackscanUiParams() });
      } catch {}
      await refreshBackscan();
      await refreshBlocks();
    });
  }

  if (resume) {
    resume.addEventListener('click', async () => {
      try {
        await postJson('/api/blocks/backscan', { enabled: true, ...getBackscanUiParams() });
      } catch {}
      await refreshBackscan();
      await refreshBlocks();
    });
  }

  if (pause) {
    pause.addEventListener('click', async () => {
      try {
        await postJson('/api/blocks/backscan/pause', {});
      } catch {}
      await refreshBackscan();
      await refreshBlocks();
    });
  }

  if (stop) {
    stop.addEventListener('click', async () => {
      try {
        await postJson('/api/blocks/backscan/stop', {});
      } catch {}
      await refreshBackscan();
      await refreshBlocks();
    });
  }

  if (rescan) {
    rescan.addEventListener('click', async () => {
      try {
        await postJson('/api/blocks/backscan', { rescan: true, ...getBackscanUiParams() });
      } catch {}
      await refreshBackscan();
      await refreshBlocks();
    });
  }

  if (reset) {
    reset.addEventListener('click', async () => {
      if (!confirm('Reset local block history and rescan from your install date?')) return;
      try {
        await postJson('/api/blocks/backscan', { resetAndRescan: true, ...getBackscanUiParams() });
      } catch {}
      await refreshBackscan();
      await refreshBlocks();
    });
  }

  if (fromMonthEl) {
    fromMonthEl.addEventListener('change', async () => {
      try {
        await postJson('/api/blocks/backscan', { ...getBackscanUiParams() });
      } catch {}
      await refreshBackscan();
    });
  }

  if (speedEl) {
    speedEl.addEventListener('change', async () => {
      try {
        await postJson('/api/blocks/backscan', { ...getBackscanUiParams() });
      } catch {}
      await refreshBackscan();
    });
  }
}

function renderBlocksView(payload) {
  const status = document.getElementById('blocks-status');
  const rows = document.getElementById('blocks-rows');
  if (!rows) return;

  const algo = payload && payload.algo ? String(payload.algo) : getAlgo();
  const list = (payload && (payload.events || payload.blocks)) || [];
  const scan = __backscanState || (payload && payload.backscan && typeof payload.backscan === 'object' ? payload.backscan : null);

  updateBackscanControls(scan);

  rows.innerHTML = '';

  if (!Array.isArray(list) || list.length === 0) {
    const pctInfo = computeBackscanPct(scan);
    const enabled = scan ? scan.enabled === true : false;
    const stopRequested = Boolean(scan && scan.stopRequested);
    const stopped = Boolean(scan && scan.stopped === true);
    const scanStatus = scan && typeof scan.status === 'string' ? scan.status : null;
    const waiting = scanStatus === 'waiting';
    const hasScan = (Boolean(pctInfo) || waiting) && !(scan && scan.complete);
    if (status) {
      status.textContent = hasScan
        ? enabled
          ? pctInfo
            ? `No blocks found yet. History scan ${pctInfo.pct}%`
            : `No blocks found yet. History scan running`
          : stopRequested
            ? `No blocks found yet. History scan stopping...`
            : stopped
              ? `No blocks found yet. History scan stopped`
              : waiting
                ? `No blocks found yet. History scan waiting`
                : `No blocks found yet. History scan paused`
        : 'No blocks found yet.';
    }
    const scanLabel = enabled
      ? 'History scan'
      : stopRequested
        ? 'History scan stopping'
        : stopped
          ? 'History scan stopped'
          : waiting
            ? 'History scan waiting'
            : 'History scan paused';
    rows.innerHTML = hasScan
      ? pctInfo
        ? `<div class="px-3 py-3 text-sm text-slate-400">No blocks found yet. ${scanLabel} ${pctInfo.pct}% (height ${Math.floor(pctInfo.nextH)} / ${Math.floor(
            pctInfo.tipH
          )}).</div>`
        : `<div class="px-3 py-3 text-sm text-slate-400">No blocks found yet. ${scanLabel}.</div>`
      : '<div class="px-3 py-3 text-sm text-slate-400">No blocks found yet.</div>';
    return;
  }

  if (status) status.textContent = `${list.length} shown (${algo === 'scrypt' ? 'Scrypt' : 'SHA256d'})`;

  const showWinModal = (b) => {
    try {
      if (!b || typeof b !== 'object') return;
      const hash = b.hash || b.Hash;
      const h = hash ? String(hash) : '';
      if (!h) return;
      const key = `axedgb_celebrated_${algo}_${h}`;
      if (localStorage.getItem(key)) return;
      const modal = document.getElementById('block-win-modal');
      if (!modal) return;

      const subEl = document.getElementById('block-win-sub');
      const heightEl = document.getElementById('block-win-height');
      const minerEl = document.getElementById('block-win-miner');
      const statusEl = document.getElementById('block-win-status');
      const linkEl = document.getElementById('block-win-link');

      const height = b && (b.height || b.blockHeight || b.BlockHeight);
      const st = b && (b.status ?? b.Status);
      const miner = b && (b.miner || b.Miner);
      const worker = b && (b.worker || b.Worker);
      const explorerTx = b && (b.explorer_tx || b.explorerTx);
      const explorerBlock = b && (b.explorer_block || b.explorerBlock);

      const minerLabel = worker ? `${shortenMiner(miner)}.${String(worker)}` : miner ? shortenMiner(miner) : 'solo';
      if (subEl) subEl.textContent = formatWinSubtitle(b);
      if (heightEl) heightEl.textContent = height != null ? String(height) : '-';
      if (minerEl) minerEl.textContent = minerLabel || '-';
      if (statusEl) statusEl.textContent = formatBlockStatus(st);
      if (linkEl) {
        const url = String(explorerTx || explorerBlock || '').trim();
        linkEl.innerHTML = url
          ? `<a class="font-mono text-slate-100 underline decoration-white/20 hover:decoration-white/50" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in explorer</a>`
          : '';
      }

      modal.classList.remove('hidden');
      playWinConfetti(modal);

      const close = () => {
        try {
          modal.classList.add('hidden');
          localStorage.setItem(key, String(Date.now()));
          const confettiEl = document.getElementById('block-win-confetti');
          if (confettiEl) confettiEl.innerHTML = '';
          const cardEl = modal.querySelector('.block-win-card');
          if (cardEl) cardEl.classList.remove('block-win--celebrate');
        } catch {}
      };
      const btn = document.getElementById('block-win-close');
      if (btn) btn.onclick = close;
      modal.onclick = (ev) => {
        if (ev && ev.target === modal) close();
      };
    } catch {}
  };

  for (const b of list) {
    const created = b && (b.t || b.created || b.Created);
    const height = b && (b.height || b.blockHeight || b.BlockHeight);
    const st = b && (b.status ?? b.Status);
    const miner = b && (b.miner || b.Miner);
    const worker = b && (b.worker || b.Worker);
    const hash = b && (b.hash || b.Hash);
    const explorerTx = b && (b.explorer_tx || b.explorerTx);
    const explorerBlock = b && (b.explorer_block || b.explorerBlock);

    const minerLabel = worker
      ? `${shortenMiner(miner)}.${escapeHtml(String(worker))}`
      : miner
        ? shortenMiner(miner)
        : 'solo';
    const timeLabel = created ? formatAge(created) : '-';

    const url = explorerTx || explorerBlock || blockExplorerUrl(height);
    const heightHtml = url
      ? `<a class="font-mono text-slate-100 underline decoration-white/20 hover:decoration-white/50" target="_blank" rel="noreferrer" href="${url}">${escapeHtml(
          String(height ?? '-')
        )}</a>`
      : `<span class="font-mono text-slate-100">${escapeHtml(String(height ?? '-'))}</span>`;

    const hashShort = hash ? `${String(hash).slice(0, 10)}...${String(hash).slice(-8)}` : '-';
    const proofUrl = explorerTx || explorerBlock;
    const proofLine = proofUrl
      ? `<a class="text-slate-100 hover:text-white" style="display:flex;align-items:center;gap:.5rem;" href="${escapeHtml(String(proofUrl))}" target="_blank" rel="noreferrer"><span class="text-xs uppercase tracking-wider text-slate-400">Explorer</span><span class="font-mono underline decoration-white/20 hover:decoration-white/50">${escapeHtml(hashShort)}</span></a>`
      : `<span class="font-mono text-xs text-slate-400">${escapeHtml(hashShort)}</span>`;

    rows.insertAdjacentHTML(
      'beforeend',
      `
      <div class="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
        <div class="col-span-3 text-slate-300">${escapeHtml(timeLabel)}</div>
        <div class="col-span-2">${heightHtml}</div>
        <div class="col-span-2 text-slate-300">${escapeHtml(formatBlockStatus(st))}</div>
        <div class="col-span-5 min-w-0">
          <div class="truncate font-mono text-slate-100">${minerLabel}</div>
          <div class="mt-0.5 truncate">${proofLine}</div>
        </div>
      </div>
      `
    );
  }

  if (Array.isArray(list) && list.length) showWinModal(list[0]);
}

async function refreshBlocks() {
  const status = document.getElementById('blocks-status');
  try {
    if (status) status.textContent = 'Loading...';
    const algo = getAlgo();
    const [blocksRes, scanRes] = await Promise.allSettled([
      fetchJson(`/api/blocks?algo=${encodeURIComponent(algo)}&page=0&pageSize=25`),
      fetchJson('/api/backscan'),
    ]);
    if (scanRes.status === 'fulfilled') {
      const scan = scanRes.value && scanRes.value.backscan && typeof scanRes.value.backscan === 'object' ? scanRes.value.backscan : null;
      __backscanState = scan;
    }
    if (blocksRes.status === 'fulfilled') renderBlocksView(blocksRes.value);
    else renderBlocksView({ blocks: [] });
  } catch (e) {
    if (status) status.textContent = `Error: ${e.message || e}`;
    renderBlocksView({ blocks: [] });
  }
}

function getAlgo() {
  const el = document.getElementById('algo');
  const saved = localStorage.getItem('dgbAlgo');
  if (saved && el && el.value !== saved) el.value = saved;
  return (el && el.value) || saved || 'sha256';
}

function getStratumPort(algo) {
  const ports = window.__stratumPorts || {};
  const p = ports && typeof ports === 'object' ? Number(ports[algo]) : NaN;
  if (Number.isFinite(p) && p > 0) return p;
  return algo === 'scrypt' ? 5679 : 5678;
}

async function refresh() {
  if (window.__refreshInFlight) return;
  window.__refreshInFlight = true;
  try {
  let nodeData = null;
  let poolData = null;
  let nodePillText = 'Offline';
  let nodeIsSynced = false;
  let readinessState = {
    checks: [],
    nodeStatus: 'Offline',
    poolStatus: 'Checking',
    stratumStatus: 'Checking',
    message: 'Checking node and pool readiness.',
    gate: 'Checking current gate.',
    nextStep: 'Wait for the app to finish its first refresh.',
    repair: 'No startup repair recorded.',
  };

  const poolNodeStatusEl = document.getElementById('pool-node-status');
  const poolBackendStatusEl = document.getElementById('pool-backend-status');
  const poolStratumStatusEl = document.getElementById('pool-stratum-status');
  const poolStatusMsgEl = document.getElementById('pool-status-message');

  try {
    const res = await fetch('/api/node', { cache: 'no-store' });
    const node = await res.json().catch(() => ({}));
    if (!res.ok) throw node;
    nodeData = node;
    const warmingUp = Boolean(node && (node.warmup || node.warmupMessage));
    const progress = warmingUp ? 0 : node.verificationprogress || 0;
    const pct = Math.round(progress * 100);
    const ibd = !!node.initialblockdownload;
    const cached = !!node.cached;

    const lastSeen = Number(node.lastSeen) || 0;
    const ageS = lastSeen ? Math.max(0, Math.floor(Date.now() / 1000 - lastSeen)) : 0;
    // Hide "Last seen ..." when data is live; show it only when we're using cached node data.
    const ageText = cached ? (lastSeen ? `Cached ${formatAgo(lastSeen)}` : 'Cached (age unknown)') : '';

    const cacheFreshS = 180;
    const cacheOfflineS = 900;
    const cacheFresh = cached && lastSeen && ageS <= cacheFreshS;
    const cacheStale = cached && lastSeen && ageS > cacheFreshS && ageS <= cacheOfflineS;

    nodeIsSynced = !warmingUp && !ibd && (cacheFresh || cacheStale || !cached);

    if (warmingUp) {
      document.getElementById('sync-text').textContent = node.warmupMessage || 'Starting';
      document.getElementById('sync-subtext').textContent = `${ageText}`.trim();
    } else if (cacheFresh || cacheStale) {
      // If we're serving cached node data due to intermittent RPC failures, keep the UX stable:
      // synced nodes should still read as "Synchronized", not "Running".
      const stateText = ibd ? `Syncing ${pct}%` : `Synchronized ${pct}%`;
      document.getElementById('sync-text').textContent = cacheStale ? `${stateText} (stale)` : stateText;
      document.getElementById('sync-subtext').textContent = `${ageText ? `${ageText} | ` : ''}${node.chain ?? '-'} | ${node.subversion ?? ''}`.trim();
    } else if (cached) {
      document.getElementById('sync-text').textContent = 'Starting';
      document.getElementById('sync-subtext').textContent = `${ageText ? `${ageText} | ` : ''}${node.chain ?? '-'} | ${node.subversion ?? ''}`.trim();
    } else {
      document.getElementById('sync-text').textContent = ibd ? `Syncing ${pct}%` : `Synchronized ${pct}%`;
      document.getElementById('sync-subtext').textContent = `${node.chain ?? '-'} | ${node.subversion ?? ''}`.trim();
    }

    const badgesEl = document.getElementById('sync-badges');
    const etaEl = document.getElementById('sync-eta');
    const lastBlockEl = document.getElementById('last-block');
    const warningsEl = document.getElementById('sync-warnings');

    if (badgesEl) {
      const badges = [];
      if (warmingUp) badges.push('Warmup');
      if (node && (node.reindexRequested || node.reindexRequired)) badges.push('Reindex');
      if (ibd) badges.push('IBD');
      if (node && node.pruned) badges.push('Pruned');
      if (badges.length) {
        badgesEl.innerHTML = badges
          .map((b) => `<span class="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-200">${escapeHtml(b)}</span>`)
          .join('');
      } else {
        badgesEl.innerHTML = '';
      }
    }

    if (etaEl) {
      const etaS = pct >= 100 || warmingUp ? null : computeSyncEtaSeconds(node, 'dgbSyncRate');
      if (etaS && Number.isFinite(etaS) && etaS > 0) {
        etaEl.textContent = `Sync ETA ${formatDuration(etaS)}`;
        etaEl.classList.remove('hidden');
      } else {
        etaEl.textContent = '';
        etaEl.classList.add('hidden');
      }
    }

    if (lastBlockEl) {
      const bestT = Number(node && node.best_block_time);
      const medianT = Number(node && node.median_time);
      const bestOk = Number.isFinite(bestT) && bestT > 0;
      const medOk = Number.isFinite(medianT) && medianT > 0;
      if (bestOk || medOk) {
        const bestAge = bestOk ? formatAgo(bestT * 1000) : '-';
        const medAge = medOk ? formatAgo(medianT * 1000) : '-';
        lastBlockEl.textContent = `Last block ${bestAge}${medOk ? ` | median ${medAge}` : ''}`;
        lastBlockEl.classList.remove('hidden');
      } else {
        lastBlockEl.textContent = '';
        lastBlockEl.classList.add('hidden');
      }
    }

    if (warningsEl) {
      const w = [];
      const peers = Number(node && node.connections);
      if (Number.isFinite(peers) && peers >= 0 && peers < 3) w.push('Low peers');
      const nodeWarn = node && typeof node.warnings === 'string' ? node.warnings.trim() : '';
      if (nodeWarn) w.push(nodeWarn);
      if (w.length) {
        warningsEl.textContent = w.join(' | ');
        warningsEl.classList.remove('hidden');
      } else {
        warningsEl.textContent = '';
        warningsEl.classList.add('hidden');
      }
    }

    document.getElementById('blocks').textContent = node.blocks ?? '-';
    document.getElementById('headers').textContent = node.headers ?? '-';
    const lagEl = document.getElementById('chain-lag');
    const lagSubEl = document.getElementById('chain-lag-sub');
    if (lagEl) {
      const blocksN = Number(node.blocks);
      const headersN = Number(node.headers);
      if (Number.isFinite(blocksN) && Number.isFinite(headersN)) {
        const behind = Math.max(0, headersN - blocksN);
        const ahead = Math.max(0, blocksN - headersN);
        lagEl.textContent = `+${behind} / -${ahead}`;
        if (lagSubEl) lagSubEl.textContent = 'blocks behind / ahead';
      } else {
        lagEl.textContent = '-';
        if (lagSubEl) lagSubEl.textContent = '-';
      }
    }
    document.getElementById('peers').textContent = node.connections ?? '-';
    document.getElementById('mempool').textContent = bytesToMiB(node.mempool_bytes);
    const diskEl = document.getElementById('disk');
    if (diskEl) diskEl.textContent = bytesToGiB(node && node.size_on_disk);
    setRing(progress);

    nodePillText = warmingUp ? 'Starting' : cached && !(cacheFresh || cacheStale) ? 'Starting' : ibd ? 'Syncing' : 'Running';
    if (poolNodeStatusEl) poolNodeStatusEl.textContent = warmingUp ? 'Starting' : ibd ? `Syncing (${pct}%)` : 'Synced';

    readinessState.nodeStatus = warmingUp ? 'Warmup' : ibd ? `Syncing (${pct}%)` : 'Synced';
    readinessState.message = warmingUp
      ? node.warmupMessage || 'Node is warming up.'
      : ibd
      ? `Blockchain sync is still in progress at ${pct}%.`
      : 'Node RPC is online and synced.';
    readinessState.gate = warmingUp
      ? node.warmupMessage || 'Node warmup is still running.'
      : ibd
      ? 'Blockchain sync is still in progress.'
      : 'Node side is ready.';

    try {
      const rep = node && node.bootRepair && typeof node.bootRepair === 'object' ? node.bootRepair : null;
      if (rep && poolStatusMsgEl) {
        const repaired = Boolean(rep.miningcoreRepaired);
        const applied = Boolean(rep.settingsApplied);
        if (repaired && !applied) {
          poolStatusMsgEl.textContent = 'Startup repair ran. If you just saved payout/settings, restart once more to apply.';
        }
      }
      if (rep) {
        const repaired = Boolean(rep.miningcoreRepaired);
        const applied = Boolean(rep.settingsApplied);
        readinessState.repair = repaired
          ? applied
            ? 'Startup repair rebuilt Miningcore config and applied saved settings.'
            : 'Startup repair rebuilt Miningcore config. Restart once if saved settings are still pending.'
          : 'No repair action was needed on the last boot.';
      }
    } catch {}
  } catch (err) {
    const reindexRequired = Boolean(err && err.reindexRequired);
    const reindexRequested = Boolean(err && err.reindexRequested);

    const badgesEl = document.getElementById('sync-badges');
    const etaEl = document.getElementById('sync-eta');
    const lastBlockEl = document.getElementById('last-block');
    const warningsEl = document.getElementById('sync-warnings');
    const diskEl = document.getElementById('disk');
    if (badgesEl) badgesEl.innerHTML = '';
    if (etaEl) {
      etaEl.textContent = '';
      etaEl.classList.add('hidden');
    }
    if (lastBlockEl) {
      lastBlockEl.textContent = '';
      lastBlockEl.classList.add('hidden');
    }
    if (warningsEl) {
      warningsEl.textContent = '';
      warningsEl.classList.add('hidden');
    }
    if (diskEl) diskEl.textContent = '-';
    const lagEl = document.getElementById('chain-lag');
    if (lagEl) lagEl.textContent = '-';
    const lagSubEl = document.getElementById('chain-lag-sub');
    if (lagSubEl) lagSubEl.textContent = '-';

    if (reindexRequired || reindexRequested) {
      document.getElementById('sync-text').textContent = reindexRequired ? 'Reindex required' : 'Reindex scheduled';
      document.getElementById('sync-subtext').textContent = reindexRequired
        ? 'Node was previously pruned. Restart the app to rebuild the database (chainstate reindex).'
        : 'Restart the app to rebuild the database (chainstate reindex).';
    } else {
      document.getElementById('sync-text').textContent = 'Node unavailable';
      document.getElementById('sync-subtext').textContent = 'Node is starting (after reboot) or offline.';
    }
    setRing(0);
    nodePillText = reindexRequired ? 'Reindex' : 'Offline';
    nodeIsSynced = false;
    if (poolNodeStatusEl) poolNodeStatusEl.textContent = reindexRequired ? 'Reindex required' : 'Offline';
    readinessState.nodeStatus = reindexRequired ? 'Reindex required' : 'Offline';
    readinessState.message = reindexRequired
      ? 'Node database needs a reindex before RPC can come online.'
      : 'Node RPC is offline or still starting.';
    readinessState.gate = reindexRequired
      ? 'Node database repair is blocking startup.'
      : 'Node RPC is offline or still starting.';
    readinessState.nextStep = reindexRequired
      ? 'Restart AxeDGB to begin the requested reindex.'
      : 'Wait for DigiByte Core to finish starting, then refresh.';
  }

  let readinessPoolSettings = null;
  let readinessStratum = null;
  let readinessPoolOk = false;
  let readinessPoolMessage = 'Pool backend has not reported yet.';

  try {
    const algo = getAlgo();
    try {
      window.__activeAlgo = algo;
    } catch {}
    const pool = await fetchJson(`/api/pool?algo=${encodeURIComponent(algo)}`);
    poolData = pool;
    const poolErr = pool && (pool.error || pool.Error);
    const poolCached = Boolean(pool && pool.cached);
    readinessPoolOk = !poolErr;
    readinessPoolMessage = poolErr ? String(poolErr) : poolCached ? 'Pool backend is responding from cache.' : 'Pool backend is online.';
    readinessPoolSettings = pool && pool.pool_settings && typeof pool.pool_settings === 'object' ? pool.pool_settings : null;
    readinessStratum = pool && pool.stratum && typeof pool.stratum === 'object' ? pool.stratum : null;
    if (poolBackendStatusEl) {
      poolBackendStatusEl.textContent = poolErr ? 'Error' : poolCached ? 'Running (cached)' : 'Running';
    }

    const stratum = readinessStratum;
    if (poolStratumStatusEl) {
      const st = stratum && typeof stratum.status === 'string' ? stratum.status : 'unknown';
      const label = st === 'open' ? 'OPEN' : st === 'locked' ? 'LOCKED' : st === 'error' ? 'ERROR' : 'UNKNOWN';
      const listen = stratum && Array.isArray(stratum.listenAddresses) && stratum.listenAddresses.length ? ` (${stratum.listenAddresses.join(', ')})` : '';
      poolStratumStatusEl.textContent = `${label}${listen}`;
    }
    if (poolStatusMsgEl) {
      const msg = stratum && typeof stratum.reason === 'string' ? stratum.reason : '';
      poolStatusMsgEl.textContent = msg;
      try {
        const rep = nodeData && nodeData.bootRepair && typeof nodeData.bootRepair === 'object' ? nodeData.bootRepair : null;
        const repaired = rep && Boolean(rep.miningcoreRepaired);
        const applied = rep && Boolean(rep.settingsApplied);
        if (repaired) {
          const suffix = applied ? 'Startup repair applied settings.' : 'Startup repair ran (settings not applied yet).';
          poolStatusMsgEl.textContent = poolStatusMsgEl.textContent ? `${poolStatusMsgEl.textContent} ${suffix}` : suffix;
        }
      } catch {}
    }

    // Remember last successful Stratum "open" state to prevent UI flicker when a single poll fails.
    try {
      const st = stratum && typeof stratum.status === 'string' ? stratum.status : null;
      if (st === 'open') window.__lastStratumOpenAt = Date.now();
    } catch {}

    document.getElementById('workers').textContent = pool.workers ?? '-';
    document.getElementById('hashrate').textContent = formatTHS(pool.hashrate_ths);
    const etaEl = document.getElementById('eta');
    if (etaEl) etaEl.textContent = formatEta(pool && pool.eta_seconds);
    const etaSummary = document.getElementById('eta-summary');
    if (etaSummary) etaSummary.textContent = formatEta(pool && pool.eta_seconds);
    const sh10 = document.getElementById('shares-10m');
    const sh1h = document.getElementById('shares-1h');
    if (sh10) sh10.textContent = String(pool && pool.shares_10m != null ? pool.shares_10m : '-');
    if (sh1h) sh1h.textContent = String(pool && pool.shares_1h != null ? pool.shares_1h : '-');
    document.getElementById('workers-summary').textContent = pool.workers ?? '-';
    document.getElementById('hashrate-summary').textContent = formatTHS(pool.hashrate_ths);

    const diffEl = document.getElementById('difficulty');
    const diffSub = document.getElementById('difficulty-sub');
    if (diffEl) diffEl.textContent = formatCompactNumber(pool && pool.network_difficulty);
    if (diffSub) {
      const height = pool && pool.network_height ? ` | height ${pool.network_height}` : '';
      diffSub.textContent = `${algo === 'scrypt' ? 'Scrypt' : 'SHA256d'}${height}`;
    }

    const diffSummaryEl = document.getElementById('difficulty-summary');
    const diffSummarySub = document.getElementById('difficulty-summary-sub');
    if (diffSummaryEl) diffSummaryEl.textContent = formatCompactNumber(pool && pool.network_difficulty);
    if (diffSummarySub) {
      const height = pool && pool.network_height ? ` | height ${pool.network_height}` : '';
      diffSummarySub.textContent = `${algo === 'scrypt' ? 'Scrypt' : 'SHA256d'}${height}`;
    }

    const bestSinceEl = document.getElementById('best-share-since');
    const bestAllEl = document.getElementById('best-share-all');
    let bestSinceVal = null;
    if (bestSinceEl) {
      const v =
        (pool && (pool.best_share_since_block ?? pool.best_difficulty_since_block)) != null
          ? pool.best_share_since_block ?? pool.best_difficulty_since_block
          : null;
      bestSinceVal = v;
      bestSinceEl.textContent = v == null ? '-' : formatCompactNumber(v);
    }
    if (bestAllEl) {
      const v = (pool && (pool.best_share_all ?? pool.best_difficulty_all)) != null ? pool.best_share_all ?? pool.best_difficulty_all : null;
      bestAllEl.textContent = v == null ? '-' : formatCompactNumber(v);
    }

    const bestSinceWorkerEl = document.getElementById('best-share-since-worker');
    const bestAllWorkerEl = document.getElementById('best-share-all-worker');
    if (bestSinceWorkerEl) bestSinceWorkerEl.textContent = bestSinceVal == null ? '-' : formatBestShareWorkerLabel(pool && pool.best_share_since_block_worker);
    if (bestAllWorkerEl) bestAllWorkerEl.textContent = formatBestShareWorkerLabel(pool && pool.best_share_all_worker);

    try {
      const nd = pool && pool.network_difficulty != null ? Number(pool.network_difficulty) : null;
      if (!window.__networkDifficultyByAlgo || typeof window.__networkDifficultyByAlgo !== 'object') window.__networkDifficultyByAlgo = {};
      if (algo) window.__networkDifficultyByAlgo[algo] = nd;
      window.__networkDifficulty = nd;
    } catch {}

    const banner = document.getElementById('block-found-banner');
    const totalBlocks = Number(pool && pool.total_blocks);
    if (banner && Number.isFinite(totalBlocks) && totalBlocks >= 0) {
      const key = `dgbTotalBlocks_${algo}`;
      const prev = Number(localStorage.getItem(key));
      if (Number.isFinite(prev) && totalBlocks > prev) {
        banner.textContent = `Block found! Total blocks: ${totalBlocks}`;
        banner.classList.remove('hidden');
        setTimeout(() => banner.classList.add('hidden'), 30000);
      }
      localStorage.setItem(key, String(totalBlocks));
    }

    const h = (pool && pool.hashrates_ths) || {};
    const el1m = document.getElementById('hashrate-1m');
    const el5m = document.getElementById('hashrate-5m');
    const el15m = document.getElementById('hashrate-15m');
    const el1h = document.getElementById('hashrate-1h');
    const el6h = document.getElementById('hashrate-6h');
    const el1d = document.getElementById('hashrate-1d');
    const el7d = document.getElementById('hashrate-7d');
    if (el1m) el1m.textContent = formatHashrateFromTHS(h['1m']);
    if (el5m) el5m.textContent = formatHashrateFromTHS(h['5m']);
    if (el15m) el15m.textContent = formatHashrateFromTHS(h['15m']);
    if (el1h) el1h.textContent = formatHashrateFromTHS(h['1h']);
    if (el6h) el6h.textContent = formatHashrateFromTHS(h['6h']);
    if (el1d) el1d.textContent = formatHashrateFromTHS(h['1d']);
    if (el7d) el7d.textContent = formatHashrateFromTHS(h['7d']);

    const lg1m = document.getElementById('legend-1m');
    const lg5m = document.getElementById('legend-5m');
    const lg15m = document.getElementById('legend-15m');
    const lg1h = document.getElementById('legend-1h');
    if (lg1m) lg1m.textContent = formatHashrateFromTHS(h['1m']);
    if (lg5m) lg5m.textContent = formatHashrateFromTHS(h['5m']);
    if (lg15m) lg15m.textContent = formatHashrateFromTHS(h['15m']);
    if (lg1h) lg1h.textContent = formatHashrateFromTHS(h['1h']);

    await refreshWorkerDetails(algo);
  } catch {
    if (poolBackendStatusEl) poolBackendStatusEl.textContent = 'Unavailable';
    if (poolStratumStatusEl) poolStratumStatusEl.textContent = '-';
    if (poolStatusMsgEl) poolStatusMsgEl.textContent = 'Pool is starting or unavailable.';
    document.getElementById('workers').textContent = '-';
    document.getElementById('hashrate').textContent = '-';
    const lastShareEl = document.getElementById('last-share');
    if (lastShareEl) lastShareEl.textContent = '-';
    const etaEl = document.getElementById('eta');
    if (etaEl) etaEl.textContent = '-';
    const etaSummary = document.getElementById('eta-summary');
    if (etaSummary) etaSummary.textContent = '-';
    const sh10 = document.getElementById('shares-10m');
    const sh1h = document.getElementById('shares-1h');
    if (sh10) sh10.textContent = '-';
    if (sh1h) sh1h.textContent = '-';
    document.getElementById('workers-summary').textContent = '-';
    document.getElementById('hashrate-summary').textContent = '-';

    const diffEl = document.getElementById('difficulty');
    const diffSub = document.getElementById('difficulty-sub');
    if (diffEl) diffEl.textContent = '-';
    if (diffSub) diffSub.textContent = '-';

    const diffSummaryEl = document.getElementById('difficulty-summary');
    const diffSummarySub = document.getElementById('difficulty-summary-sub');
    if (diffSummaryEl) diffSummaryEl.textContent = '-';
    if (diffSummarySub) diffSummarySub.textContent = '-';
    const bestSinceEl = document.getElementById('best-share-since');
    const bestAllEl = document.getElementById('best-share-all');
    if (bestSinceEl) bestSinceEl.textContent = '-';
    if (bestAllEl) bestAllEl.textContent = '-';
    const bestSinceWorkerEl = document.getElementById('best-share-since-worker');
    const bestAllWorkerEl = document.getElementById('best-share-all-worker');
    if (bestSinceWorkerEl) bestSinceWorkerEl.textContent = '-';
    if (bestAllWorkerEl) bestAllWorkerEl.textContent = '-';

    const banner = document.getElementById('block-found-banner');
    if (banner) banner.classList.add('hidden');

    const ids = ['hashrate-1m', 'hashrate-5m', 'hashrate-15m', 'hashrate-1h', 'hashrate-6h', 'hashrate-1d', 'hashrate-7d'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    }

    const legendIds = ['legend-1m', 'legend-5m', 'legend-15m', 'legend-1h'];
    for (const id of legendIds) {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    }

    renderWorkerDetails([]);
  }

  {
    const settings = readinessPoolSettings;
    const stratum = readinessStratum;
    const payoutConfigured = Boolean(settings && settings.configured);
    const restartRequired = Boolean((settings && settings.restartRequired) || (stratum && stratum.restartRequired));
    const stratumOpen = Boolean(stratum && stratum.status === 'open');
    const stratumLabel =
      stratum && typeof stratum.status === 'string'
        ? stratum.status === 'open'
          ? 'Open'
          : stratum.status === 'locked'
          ? 'Locked'
          : stratum.status === 'error'
          ? 'Error'
          : 'Unknown'
        : 'Unavailable';
    const poolLabel = readinessPoolOk ? 'Running' : 'Unavailable';
    const syncText = nodeIsSynced ? 'Synchronized' : readinessState.nodeStatus;

    const checks = [
      {
        label: 'Node RPC',
        ok: readinessState.nodeStatus !== 'Offline' && readinessState.nodeStatus !== 'Reindex required',
        value: readinessState.nodeStatus,
        help: readinessState.message,
      },
      {
        label: 'Blockchain sync',
        ok: nodeIsSynced,
        value: syncText,
        help: nodeIsSynced ? 'Chain is synchronized and ready for pool traffic.' : readinessState.gate,
      },
      {
        label: 'Payout address',
        ok: payoutConfigured,
        value: payoutConfigured ? 'Configured' : 'Missing',
        help: payoutConfigured ? 'Block rewards have a payout target.' : 'Set a legacy DigiByte payout address in Settings.',
      },
      {
        label: 'Pending restart',
        ok: !restartRequired,
        value: restartRequired ? 'Restart required' : 'Applied',
        help: restartRequired ? 'Saved settings are waiting for an app restart.' : 'Live config matches saved settings.',
      },
      {
        label: 'Pool backend',
        ok: readinessPoolOk,
        value: poolLabel,
        help: readinessPoolMessage,
      },
      {
        label: 'Stratum',
        ok: stratumOpen,
        value: stratumLabel,
        help:
          stratum && typeof stratum.reason === 'string' && stratum.reason.trim()
            ? stratum.reason.trim()
            : stratumOpen
            ? 'Remote miners can connect.'
            : 'Stratum is not ready for miner connections yet.',
      },
    ];

    const blocked = checks.find((c) => !c.ok);
    const rep = nodeData && nodeData.bootRepair && typeof nodeData.bootRepair === 'object' ? nodeData.bootRepair : null;
    let nextStep = readinessState.nextStep;
    if (!nextStep || nextStep === 'Wait for the app to finish its first refresh.') {
      if (blocked && blocked.label === 'Node RPC') nextStep = 'Wait for DigiByte Core to finish starting, then refresh.';
      else if (blocked && blocked.label === 'Blockchain sync') nextStep = 'Wait for blockchain sync to complete before expecting pool readiness.';
      else if (blocked && blocked.label === 'Payout address') nextStep = 'Set a payout address in Settings, then restart AxeDGB.';
      else if (blocked && blocked.label === 'Pending restart') nextStep = 'Restart AxeDGB from the 5tratumOS Apps page to apply pending settings.';
      else if (blocked && blocked.label === 'Pool backend') nextStep = 'Wait for Miningcore to finish starting and reconnect to the node.';
      else if (blocked && blocked.label === 'Stratum') nextStep = stratum && stratum.reason ? stratum.reason : 'Check Settings and restart AxeDGB if Stratum stays locked.';
      else nextStep = 'Connect miners from the Pool tab once Stratum is open.';
    }

    readinessState = {
      checks,
      nodeStatus: readinessState.nodeStatus,
      poolStatus: poolLabel,
      stratumStatus: stratumLabel,
      message:
        blocked && blocked.help
          ? blocked.help
          : 'Node, pool, and Stratum are all ready.',
      gate:
        blocked && blocked.help
          ? blocked.help
          : 'No blocking condition detected.',
      nextStep,
      repair: rep
        ? readinessState.repair
        : 'No startup repair recorded.',
    };
    renderReadiness(readinessState);
  }

  // Apply final header pill once per refresh (prevents Ready<->Running flicker).
  try {
    const pill = document.getElementById('status-pill');
    if (!pill) return;

    let finalText = nodePillText;
    let ok = false;

    const stratum = poolData && poolData.stratum && typeof poolData.stratum === 'object' ? poolData.stratum : null;
    const st = stratum && typeof stratum.status === 'string' ? stratum.status : 'unknown';

    const lastOpenAt = Number(window.__lastStratumOpenAt || 0);
    const openRecently = lastOpenAt && Date.now() - lastOpenAt < 60 * 1000;

    if (nodePillText === 'Running') {
      if (st === 'open' || openRecently) {
        finalText = 'Ready';
        ok = true;
      } else if (st === 'locked' || st === 'error') {
        finalText = 'UI Online';
        ok = false;
      } else {
        finalText = 'Running';
        ok = true;
      }
    } else {
      ok = nodePillText === 'Running';
    }

    pill.textContent = finalText;
    pill.classList.toggle('axe-pill--ok', ok);
  } catch {}

  // Synced-only warning modal (once per boot).
  try {
    maybeShowStratumWarning(nodeData, poolData, nodeIsSynced);
  } catch {}

  } finally {
    window.__refreshInFlight = false;
  }
}

function maybeShowStratumWarning(node, pool, nodeIsSynced) {
  if (!nodeIsSynced) return;
  if (!pool || typeof pool !== 'object') return;
  const stratum = pool.stratum && typeof pool.stratum === 'object' ? pool.stratum : null;
  if (!stratum) return;
  const st = typeof stratum.status === 'string' ? stratum.status : 'unknown';
  if (!(st === 'locked' || st === 'error')) return;

  const bootId = (node && node.bootId) || (pool && pool.pool_settings && pool.pool_settings.bootId) || '';
  const key = bootId ? `axedgbStratumWarnDismissed_${bootId}` : 'axedgbStratumWarnDismissed';
  if (localStorage.getItem(key) === '1') return;

  const root = document.getElementById('stratum-warn-modal');
  if (!root) return;

  const sub = document.getElementById('stratum-warn-sub');
  const nodeEl = document.getElementById('stratum-warn-node');
  const stEl = document.getElementById('stratum-warn-stratum');
  const actionsEl = document.getElementById('stratum-warn-actions');

  const listen = Array.isArray(stratum.listenAddresses) && stratum.listenAddresses.length ? ` (${stratum.listenAddresses.join(', ')})` : '';
  if (sub) sub.textContent = (stratum.reason || '').toString();
  if (nodeEl) nodeEl.textContent = 'Synced';
  if (stEl) stEl.textContent = `${st.toUpperCase()}${listen}`;

  const steps = [];
  if (st === 'locked') {
    if (stratum.restartRequired) steps.push('Restart the app from the 5tratumOS Apps page to apply settings.');
    if (!stratum.payoutConfigured) steps.push('Set a legacy/base58 payout address in Settings, then restart.');
    if (!steps.length) steps.push('Check Settings and restart the app to unlock Stratum.');
  } else {
    steps.push('Pool error detected. Try restarting the app. If it persists, reinstall AxeDGB.');
  }

  // Memory hint
  try {
    const mem = node && node.memory && typeof node.memory === 'object' ? node.memory : null;
    const total = mem && Number(mem.totalMb);
    const avail = mem && Number(mem.availableMb);
    if (Number.isFinite(total) && total > 0) {
      const low = (Number.isFinite(avail) && avail >= 0 && avail < 1024) || total < 8192;
      if (low) steps.push('Low RAM detected: set Node RAM (dbcache) to 4GB (or Auto on larger systems). This can reduce peak RAM usage during heavy indexing (slower sync).');
    }
  } catch {}

  if (actionsEl) actionsEl.innerHTML = `<ul class="list-disc pl-5 space-y-1">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;

  const close = () => {
    root.classList.add('hidden');
    localStorage.setItem(key, '1');
  };

  const btnClose = document.getElementById('stratum-warn-close');
  const btnOk = document.getElementById('stratum-warn-ok');
  const btnSettings = document.getElementById('stratum-warn-settings');
  if (btnClose) btnClose.onclick = close;
  if (btnOk) btnOk.onclick = close;
  if (btnSettings) {
    btnSettings.onclick = () => {
      try {
        showTab('settings');
      } catch {}
      close();
    };
  }
  root.onclick = (ev) => {
    if (ev && ev.target === root) close();
  };

  root.classList.remove('hidden');
}

function setStratumUrl() {
  const algo = getAlgo();
  const host = window.location && window.location.hostname ? String(window.location.hostname) : '';
  if (!host) return;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return;

  const isIPv4 = (h) => {
    const m = /^(\d{1,3})(?:\.(\d{1,3})){3}$/.exec(h);
    if (!m) return false;
    const parts = h.split('.').map((p) => Number(p));
    return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  };

  const isIPv6 = (h) => {
    if (!h.includes(':')) return false;
    return /^[0-9a-fA-F:]+$/.test(h);
  };

  if (!isIPv4(host) && !isIPv6(host)) return;
  const url = `stratum+tcp://${host}:${getStratumPort(algo)}`;
  const ids = ['stratum-url', 'stratum-url-note'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.textContent = url;
  }
}

setStratumUrl();

const channelPill = document.getElementById('channel-pill');
try {
  const raw = channelPill ? String(channelPill.textContent || '').trim() : '';
  if (channelPill) {
    if (!raw) {
      channelPill.classList.add('hidden');
    } else {
      channelPill.classList.remove('hidden');
      const upper = raw.toUpperCase();
      const kind = upper.startsWith('RC') ? 'rc' : (upper === 'BETA' ? 'beta' : (upper === 'ALPHA' ? 'alpha' : ''));
      channelPill.classList.remove('axe-pill--alpha', 'axe-pill--beta', 'axe-pill--rc');
      if (kind) channelPill.classList.add(`axe-pill--${kind}`);
    }
  }

  const warn = document.getElementById('channel-warning');
  if (warn) {
    const upper = raw.toUpperCase();
    if (!raw) warn.textContent = '';
    else if (upper.startsWith('RC')) warn.textContent = 'RC build: near-stable, expect minor bugs. Verify your payout address.';
    else if (upper === 'BETA') warn.textContent = 'BETA build: expect minor bugs. Verify your payout address.';
    else if (upper === 'ALPHA') warn.textContent = 'ALPHA build: expect bugs and breaking changes. Verify your payout address.';
    else warn.textContent = `${raw} build: verify your payout address.`;
  }
} catch {}
refresh();
setInterval(refresh, 5000);

function shortenImageRef(s) {
  if (!s) return '-';
  const parts = String(s).split('@sha256:');
  if (parts.length === 2) return `${parts[0]}@sha256:${parts[1].slice(0, 12)}...`;
  return s;
}

async function loadPoolSettings() {
  const status = document.getElementById('pool-settings-status');
  const payoutEl = document.getElementById('payout-address');
  const payoutInput = document.getElementById('payoutAddress');
  const minerUser = document.getElementById('miner-username');
  const warn = document.getElementById('payout-warning');
  const mindiffEl = document.getElementById('mindiff');
  const startdiffEl = document.getElementById('startdiff');
  const maxdiffEl = document.getElementById('maxdiff');
  try {
    const s = await fetchJson('/api/pool/settings');
    const addr = (s && s.payoutAddress) || '';
    const configured = Boolean(s && s.configured);
    const warning = (s && s.warning) || '';
    const validationWarning = (s && s.validationWarning) || '';
    const mindiff = Number(s && s.mindiff);
    const startdiff = Number(s && s.startdiff);
    const maxdiff = Number(s && s.maxdiff);

    if (payoutEl) payoutEl.textContent = addr ? addr : 'not set';
    if (payoutInput && payoutInput.value !== addr) payoutInput.value = addr;
    if (status) status.textContent = validationWarning || (configured ? '' : warning || 'Payout address not configured.');
    if (minerUser) minerUser.textContent = configured ? 'rig01.workername' : '(set payout first)';
    if (warn) warn.classList.toggle('hidden', Boolean(addr));
    if (mindiffEl && Number.isFinite(mindiff) && mindiff > 0) mindiffEl.value = String(mindiff);
    if (startdiffEl && Number.isFinite(startdiff) && startdiff > 0) startdiffEl.value = String(startdiff);
    if (maxdiffEl && Number.isFinite(maxdiff) && maxdiff >= 0) maxdiffEl.value = String(maxdiff);
    __syncVardiffPresetFromValues({ mindiff, startdiff, maxdiff });
  } catch {
    if (payoutEl) payoutEl.textContent = 'unavailable';
    if (status) status.textContent = 'Pool settings unavailable (app starting).';
    if (minerUser) minerUser.textContent = 'unavailable';
    if (warn) warn.classList.remove('hidden');
  }
}

function applyVardiffPreset(preset) {
  const mindiffEl = document.getElementById('mindiff');
  const startdiffEl = document.getElementById('startdiff');
  const maxdiffEl = document.getElementById('maxdiff');
  if (!mindiffEl || !startdiffEl || !maxdiffEl) return;

  if (preset === 'mixed') {
    // SHA256 Mixed: protects small miners while staying usable for larger rigs.
    mindiffEl.value = '1024';
    startdiffEl.value = '4096';
    maxdiffEl.value = '131072';
    return;
  }

  if (preset === 'micro') {
    // SHA256 Micro (<= 0.5 TH/s)
    mindiffEl.value = '256';
    startdiffEl.value = '1024';
    maxdiffEl.value = '8192';
    return;
  }

  if (preset === 'small') {
    // SHA256 Home (0.5–2 TH/s)
    mindiffEl.value = '1024';
    startdiffEl.value = '4096';
    maxdiffEl.value = '32768';
    return;
  }

  if (preset === 'home') {
    // SHA256 Home+ (2–5 TH/s)
    mindiffEl.value = '4096';
    startdiffEl.value = '16384';
    maxdiffEl.value = '131072';
    return;
  }

  if (preset === 'farm') {
    // SHA256 Farm (5–20 TH/s)
    mindiffEl.value = '16384';
    startdiffEl.value = '65536';
    maxdiffEl.value = '524288';
    return;
  }

  if (preset === 'mega') {
    // SHA256 Mega (20–200 TH/s)
    mindiffEl.value = '65536';
    startdiffEl.value = '262144';
    maxdiffEl.value = '2097152';
    return;
  }
}

async function loadBackendInfo() {
  const el = document.getElementById('backend-info');
  if (!el) return;
  try {
    const about = await fetchJson('/api/about');
    window.__stratumPorts = about && about.stratumPorts ? about.stratumPorts : window.__stratumPorts;
    window.__networkIp = about && about.networkIp ? about.networkIp : window.__networkIp;
    setStratumUrl();
    const node = about.node;
    const sub = node && node.subversion ? node.subversion : 'node unavailable';
    const dgbd = shortenImageRef(about.images && about.images.dgbd);
    const miningcore = shortenImageRef(about.images && about.images.miningcore);
    const postgres = shortenImageRef(about.images && about.images.postgres);
    const channel = about.channel ? ` | ${about.channel}` : '';
    el.textContent = `Backend: ${sub} | Miningcore (Stratum v1) | DGB: ${dgbd} | miningcore: ${miningcore} | postgres: ${postgres}${channel}`;
  } catch {
    el.textContent = 'Backend info unavailable.';
  }
}

async function loadSettings() {
  try {
    const s = await fetchJson('/api/settings');
    document.getElementById('network').value = s.network || 'mainnet';
    document.getElementById('prune').value = s.prune ?? 0;
    const db = document.getElementById('dbcache');
    if (db) db.value = s.dbcacheMb == null ? 'auto' : String(s.dbcacheMb);
    document.getElementById('settings-status').textContent = '';
  } catch {
    document.getElementById('settings-status').textContent = 'Settings unavailable (node may be starting).';
  }
}

let __vardiffPresetApplying = false;
function __syncVardiffPresetFromValues({ mindiff, startdiff, maxdiff }) {
  const sel = document.getElementById('vardiffPreset');
  if (!sel) return;

  if (!Number.isFinite(mindiff) || !Number.isFinite(startdiff) || !Number.isFinite(maxdiff)) return;

  const key = `${Math.trunc(mindiff)}:${Math.trunc(startdiff)}:${Math.trunc(maxdiff)}`;
  const presets = {
    mixed: '1024:4096:131072',
    micro: '256:1024:8192',
    small: '1024:4096:32768',
    home: '4096:16384:131072',
    farm: '16384:65536:524288',
    mega: '65536:262144:2097152',
  };

  for (const [name, v] of Object.entries(presets)) {
    if (v === key) {
      sel.value = name;
      return;
    }
  }
  sel.value = 'custom';
}

function __maybeFlipPresetToCustom() {
  if (__vardiffPresetApplying) return;
  const sel = document.getElementById('vardiffPreset');
  if (!sel) return;
  if (sel.value === 'custom') return;
  sel.value = 'custom';
}
for (const id of ['mindiff', 'startdiff', 'maxdiff']) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.addEventListener('input', __maybeFlipPresetToCustom);
}

function getTrail() {
  const el = document.getElementById('trail');
  const saved = localStorage.getItem('dgbTrail');
  if (saved && el && el.value !== saved) el.value = saved;
  return (el && el.value) || saved || '30m';
}

async function refreshCharts() {
  const trail = getTrail();
  try {
    const algo = getAlgo();
    const series = await fetchJson(`/api/timeseries/pool?algo=${encodeURIComponent(algo)}&trail=${encodeURIComponent(trail)}`);
    const points = (series && series.points) || [];
    // Ensure charts end at the current live values (series can lag behind after restarts).
    try {
      const live = await fetchJson(`/api/pool?algo=${encodeURIComponent(algo)}`);
      if (live && typeof live === 'object') {
        const patch = (obj) => {
          obj.workers = live.workers;
          obj.hashrate_ths = live.hashrate_ths;
          obj.network_difficulty = live.network_difficulty;
          obj.network_height = live.network_height;
          const h = (live && live.hashrates_ths) || {};
          const setIfValid = (key, field) => {
            const v = h[key];
            if (typeof v === 'number' && Number.isFinite(v)) obj[field] = v;
          };
          setIfValid('1m', 'hashrate_1m_ths');
          setIfValid('5m', 'hashrate_5m_ths');
          setIfValid('15m', 'hashrate_15m_ths');
          setIfValid('1h', 'hashrate_1h_ths');
        };
        if (points.length) patch(points[points.length - 1]);
        else points.push({ t: Date.now(), ...live });
      }
    } catch {
      // ignore
    }
    const workers = points.map((p) => ({ v: Number(p.workers) || 0 }));
    drawSparkline(document.getElementById('chart-workers'), workers, { format: (v) => String(Math.round(v)) });

    const s1m = points.map((p) => ({ v: Number(p.hashrate_1m_ths) }));
    const s5m = points.map((p) => ({ v: Number(p.hashrate_5m_ths) }));
    const s15m = points.map((p) => ({ v: Number(p.hashrate_15m_ths) }));
    const s1h = points.map((p) => ({ v: Number(p.hashrate_1h_ths) }));
    drawSparklineMulti(
      document.getElementById('chart-hashrate'),
      [
        { label: '1m', color: '#00e5ff', points: s1m },
        { label: '5m', color: '#ff2bd6', points: s5m },
        { label: '15m', color: '#ff9a00', points: s15m },
        { label: '1h', color: '#22c55e', points: s1h },
      ],
      { format: (v) => v.toFixed(2) }
    );

    const diffSeries = await fetchJson(
      `/api/timeseries/difficulty?algo=${encodeURIComponent(algo)}&trail=${encodeURIComponent(trail)}`
    );
    const diffPts = ((diffSeries && diffSeries.points) || []).map((p) => ({ v: Number(p.difficulty) }));
    drawSparkline(document.getElementById('chart-difficulty'), diffPts, { format: formatCompactNumber });
  } catch {
    drawSparkline(document.getElementById('chart-workers'), []);
    drawSparklineMulti(document.getElementById('chart-hashrate'), []);
    drawSparkline(document.getElementById('chart-difficulty'), []);
  }
}

let chartInterval = null;
function startChartInterval() {
  if (chartInterval) return;
  chartInterval = setInterval(() => {
    if (window.__activeTab === 'pool') refreshCharts();
  }, 30000);
}

let blocksInterval = null;
function startBlocksInterval() {
  if (blocksInterval) return;
  blocksInterval = setInterval(() => {
    if (window.__activeTab === 'blocks') refreshBlocks();
  }, 30000);
}

document.getElementById('tab-home').addEventListener('click', () => showTab('home'));
document.getElementById('tab-pool').addEventListener('click', async () => {
  showTab('pool');
  startChartInterval();
  await refreshCharts();
  await refresh();
});
document.getElementById('tab-blocks').addEventListener('click', async () => {
  showTab('blocks');
  startBlocksInterval();
  await refreshBlocks();
});
document.getElementById('go-pool').addEventListener('click', async () => {
  showTab('pool');
  startChartInterval();
  await refreshCharts();
  await refresh();
});
document.getElementById('tab-settings').addEventListener('click', async () => {
  showTab('settings');
  await loadSettings();
  await loadPoolSettings();
});
document.getElementById('tab-project').addEventListener('click', () => {
  showTab('project');
});

// Project links, sponsor info, and donation details live under the Project tab.

document.getElementById('trail').addEventListener('change', async () => {
  localStorage.setItem('dgbTrail', document.getElementById('trail').value);
  await refreshCharts();
});

document.getElementById('algo')?.addEventListener('change', async (e) => {
  const v = String(e?.target?.value || 'sha256');
  localStorage.setItem('dgbAlgo', v);
  setStratumUrl();
  await refreshCharts();
  await refresh();
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('settings-status');
  if (status) status.textContent = '';

  const choice = await showActionModal({
    kicker: 'Node Settings',
    title: 'Save node settings?',
    bodyHtml:
      `These settings control how DigiByte Core starts (pruning and memory usage).<br><br>
       Changes apply after restarting AxeDGB.<br><br>
       Restart AxeDGB from the 5tratumOS Apps page to apply changes.`,
    primaryText: 'Save',
    secondaryText: 'Cancel',
  });
  if (choice !== 'primary') return;

  if (status) status.textContent = 'Saving...';
  try {
    const dbcacheEl = document.getElementById('dbcache');
    const rawDbcache = dbcacheEl ? String(dbcacheEl.value || '').trim() : 'auto';
    const dbcacheMb = rawDbcache === 'auto' ? null : Number(rawDbcache);
    const body = {
      network: document.getElementById('network').value,
      prune: Number(document.getElementById('prune').value),
      dbcacheMb,
    };
    const res = await postJson('/api/settings', body);
    if (status) status.textContent = res?.reindexRequired
      ? 'Saved. Restart AxeDGB from 5tratumOS (chainstate reindex will run).'
      : 'Saved. Restart AxeDGB from 5tratumOS to apply.';
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message || err}`;
  }
});

document.getElementById('pool-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('pool-settings-status');
  if (status) status.textContent = '';
  try {
    const payoutAddress = document.getElementById('payoutAddress').value;
    const addrType = looksLikeOtherChainAddress(payoutAddress);

    if (addrType === 'dgb-bech32') {
      await showActionModal({
        kicker: 'Payout Address',
        title: 'This address format is not supported for payouts',
        bodyHtml:
          `This address starts with <span class="font-mono">dgb1</span> (bech32).<br><br>
           Miningcore cannot use <span class="font-mono">dgb1...</span> payout addresses yet, so AxeDGB requires a legacy/Base58 DigiByte address for payouts.<br><br>
           Please generate a legacy address in your wallet (typically starting with <span class="font-mono">D</span> or <span class="font-mono">S</span>) and paste that here.`,
        primaryText: 'OK',
      });
      return;
    }

    if (addrType === 'btc' || addrType === 'bch') {
      await showActionModal({
        kicker: 'Payout Address',
        title: 'This looks like the wrong chain',
        bodyHtml:
          `That payout address looks like a ${addrType.toUpperCase()} address, not DigiByte.<br><br>
           Please enter a DigiByte legacy/Base58 address (typically starting with <span class="font-mono">D</span> or <span class="font-mono">S</span>).`,
        primaryText: 'OK',
      });
      return;
    }

    const parseNumberField = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const raw = String(el.value || '').trim();
      if (!raw) return null;

      // iOS/Safari can include locale formatting (commas, NBSP/narrow-NBSP). Accept those.
      const cleaned = raw.replace(/[\s,_\u00A0\u202F]/g, '');
      if (cleaned.toLowerCase().includes('e')) throw new Error(`${id} must be a number`);

      const n = Number(cleaned);
      if (!Number.isFinite(n)) throw new Error(`${id} must be a number`);
      return n;
    };

    const mindiff = parseNumberField('mindiff');
    const startdiff = parseNumberField('startdiff');
    const maxdiff = parseNumberField('maxdiff');

    const choice = await showActionModal({
      kicker: 'Pool Settings',
      title: 'Save pool settings?',
      bodyHtml:
        `Pool settings are applied on app restart because Miningcore reads its config on startup.<br><br>
         After saving, restart AxeDGB from 5tratumOS to apply the payout address and difficulty changes.`,
      primaryText: 'Save',
      secondaryText: 'Cancel',
    });
    if (choice !== 'primary') return;

    if (status) status.textContent = 'Saving...';
    const body = { payoutAddress, mindiff, startdiff, maxdiff };
    const res = await postJson('/api/pool/settings', body);
    if (status) status.textContent = 'Saved. Restart AxeDGB from 5tratumOS to apply.';
    await loadPoolSettings();
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message || err}`;
  }
});

document.getElementById('vardiffPreset')?.addEventListener('change', (e) => {
  const v = String(e?.target?.value || '');
  __vardiffPresetApplying = true;
  try {
    applyVardiffPreset(v);
  } finally {
    __vardiffPresetApplying = false;
  }
});

function __confirmBestshareReset() {
  const root = document.getElementById('bestshare-reset-modal');
  if (!root) return Promise.resolve(false);
  const okBtn = document.getElementById('bestshare-reset-confirm');
  const cancelBtn = document.getElementById('bestshare-reset-cancel');

  return new Promise((resolve) => {
    const close = (result) => {
      root.classList.add('hidden');
      if (okBtn) okBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      root.onclick = null;
      resolve(result);
    };

    if (okBtn) okBtn.onclick = () => close(true);
    if (cancelBtn) cancelBtn.onclick = () => close(false);
    root.onclick = (e) => {
      if (e && e.target === root) close(false);
    };
    document.addEventListener(
      'keydown',
      (e) => {
        if (e && e.key === 'Escape' && !root.classList.contains('hidden')) close(false);
      },
      { once: true }
    );

    root.classList.remove('hidden');
  });
}

// init
window.__activeTab = 'home';
showTab('home');
startChartInterval();
loadBackendInfo();
loadPoolSettings();
try {
  const open = document.getElementById('bestshare-reset-open');
  if (open) {
    open.addEventListener('click', async () => {
      const ok = await __confirmBestshareReset();
      if (!ok) return;
      try {
        await postJson('/api/pool/bestshare/reset', {});
      } catch {}
      await refresh();
    });
  }
} catch {}
try {
  const box = document.getElementById('workers-show-inactive');
  if (box) {
    box.checked = localStorage.getItem('dgbShowInactiveWorkers') === '1';
    box.addEventListener('change', () => {
      localStorage.setItem('dgbShowInactiveWorkers', box.checked ? '1' : '0');
      renderWorkerDetails(window.__lastWorkers || []);
    });
  }
} catch {}
try {
  const group = document.getElementById('odds-window');
  if (group) {
    const KEY = 'dgbOddsWindow';
    const allowed = new Set(['7d', '1m', '1y']);
    let current = String(localStorage.getItem(KEY) || '7d').toLowerCase();
    if (!allowed.has(current)) current = '7d';
    window.__dgbOddsWindow = current;

    const syncButtons = () => {
      const btns = group.querySelectorAll('.axe-odds-toggle__btn');
      btns.forEach((b) => {
        const w = String(b.getAttribute('data-window') || '').toLowerCase();
        b.classList.toggle('axe-odds-toggle__btn--active', w === window.__dgbOddsWindow);
      });
    };

    group.addEventListener('click', (e) => {
      const t = e && e.target;
      const btn = t && t.closest ? t.closest('.axe-odds-toggle__btn') : null;
      if (!btn) return;
      const w = String(btn.getAttribute('data-window') || '').toLowerCase();
      if (!allowed.has(w)) return;
      window.__dgbOddsWindow = w;
      try {
        localStorage.setItem(KEY, w);
      } catch {}
      syncButtons();
      renderWorkerDetails(window.__lastWorkers || []);
    });

    syncButtons();
  }
} catch {}
try {
  const trail = localStorage.getItem('dgbTrail');
  if (trail) document.getElementById('trail').value = trail;
} catch {}
try {
  const algo = localStorage.getItem('dgbAlgo');
  if (algo && document.getElementById('algo')) document.getElementById('algo').value = algo;
} catch {}
setStratumUrl();
