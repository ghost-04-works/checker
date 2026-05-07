/* ─────────────────────────────────────────────
   Geon.checker  –  app.js  (Supabase)
   ───────────────────────────────────────────── */

// ── Supabase config
const SUPABASE_URL = 'https://fnznnrdgvcroiimnokaj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuem5ucmRndmNyb2lpbW5va2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjcxMzUsImV4cCI6MjA5MzYwMzEzNX0.CUQAwydrYUqCGChE_ZUc6t7h0vL_MqGd_e2j4Bqw-UY';

// ── State
let productData = [];
let scanning    = false;
let torchOn     = false;

// ── DOM refs
const $     = id => document.getElementById(id);
const tabs  = document.querySelectorAll('.tab');
const views = { scanner: $('scanner-view'), search: $('search-view'), config: $('config-view') };
const modalBg = $('modal-backdrop');
const toast   = $('toast');

// ── Boot
function init() {
  bindEvents();
  updateConnectionStatus(false);
  fetchSupabaseData(true);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Supabase fetch
async function fetchSupabaseData(silent = false) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=sku_code,category,product_name,option,barcode,barcode_sub,location_code,brand,price,naver_product_name,naver_option_name,image_url,naver_url,shopify_url,notes&is_active=eq.true&order=sku_code`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    productData = await res.json();
    updateConnectionStatus(true);
    if (!silent) showToast(`${productData.length}개 품목 로드 완료`, 'success');
    return true;
  } catch (e) {
    updateConnectionStatus(false);
    if (!silent) showToast('연결 실패: ' + e.message, 'error');
    return false;
  }
}

function updateConnectionStatus(ok) {
  $('conn-dot').className = 'status-dot ' + (ok ? 'ok' : 'err');
  $('conn-text').textContent = ok ? `${productData.length}개 품목` : '미연결';
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
    });
  });

  $('btn-scan').addEventListener('click', () => { if (scanning) stopScanner(); else startScanner(); });
  $('btn-torch').addEventListener('click', toggleTorch);
  $('btn-search-go').addEventListener('click', doSearch);
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  let searchTimer;
  $('search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('search-input').value.trim();
    if (!q) { renderSearchResults([]); return; }
    searchTimer = setTimeout(() => renderSearchResults(searchRows(q)), 150);
  });

  $('btn-refresh').addEventListener('click', async () => {
    $('config-status').textContent = '불러오는 중...';
    const ok = await fetchSupabaseData();
    $('config-status').textContent = ok
      ? `✅ ${productData.length}개 품목 로드됨`
      : '❌ 연결 실패';
  });

  $('btn-clear-cache').addEventListener('click', clearCache);
  $('modal-close').addEventListener('click', closeModal);
  modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });

  // Image zoom
  $('modal-image-wrap').addEventListener('click', openZoom);
  $('img-zoom-overlay').addEventListener('click', closeZoom);

  let touchStartY = 0;
  $('modal').addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  $('modal').addEventListener('touchend', e => { if (e.changedTouches[0].clientY - touchStartY > 80) closeModal(); }, { passive: true });
}

// ── Barcode lookup
function findByBarcode(code) {
  const c = code.trim();
  return productData.find(p =>
    (p.barcode     || '').trim() === c ||
    (p.barcode_sub || '').trim() === c
  ) || null;
}

function findBySku(code) {
  const c = code.trim().toUpperCase();
  return productData.find(p => (p.sku_code || '').trim().toUpperCase() === c) || null;
}

function searchRows(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return productData.filter(p =>
    (p.product_name        || '').toLowerCase().includes(q) ||
    (p.sku_code            || '').toLowerCase().includes(q) ||
    (p.barcode             || '').toLowerCase().includes(q) ||
    (p.barcode_sub         || '').toLowerCase().includes(q) ||
    (p.brand               || '').toLowerCase().includes(q) ||
    (p.option              || '').toLowerCase().includes(q) ||
    (p.naver_product_name  || '').toLowerCase().includes(q) ||
    (p.naver_option_name   || '').toLowerCase().includes(q)
  );
}

// ── Scanner
let html5QrCode = null;

async function startScanner() {
  if (!productData.length) {
    const ok = await fetchSupabaseData();
    if (!ok) return;
  }
  try {
    $('qr-reader').innerHTML = '';
    html5QrCode = new Html5Qrcode('qr-reader');
    const config = {
      fps: 30,
      qrbox: { width: 300, height: 200 },
      aspectRatio: 1.7778,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
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
  const product = findByBarcode(code) || findBySku(code);
  if (product) openModal(product);
  else showToast(`인식: ${code} — 등록된 제품 없음`, 'error');
}

// ── Search
function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  if (!productData.length) { fetchSupabaseData().then(() => renderSearchResults(searchRows(q))); return; }
  renderSearchResults(searchRows(q));
}

function renderSearchResults(rows, showCount = 50) {
  const el = $('search-results');
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">😶</div><div class="empty-title">결과가 없어요</div><div class="empty-desc">다른 검색어로 시도해보세요</div></div>`;
    return;
  }
  window._lastRows = rows;
  const limited   = rows.slice(0, showCount);
  const remaining = rows.length - limited.length;
  const loadMore  = Math.min(50, remaining);
  const footer = remaining > 0
    ? `<button class="btn btn-secondary" style="width:100%;margin-top:4px;" onclick="renderSearchResults(window._lastRows, ${showCount + 50})">+ ${loadMore}개 더 보기 (${remaining}개 남음)</button>`
    : `<div style="text-align:center;padding:12px;font-size:12px;color:var(--text3);">총 ${rows.length}개 검색됨</div>`;
  el.innerHTML = limited.map((p) => {
    const imgUrl = p.image_url || '';
    const thumb  = imgUrl
      ? `<img class="result-thumb" src="${escHtml(imgUrl)}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><div class="result-thumb-placeholder" style="display:none">📦</div>`
      : `<div class="result-thumb-placeholder">📦</div>`;
    const price = p.price ? `₩${Number(p.price).toLocaleString()}` : '';
    const brand = p.brand || '';
    return `<div class="result-item" onclick="openModal(${JSON.stringify(p).replace(/"/g, '&quot;')})">
      ${thumb}
      <div class="result-info">
        <div class="result-name">${escHtml(p.product_name || '-')}${(p.option && p.option.toUpperCase().trim() !== 'N/A') ? `<span class="result-option"> / ${escHtml(p.option)}</span>` : ''}</div>
        <div class="result-meta">
          ${[p.category ? escHtml(p.category) : '', brand ? escHtml(brand) : '', price || ''].filter(Boolean).join(' · ')}
        </div>
        <div class="result-code">${escHtml(p.sku_code || '')}${p.barcode ? ' · ' + escHtml(p.barcode) : ''}${p.barcode_sub ? ' · ' + escHtml(p.barcode_sub) : ''}</div>
      </div>
      <div class="result-arrow">›</div>
    </div>`;
  }).join('') + footer;
}

// ── Modal
function openModal(p) {
  if (typeof p === 'string') p = JSON.parse(p);

  const imgUrl  = p.image_url || '';
  const imgWrap = $('modal-image-wrap');
  imgWrap.innerHTML = imgUrl
    ? `<img src="${escHtml(imgUrl)}" onerror="this.parentNode.innerHTML='<div class=\\'product-image-placeholder\\'>📦</div>'" /><span class="zoom-hint">탭하여 확대 🔍</span>`
    : `<div class="product-image-placeholder">📦</div>`;

  const category = p.category || '';
  const brand    = p.brand    || '';
  $('modal-brand').textContent = [category, brand].filter(Boolean).join(' / ');
  $('modal-name').textContent  = p.product_name || '-';

  const optVal = p.option || '';
  $('modal-option').textContent = (optVal.toUpperCase().trim() === 'N/A') ? '' : optVal;

  const price = p.price ? `₩${Number(p.price).toLocaleString()}` : '';
  $('modal-price-small').textContent = price;

  const notes = p.notes || '';
  $('modal-price').textContent    = notes;
  $('modal-price').style.color    = notes ? 'var(--accent)' : '';
  $('modal-price').style.fontSize = notes ? '18px' : '';

  $('modal-sku').textContent      = p.sku_code      || '-';
  $('modal-location').textContent = p.location_code || '-';
  $('modal-barcode').textContent  = p.barcode        || '-';
  $('modal-naver-name').textContent = p.naver_product_name || '-';

  const naverOption = p.naver_option_name || '';
  $('modal-naver-option-wrap').style.display = naverOption ? '' : 'none';
  $('modal-naver-option').textContent = naverOption;

  const altBarcode = p.barcode_sub || '';
  $('modal-alt-barcode-wrap').style.display = altBarcode ? '' : 'none';
  $('modal-alt-barcode').textContent = altBarcode;

  const naverUrl   = p.naver_url   || '';
  const shopifyUrl = p.shopify_url || '';
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

// ── Image Zoom
function openZoom() {
  const img = $('modal-image-wrap').querySelector('img');
  if (!img) return;
  $('img-zoom-img').src = img.src;
  $('img-zoom-overlay').classList.add('open');
}

function closeZoom() {
  $('img-zoom-overlay').classList.remove('open');
}

// ── Cache & Reset
async function clearCache() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    window.location.href = location.pathname + '?v=' + Date.now();
  } catch (e) {
    window.location.href = location.pathname + '?v=' + Date.now();
  }
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
