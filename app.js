/* ─────────────────────────────────────────────
   GW.checker  –  app.js
   ───────────────────────────────────────────── */

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
  IMAGE_URL:    9,  // J 이미지 URL
  NAVER_URL:   10,  // K 네이버스토어 링크
  SHOPIFY_URL: 11,  // L 쇼피파이 링크
};

// ── State
let sheetData = [];
let scanning  = false;
let torchOn   = false;

// ── Config helpers
const cfg = {
  get: k => localStorage.getItem('gw_' + k) || '',
  set: (k, v) => localStorage.setItem('gw_' + k, v),
};

// ── DOM refs
const $  = id => document.getElementById(id);
const tabs        = document.querySelectorAll('.tab');
const views       = { scanner: $('scanner-view'), search: $('search-view'), config: $('config-view') };
const modalBg     = $('modal-backdrop');
const toast       = $('toast');
const lockScreen  = $('lock-screen');

// ── Boot
window.addEventListener('DOMContentLoaded', () => {
  loadConfigInputs();
  checkLock();
  bindEvents();
  updateConnectionStatus(false);

  // Auto-load data if configured
  if (cfg.get('api_key') && cfg.get('sheet_id')) {
    fetchSheetData();
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ── Lock screen
function checkLock() {
  const pw = cfg.get('password');
  if (!pw) {
    lockScreen.style.display = 'none';
    return;
  }
  const unlocked = sessionStorage.getItem('gw_unlocked');
  if (unlocked === '1') {
    lockScreen.style.display = 'none';
    return;
  }
  lockScreen.style.display = 'flex';
  $('lock-input').focus();
}

$('lock-submit').addEventListener('click', tryUnlock);
$('lock-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

function tryUnlock() {
  const pw = cfg.get('password');
  const val = $('lock-input').value;
  if (val === pw) {
    sessionStorage.setItem('gw_unlocked', '1');
    lockScreen.style.display = 'none';
  } else {
    $('lock-error').textContent = '비밀번호가 틀렸어요';
    $('lock-input').value = '';
    $('lock-input').focus();
    setTimeout(() => { $('lock-error').textContent = ''; }, 2000);
  }
}

// ── Tab switching
function bindEvents() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.entries(views).forEach(([k, v]) => {
        v.classList.toggle('active', k === name);
      });
      if (name !== 'scanner' && scanning) stopScanner();
    });
  });

  // Scanner
  $('btn-scan').addEventListener('click', () => {
    if (scanning) stopScanner();
    else startScanner();
  });

  $('btn-torch').addEventListener('click', toggleTorch);

  // Search
  $('btn-search-go').addEventListener('click', doSearch);
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('search-input').addEventListener('input', () => {
    if ($('search-input').value === '') renderSearchResults([]);
  });

  // Config save
  $('btn-save-config').addEventListener('click', saveConfig);

  // Cache clear
  $('btn-clear-cache').addEventListener('click', clearCache);

  // Full reset
  $('btn-reset-all').addEventListener('click', resetAll);

  // Modal close
  $('modal-close').addEventListener('click', closeModal);
  modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });

  // Swipe down to close modal
  let touchStartY = 0;
  $('modal').addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  $('modal').addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 80) closeModal();
  }, { passive: true });
}

// ── Google Sheets fetch
async function fetchSheetData(silent = false) {
  const apiKey  = cfg.get('api_key');
  const sheetId = cfg.get('sheet_id');
  const sheetName = cfg.get('sheet_name') || 'item';

  if (!apiKey || !sheetId) {
    if (!silent) showToast('설정에서 API 키와 스프레드시트 ID를 먼저 입력하세요', 'error');
    return false;
  }

  const range = encodeURIComponent(`${sheetName}!A2:L`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

  try {
    const res = await fetch(url);
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
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    showToast('캐시 삭제 완료, 새로고침합니다...', 'success');
    setTimeout(() => location.reload(true), 1000);
  } catch (e) {
    showToast('캐시 삭제 실패: ' + e.message, 'error');
  }
}

function resetAll() {
  if (!confirm('설정(API 키, 비밀번호 등)이 모두 삭제됩니다.\n계속하시겠어요?')) return;
  localStorage.clear();
  sessionStorage.clear();
  clearCache();
}

// ── Config
function loadConfigInputs() {
  $('cfg-api-key').value   = cfg.get('api_key');
  $('cfg-sheet-id').value  = cfg.get('sheet_id');
  $('cfg-sheet-name').value = cfg.get('sheet_name') || 'item';
  $('cfg-password').value  = cfg.get('password');
}

async function saveConfig() {
  cfg.set('api_key',    $('cfg-api-key').value.trim());
  cfg.set('sheet_id',   $('cfg-sheet-id').value.trim());
  cfg.set('sheet_name', $('cfg-sheet-name').value.trim() || 'item');
  cfg.set('password',   $('cfg-password').value);

  $('config-status').textContent = '연결 테스트 중...';
  const ok = await fetchSheetData();
  $('config-status').textContent = ok
    ? `✅ 연결 성공 – ${sheetData.length}개 품목`
    : '❌ 연결 실패 – API 키 또는 ID를 확인하세요';
}

// ── Barcode lookup
function findByBarcode(code) {
  const c = code.trim();
  return sheetData.find(row => (row[COL.BARCODE] || '').trim() === c) || null;
}

function findBySku(code) {
  const c = code.trim().toUpperCase();
  return sheetData.find(row => (row[COL.SKU] || '').trim().toUpperCase() === c) || null;
}

function searchRows(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return sheetData.filter(row =>
    (row[COL.NAME]    || '').toLowerCase().includes(q) ||
    (row[COL.SKU]     || '').toLowerCase().includes(q) ||
    (row[COL.BARCODE] || '').toLowerCase().includes(q) ||
    (row[COL.BRAND]   || '').toLowerCase().includes(q) ||
    (row[COL.NAVER_NAME] || '').toLowerCase().includes(q)
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

    // 라이브러리가 생성한 video 스타일 정리
    const video = $('qr-reader').querySelector('video');
    if (video) {
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;border-radius:0;';
    }
    // 라이브러리 기본 UI 숨김
    const defaultUi = $('qr-reader').querySelector('div[style]');
    if (defaultUi) defaultUi.style.border = 'none';

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
  torchOn = false;
  $('btn-scan').textContent = '카메라 시작';
  $('btn-scan').style.background = '';
  $('btn-torch').style.display = 'none';
}

function handleScanResult(code) {
  // Debounce: ignore repeated scans of same code within 2s
  if (handleScanResult._last === code && Date.now() - handleScanResult._time < 2000) return;
  handleScanResult._last = code;
  handleScanResult._time = Date.now();

  // Flash
  $('scanner-container').classList.add('scan-success');
  setTimeout(() => $('scanner-container').classList.remove('scan-success'), 400);

  // Vibrate
  if (navigator.vibrate) navigator.vibrate(50);

  // Find product
  const row = findByBarcode(code) || findBySku(code);
  if (row) {
    openModal(row);
  } else {
    showToast(`인식: ${code} — 등록된 제품 없음`, 'error');
  }
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

// ── Search
function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;

  if (!sheetData.length) {
    fetchSheetData().then(() => renderSearchResults(searchRows(q)));
    return;
  }
  renderSearchResults(searchRows(q));
}

function renderSearchResults(rows) {
  const el = $('search-results');
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">😶</div>
      <div class="empty-title">결과가 없어요</div>
      <div class="empty-desc">다른 검색어로 시도해보세요</div>
    </div>`;
    return;
  }

  el.innerHTML = rows.map((row, i) => {
    const imgUrl = row[COL.IMAGE_URL] || '';
    const thumb = imgUrl
      ? `<img class="result-thumb" src="${escHtml(imgUrl)}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><div class="result-thumb-placeholder" style="display:none">📦</div>`
      : `<div class="result-thumb-placeholder">📦</div>`;

    const price = row[COL.PRICE] ? `₩${Number(row[COL.PRICE]).toLocaleString()}` : '';
    const brand = row[COL.BRAND] || '';

    return `<div class="result-item" data-idx="${i}" onclick="openModalByIndex(${sheetData.indexOf(row)})">
      ${thumb}
      <div class="result-info">
        <div class="result-name">${escHtml(row[COL.NAME] || '-')}</div>
        <div class="result-meta">
          ${brand ? `<span>${escHtml(brand)}</span>` : ''}
          ${price ? `<span>${price}</span>` : ''}
        </div>
        <div class="result-code">${escHtml(row[COL.SKU] || '')} ${row[COL.BARCODE] ? '· ' + escHtml(row[COL.BARCODE]) : ''}</div>
      </div>
      <div class="result-arrow">›</div>
    </div>`;
  }).join('');
}

function openModalByIndex(idx) {
  openModal(sheetData[idx]);
}

// ── Modal
function openModal(row) {
  // Image
  const imgUrl = row[COL.IMAGE_URL] || '';
  const imgWrap = $('modal-image-wrap');
  if (imgUrl) {
    imgWrap.innerHTML = `<img src="${escHtml(imgUrl)}" onerror="this.parentNode.innerHTML='<div class=\\'product-image-placeholder\\'>📦</div>'" />`;
  } else {
    imgWrap.innerHTML = `<div class="product-image-placeholder">📦</div>`;
  }

  // Basic info
  $('modal-brand').textContent    = row[COL.BRAND] || '';
  $('modal-name').textContent     = row[COL.NAME]  || '-';
  $('modal-option').textContent   = row[COL.OPTION] || '';
  $('modal-sku').textContent      = row[COL.SKU]    || '-';
  $('modal-category').textContent = row[COL.CATEGORY] || '-';
  $('modal-barcode').textContent  = row[COL.BARCODE]  || '-';
  $('modal-naver-name').textContent = row[COL.NAVER_NAME] || '-';

  // Price
  const price = row[COL.PRICE];
  $('modal-price').textContent = price ? `₩${Number(price).toLocaleString()}` : '';

  // Links
  const naverUrl   = row[COL.NAVER_URL]   || '';
  const shopifyUrl = row[COL.SHOPIFY_URL] || '';

  $('modal-links').innerHTML = `
    ${naverUrl
      ? `<a class="link-btn naver" href="${escHtml(naverUrl)}" target="_blank" rel="noopener">
           <span class="link-btn-icon">🛒</span> 네이버 스토어
           <span class="link-btn-arrow">↗</span>
         </a>`
      : `<div class="link-btn disabled"><span class="link-btn-icon">🛒</span> 네이버 스토어 링크 없음</div>`
    }
    ${shopifyUrl
      ? `<a class="link-btn shopify" href="${escHtml(shopifyUrl)}" target="_blank" rel="noopener">
           <span class="link-btn-icon">🛍</span> Shopify
           <span class="link-btn-arrow">↗</span>
         </a>`
      : `<div class="link-btn disabled"><span class="link-btn-icon">🛍</span> Shopify 링크 없음</div>`
    }
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
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
