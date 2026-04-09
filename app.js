/* ─────────────────────────────────────────────
   Geon.checker  –  app.js  (OAuth 2.0)
   ───────────────────────────────────────────── */

// ── OAuth config
const CLIENT_ID = '666157816733-0uu1dkoda0ljjslrd479j371snkj62t7.apps.googleusercontent.com';
const SCOPE      = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// ── Sheet config (고정값)
const SHEET_ID   = '1UJoEBLtUXbEI9MpbS13jELTvhRwsG2jDitA56y8uIvA';
const SHEET_NAME = 'item';

// ── Column mapping (A=0, B=1, …)
const COL = {
  SKU:          0,  // A 품목코드
  CATEGORY:     1,  // B 카테고리
  NAME:         2,  // C 품목명
  OPTION:       3,  // D 옵션
  BARCODE:      4,  // E 품목바코드
  CREATED:      5,  // F 작성일
  BRAND:        6,  // G 브랜드
  PRICE:        7,  // H 가격
  NAVER_NAME:   8,  // I 네이버 스토어 제품명
  NAVER_OPTION: 9,  // J 네이버 스토어 옵션명
  IMAGE_URL:   10,  // K 이미지 URL
  NAVER_URL:   11,  // L 네이버스토어 링크
  SHOPIFY_URL: 12,  // M 쇼피파이 링크
  ALT_BARCODE: 13,  // N 보조바코드
};

// ── State
let sheetData   = [];
let scanning    = false;
let torchOn     = false;
let accessToken = null;
let tokenClient = null;
let tokenExpiry = 0;

// ── Config helpers
const cfg = {
  get: k => localStorage.getItem('gw_' + k) || '',
  set: (k, v) => localStorage.setItem('gw_' + k, v),
};

// ── DOM refs
const $    = id => document.getElementById(id);
const tabs = document.querySelectorAll('.tab');
const views = { scanner: $('scanner-view'), search: $('search-view'), config: $('config-view') };
const modalBg    = $('modal-backdrop');
const toast      = $('toast');
const lockScreen = $('lock-screen');

// ── Boot
function init() {
  bindEvents();
  updateConnectionStatus(false);

  // 기존 서비스워커 모두 해제
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }

  waitForGIS(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: onTokenReceived,
      error_callback: onTokenError,
    });

    const saved = sessionStorage.getItem('gw_token');
    const exp   = parseInt(sessionStorage.getItem('gw_token_exp') || '0');
    if (saved && Date.now() < exp) {
      accessToken = saved;
      tokenExpiry = exp;
      onLoginSuccess();
    } else {
      lockScreen.style.display = 'flex';
    }
  });
}

// 동적 로드 시 DOMContentLoaded가 이미 지났을 수 있으므로 양쪽 처리
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function waitForGIS(cb) {
  if (typeof google !== 'undefined' && google.accounts) cb();
  else setTimeout(() => waitForGIS(cb), 100);
}

// ── OAuth
function startGoogleLogin() {
  $('lock-error').textContent = '';
  $('lock-submit').textContent = '로그인 중...';
  $('lock-submit').disabled = true;
  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: '' });
  } else {
    waitForGIS(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: onTokenReceived,
        error_callback: onTokenError,
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }
}

function onTokenReceived(tokenResponse) {
  if (tokenResponse.error) { onTokenError(tokenResponse); return; }
  accessToken = tokenResponse.access_token;
  tokenExpiry = Date.now() + (tokenResponse.expires_in - 60) * 1000;
  sessionStorage.setItem('gw_token', accessToken);
  sessionStorage.setItem('gw_token_exp', tokenExpiry.toString());
  onLoginSuccess();
}

function onTokenError(err) {
  const msg = err.error === 'access_denied'
    ? '접근이 거부됐어요. 조직 계정으로 로그인해 주세요.'
    : '로그인에 실패했어요. 다시 시도해 주세요.';
  $('lock-error').textContent = msg;
  resetLoginButton();
}

function resetLoginButton() {
  $('lock-submit').innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg> Google 로그인`;
  $('lock-submit').disabled = false;
}

async function onLoginSuccess() {
  lockScreen.style.display = 'none';
  loadConfigInputs();
  updateLoginStatusUI();
  await fetchSheetData(true);
}

function logout() {
  if (accessToken && typeof google !== 'undefined') {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiry = 0;
  sessionStorage.removeItem('gw_token');
  sessionStorage.removeItem('gw_token_exp');
  sheetData = [];
  updateConnectionStatus(false);
  resetLoginButton();
  $('lock-error').textContent = '';
  lockScreen.style.display = 'flex';
  showToast('로그아웃됐어요', '');
}

function updateLoginStatusUI() {
  const el = $('login-status-desc');
  if (!el) return;
  if (accessToken && Date.now() < tokenExpiry) {
    el.textContent = '✅ 로그인됨';
    el.style.color = 'var(--accent)';
  } else {
    el.textContent = '로그인 필요';
    el.style.color = 'var(--text2)';
  }
}

async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiry) return true;
  return new Promise((resolve) => {
    tokenClient.callback = (resp) => {
      if (resp.error) { resolve(false); return; }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      sessionStorage.setItem('gw_token', accessToken);
      sessionStorage.setItem('gw_token_exp', tokenExpiry.toString());
      resolve(true);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ── Tab switching
function bindEvents() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.entries(views).forEach(([k, v]) => v.classList.toggle('active', k === name));
      if (name !== 'scanner' && scanning) stopScanner();
      if (name === 'config') updateLoginStatusUI();
    });
  });

  $('btn-scan').addEventListener('click', () => { if (scanning) stopScanner(); else startScanner(); });
  $('btn-torch').addEventListener('click', toggleTorch);
  $('btn-search-go').addEventListener('click', doSearch);
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('search-input').addEventListener('input', () => {
    const q = $('search-input').value.trim();
    if (q) renderSearchResults(searchRows(q));
    else renderSearchResults([]);
  });
  $('btn-save-config').addEventListener('click', saveConfig);
  $('btn-clear-cache').addEventListener('click', clearCache);
  $('btn-logout').addEventListener('click', () => { if (confirm('로그아웃하시겠어요?')) logout(); });
  $('modal-close').addEventListener('click', closeModal);
  modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });

  let touchStartY = 0;
  $('modal').addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  $('modal').addEventListener('touchend', e => { if (e.changedTouches[0].clientY - touchStartY > 80) closeModal(); }, { passive: true });
}

// ── Google Sheets fetch
async function fetchSheetData(silent = false) {
  
  

  const sheetId = SHEET_ID;
  const sheetName = SHEET_NAME;
  if (!sheetId) {
    if (!silent) showToast('설정에서 스프레드시트 ID를 입력하세요', 'error');
    return false;
  }

  const ok = await ensureToken();
  if (!ok) {
    if (!silent) showToast('로그인이 필요해요', 'error');
    return false;
  }

  const range = encodeURIComponent(`${sheetName}!A2:N`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    const json = await res.json();
    sheetData = json.values || [];
    updateConnectionStatus(true);
    if (!silent) showToast(`${sheetData.length}개 품목 로드 완료`, 'success');
    return true;
  } catch (e) {
    updateConnectionStatus(false);
    if (!silent) showToast('연결 실패: ' + e.message, 'error');
    return false;
  }
}

function updateConnectionStatus(ok) {
  $('conn-dot').className = 'status-dot ' + (ok ? 'ok' : 'err');
  $('conn-text').textContent = ok ? `${sheetData.length}개 품목` : '미연결';
}

// ── Cache & Reset
async function clearCache() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // index.html 자체도 캐시 우회해서 새로 받아옴
    window.location.href = location.pathname + '?v=' + Date.now();
  } catch (e) {
    window.location.href = location.pathname + '?v=' + Date.now();
  }
}

function resetAll() {
  if (!confirm('설정이 모두 삭제됩니다.\n계속하시겠어요?')) return;
  localStorage.clear();
  sessionStorage.clear();
  clearCache();
}

// ── Config
function loadConfigInputs() {
}

async function saveConfig() {
  $('config-status').textContent = '불러오는 중...';
  const ok = await fetchSheetData();
  $('config-status').textContent = ok
    ? `✅ ${sheetData.length}개 품목 로드됨`
    : '❌ 연결 실패';
}

// ── Barcode lookup
function findByBarcode(code) {
  const c = code.trim();
  return sheetData.find(row =>
    (row[COL.BARCODE]     || '').trim() === c ||
    (row[COL.ALT_BARCODE] || '').trim() === c
  ) || null;
}

function findBySku(code) {
  const c = code.trim().toUpperCase();
  return sheetData.find(row => (row[COL.SKU] || '').trim().toUpperCase() === c) || null;
}

function searchRows(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return sheetData.filter(row =>
    (row[COL.NAME]        || '').toLowerCase().includes(q) ||
    (row[COL.SKU]         || '').toLowerCase().includes(q) ||
    (row[COL.BARCODE]     || '').toLowerCase().includes(q) ||
    (row[COL.ALT_BARCODE] || '').toLowerCase().includes(q) ||
    (row[COL.BRAND]       || '').toLowerCase().includes(q) ||
    (row[COL.NAVER_NAME]  || '').toLowerCase().includes(q) ||
    (row[COL.NAVER_OPTION]|| '').toLowerCase().includes(q)
  );
}

// ── Scanner
let html5QrCode = null;

async function startScanner() {
  if (!sheetData.length) {
    const ok = await fetchSheetData();
    if (!ok) return;
  }
  try {
    $('qr-reader').innerHTML = '';
    html5QrCode = new Html5Qrcode('qr-reader');
    const config = {
      fps: 15,
      qrbox: { width: 260, height: 160 },
      aspectRatio: window.innerHeight / window.innerWidth,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ],
    };
    await html5QrCode.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => handleScanResult(decodedText),
      () => {}
    );
    const video = $('qr-reader').querySelector('video');
    if (video) video.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;border-radius:0;';
    scanning = true;
    $('btn-scan').textContent = '스캔 중지';
    $('btn-scan').style.background = 'var(--red)';
  } catch (e) {
    let msg = String(e.message || e);
    if (/permission|notallowed/i.test(msg)) msg = '카메라 권한을 허용해 주세요';
    else if (/notfound|devices/i.test(msg)) msg = '카메라를 찾을 수 없어요';
    showToast('카메라 오류: ' + msg, 'error');
  }
}

async function stopScanner() {
  if (html5QrCode) {
    try { await html5QrCode.stop(); html5QrCode.clear(); } catch (e) {}
    html5QrCode = null;
  }
  $('qr-reader').innerHTML = '';
  scanning = false;
  torchOn  = false;
  $('btn-scan').textContent = '카메라 시작';
  $('btn-scan').style.background = '';
  $('btn-torch').style.display = 'none';
}

async function toggleTorch() {
  if (!html5QrCode) return;
  try {
    torchOn = !torchOn;
    await html5QrCode.applyVideoConstraints({ advanced: [{ torch: torchOn }] });
    $('btn-torch').textContent = torchOn ? '🔦' : '💡';
  } catch (e) {
    showToast('플래시를 지원하지 않는 기기예요', 'error');
    torchOn = false;
  }
}

function handleScanResult(code) {
  if (handleScanResult._last === code && Date.now() - handleScanResult._time < 2000) return;
  handleScanResult._last = code;
  handleScanResult._time = Date.now();
  $('scanner-container').classList.add('scan-success');
  setTimeout(() => $('scanner-container').classList.remove('scan-success'), 400);
  if (navigator.vibrate) navigator.vibrate(50);
  const row = findByBarcode(code) || findBySku(code);
  if (row) openModal(row);
  else showToast(`인식: ${code} — 등록된 제품 없음`, 'error');
}

// ── Search
function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  if (!sheetData.length) { fetchSheetData().then(() => renderSearchResults(searchRows(q))); return; }
  renderSearchResults(searchRows(q));
}

function renderSearchResults(rows) {
  const el = $('search-results');
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">😶</div><div class="empty-title">결과가 없어요</div><div class="empty-desc">다른 검색어로 시도해보세요</div></div>`;
    return;
  }
  el.innerHTML = rows.map((row) => {
    const imgUrl = row[COL.IMAGE_URL] || '';
    const thumb  = imgUrl
      ? `<img class="result-thumb" src="${escHtml(imgUrl)}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><div class="result-thumb-placeholder" style="display:none">📦</div>`
      : `<div class="result-thumb-placeholder">📦</div>`;
    const price = row[COL.PRICE] ? `₩${Number(row[COL.PRICE]).toLocaleString()}` : '';
    const brand = row[COL.BRAND] || '';
    return `<div class="result-item" onclick="openModalByIndex(${sheetData.indexOf(row)})">
      ${thumb}
      <div class="result-info">
        <div class="result-name">${escHtml(row[COL.NAME] || '-')}${row[COL.OPTION] ? `<span class="result-option"> / ${escHtml(row[COL.OPTION])}</span>` : ''}</div>
        <div class="result-meta">
          ${[row[COL.CATEGORY] ? escHtml(row[COL.CATEGORY]) : '', brand ? escHtml(brand) : '', price || ''].filter(Boolean).join(' · ')}
        </div>
        <div class="result-code">${escHtml(row[COL.SKU] || '')}${row[COL.BARCODE] ? ' · ' + escHtml(row[COL.BARCODE]) : ''}${row[COL.ALT_BARCODE] ? ' · ' + escHtml(row[COL.ALT_BARCODE]) : ''}</div>
      </div>
      <div class="result-arrow">›</div>
    </div>`;
  }).join('');
}

function openModalByIndex(idx) { openModal(sheetData[idx]); }

// ── Modal
function openModal(row) {
  const imgUrl  = row[COL.IMAGE_URL] || '';
  const imgWrap = $('modal-image-wrap');
  imgWrap.innerHTML = imgUrl
    ? `<img src="${escHtml(imgUrl)}" onerror="this.parentNode.innerHTML='<div class=\\'product-image-placeholder\\'>📦</div>'" />`
    : `<div class="product-image-placeholder">📦</div>`;

  $('modal-brand').textContent      = row[COL.BRAND]      || '';
  $('modal-name').textContent       = row[COL.NAME]       || '-';
  $('modal-option').textContent     = row[COL.OPTION]     || '';
  $('modal-sku').textContent        = row[COL.SKU]        || '-';
  $('modal-category').textContent   = row[COL.CATEGORY]   || '-';
  $('modal-barcode').textContent    = row[COL.BARCODE]    || '-';
  $('modal-naver-name').textContent = row[COL.NAVER_NAME] || '-';

  const naverOption = row[COL.NAVER_OPTION] || '';
  $('modal-naver-option-wrap').style.display = naverOption ? '' : 'none';
  $('modal-naver-option').textContent = naverOption;

  const altBarcode = row[COL.ALT_BARCODE] || '';
  $('modal-alt-barcode-wrap').style.display = altBarcode ? '' : 'none';
  $('modal-alt-barcode').textContent = altBarcode;

  const price = row[COL.PRICE];
  $('modal-price').textContent = price ? `₩${Number(price).toLocaleString()}` : '';

  const naverUrl   = row[COL.NAVER_URL]   || '';
  const shopifyUrl = row[COL.SHOPIFY_URL] || '';
  $('modal-links').innerHTML = `
    ${naverUrl ? `<a class="link-btn naver" href="${escHtml(naverUrl)}" target="_blank" rel="noopener"><span class="link-btn-icon">🛒</span> 네이버 스토어<span class="link-btn-arrow">↗</span></a>` : `<div class="link-btn disabled"><span class="link-btn-icon">🛒</span> 네이버 스토어 링크 없음</div>`}
    ${shopifyUrl ? `<a class="link-btn shopify" href="${escHtml(shopifyUrl)}" target="_blank" rel="noopener"><span class="link-btn-icon">🛍</span> Shopify<span class="link-btn-arrow">↗</span></a>` : `<div class="link-btn disabled"><span class="link-btn-icon">🛍</span> Shopify 링크 없음</div>`}
  `;
  modalBg.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalBg.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Toast
let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// ── Util
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
