/* ─────────────────────────────────────────────
   Geon.checker  –  app.js  (Supabase)
   ───────────────────────────────────────────── */

// ── Supabase config
const SUPABASE_URL = 'https://yqpskohzmnfiymjrgdxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxcHNrb2h6bW5maXltanJnZHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MjQwMTgsImV4cCI6MjA5NDAwMDAxOH0.D75U1e8JMvVI0K2Ccq5DwOliPg_rt-2uvKse1V2fiqw';

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
    let allData = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/products?select=sku_code,category,product_name,option,barcode,barcode_sub,location_code,brand,price,naver_product_name,naver_option_name,image_url,naver_url,shopify_url,notes,stock,stock_updated_at&is_active=eq.true&order=sku_code`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Range': `${from}-${from + pageSize - 1}`,
            'Range-Unit': 'items',
          }
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batch = await res.json();
      allData = allData.concat(batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    productData = allData;
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
  // 재고 표시 (Supabase stock 컬럼)
  const stockEl = $('modal-stock');
  if (stockEl) {
    const qty = p.stock;
    const formatStockTime = () => {
      if (!p.stock_updated_at) return '';
      const d = new Date(p.stock_updated_at);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return ` | ${hh}:${mm} · ${yyyy}-${mo}-${dd}`;
    };
    if (qty === null || qty === undefined || qty === '') {
      stockEl.textContent = '-';
      stockEl.style.color = 'var(--text3)';
    } else if (qty === 0) {
      stockEl.textContent = '재고 없음' + formatStockTime();
      stockEl.style.color = 'var(--red)';
    } else {
      stockEl.textContent = `${Number(qty).toLocaleString()} EA` + formatStockTime();
      stockEl.style.color = 'var(--accent)';
    }
  }

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

// ── Sellmate 재고 조회 (검색 종료일 당시 재고)
const SELLMATE_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIyIiwianRpIjoiYTBhOWE0MGIxYzRjMjM3ZGNkNGIxNDA1OTJlZDAyMzM1YmZjMTRmOTAyNTcyMjY2MzA1MGEzYThhYjQ4MWY1MGJhMTE2MDc0ZmE3NGIyZTgiLCJpYXQiOjE3ODA1MzA0NjcuNjY1OTMsIm5iZiI6MTc4MDUzMDQ2Ny42NjU5MzMsImV4cCI6MTgxMjA2NjQ2Ny42Mzk2OTgsInN1YiI6Ijc0Iiwic2NvcGVzIjpbIioiXX0.RKZ_XdJ-nCd6GY_-jskjA5m_qnAZaBBf2zni4DL-tNdRx4LhTQ8vj8bJUzc25D89J-m61oGj9e0bNc1ey489fesOyJaJgQdm7YXSqoQgmoT4j0t2NOxRPVn4VFcUx5qnjL3Ymx86w6wEESysHY-jzAntewYicDOuKqAet2NI9HUMw1sHvE6ZadlrDGkcUYiK54gR3PkdEDR-BNpq2X_IYC_Xv6QhCAtNb3ak53NdzwspMcmqwknCiAhuc4KZ0C13tlnwa1pgAxdJ1QsZUTq8DXOjvxrXjSOrLD8JRtAHcb1Lz-Iuwrppsx6CqYvsINSuxT19J38mw-gxkKurzUO9uzEoZWVu5G7_ab-ostQ7BgqZ4uR-27u6Wh65BcfV_h6DMd9iLWvOQGgcwoYyunz9Rxke5Z37osn1fsPVLvA0adPyEdp0ywkWDtU9Y85AWTycUcdFmZ5aNVe--pR9C3NbsRL7QMmlduza-u98v_XMABRycAvSCWQJ4fI5vklXP-KbYg9Jyh8Zj7EYxDfxYHVBWG_IFuCngUpDcpO8SI7aJtdgXInVYpscXN03DUcT8irE-Rs096imP7W2qf9Qs8lyMYWOOrZhz5HApTcDyoTAUqPdheyfTF755zqdh3R4ERN9Bg_4WNqNGu6eo5jvicD4KQ6OWN2pjLLkMHVwcndT3Cg';

async function fetchSellmateStock(barcode) {
  if (!barcode) return null;
  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateFrom = `${yyyy}-${mm}-01`;
    const dateTo = `${yyyy}-${mm}-${dd}`;

    const params = new URLSearchParams({
      'domains[]': 'geon',
      'date_type': 'ordered_at',
      'queries[]': `product_code|contains|${barcode}`,
      'periodic_basis': 'daily',
      'page': 1,
      'per_page': 5,
      'sort': 'revenue|desc',
      'date_from': dateFrom,
      'date_to': dateTo,
    });

    const res = await fetch(
      `https://c-api.sellmate.co.kr/tenant/geon/statistics/products?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${SELLMATE_TOKEN}`,
          'Accept': 'application/json',
          'x-requested-from': 'SMFE',
        }
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.data?.length) return null;

    // 바코드 매칭되는 variant 찾기
    for (const product of json.data) {
      for (const variant of product.variants || []) {
        if ([variant.barcode1, variant.barcode2, variant.barcode3, variant.code, variant.name].includes(barcode)) {
          // periodic_statistics 마지막 항목의 inventory_qty = 검색 종료일 당시 재고
          const periodic = variant.periodic_statistics;
          if (periodic?.length) {
            return periodic[periodic.length - 1].inventory_qty ?? null;
          }
          return variant.statistics?.closing_inventory_qty ?? null;
        }
      }
    }
    // 매칭 없으면 첫 번째 product의 periodic_statistics 마지막값
    const periodic = json.data[0]?.variants?.[0]?.periodic_statistics;
    if (periodic?.length) return periodic[periodic.length - 1].inventory_qty ?? null;
    return json.data[0]?.variants?.[0]?.statistics?.closing_inventory_qty ?? null;
  } catch (e) {
    return null;
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
