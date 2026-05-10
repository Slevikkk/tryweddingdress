const API = '';

let uploadedPhotoId = null;
let selectedDressId = null;
let customDressFile = null;
let catalogData = [];

// activeFilters maps a catalog field key (e.g. 'style', 'color', or future
// 'neckline' / 'fabric') to the currently selected value, or null for "any".
// Built dynamically from whatever fields exist in catalog.json — see
// detectFilterFields() below.
let activeFilters = {};
let activeTryonSource = 'catalog'; // 'catalog' | 'upload'

// ---------------------------------------------------------------------------
// Auth-aware fetch helpers
// ---------------------------------------------------------------------------
// Both /api/upload-photo and /api/try-on require a Supabase JWT. We grab
// it lazily from the active session each call (the SDK refreshes it on
// its own) and reject the action up front when there is no session, so
// users see a friendly modal instead of a 401.
async function getAuthHeader() {
    if (!window.TWD_AUTH) return null;
    const session = await window.TWD_AUTH.getSession();
    if (!session || !session.access_token) return null;
    return 'Bearer ' + session.access_token;
}

async function authedFetch(url, options) {
    const auth = await getAuthHeader();
    if (!auth) {
        return { __authMissing: true };
    }
    options = options || {};
    options.headers = Object.assign({}, options.headers || {}, {
        Authorization: auth,
    });
    return fetch(API + url, options);
}

function openAuthRequiredModal() {
    const modal = document.getElementById('auth-required-modal');
    if (modal) modal.style.display = 'flex';
}

function closeAuthRequiredModal() {
    const modal = document.getElementById('auth-required-modal');
    if (modal) modal.style.display = 'none';
}

function openOutOfCreditsModal() {
    const modal = document.getElementById('out-of-credits-modal');
    if (modal) modal.style.display = 'flex';
}

function closeOutOfCreditsModal() {
    const modal = document.getElementById('out-of-credits-modal');
    if (modal) modal.style.display = 'none';
}

function goToLoginWithReturn() {
    const next = encodeURIComponent(window.location.pathname + window.location.hash);
    window.location.href = '/login.html?next=' + next;
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    window.scrollTo(0, 0);
}

async function loadExamples() {
    // Static JSON bundled with the site (Cloudflare Pages has no backend);
    // images are served from /examples/* by the Pages deploy itself.
    try {
        const res = await fetch('/api/examples.json', { cache: 'no-cache' });
        const examples = await res.json();
        const grid = document.getElementById('examples-grid');
        if (!grid) return;
        grid.innerHTML = examples.map((ex, idx) => `
            <div class="example-card">
                <div class="ba-slider" data-slider-idx="${idx}" data-start="50">
                    <img class="ba-slider-img ba-slider-after" src="${ex.after}" alt="После" loading="lazy">
                    <img class="ba-slider-img ba-slider-before" src="${ex.before}" alt="До" loading="lazy">
                    <div class="ba-slider-handle" tabindex="0" role="slider" aria-label="Сдвиньте, чтобы сравнить До и После" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
                        <div class="ba-slider-thumb" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <polyline points="9 6 3 12 9 18"></polyline>
                                <polyline points="15 6 21 12 15 18"></polyline>
                            </svg>
                        </div>
                    </div>
                    <span class="ba-slider-label ba-slider-label-before">До</span>
                    <span class="ba-slider-label ba-slider-label-after">После</span>
                </div>
            </div>
        `).join('');

        grid.querySelectorAll('.ba-slider').forEach(initBaSlider);
    } catch (e) {
        console.error('Failed to load examples:', e);
    }
}

// ------------------------------------------------------------------
// Before/after slider
// ------------------------------------------------------------------
function initBaSlider(slider) {
    const before = slider.querySelector('.ba-slider-before');
    const handle = slider.querySelector('.ba-slider-handle');
    if (!before || !handle) return;

    const startPct = parseFloat(slider.dataset.start || '50');
    setSliderPosition(before, handle, startPct);

    let dragging = false;

    function getPctFromEvent(e) {
        const rect = slider.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        return Math.max(0, Math.min(100, (x / rect.width) * 100));
    }

    function onPointerDown(e) {
        dragging = true;
        slider.classList.add('ba-slider-dragging');
        const pct = getPctFromEvent(e);
        setSliderPosition(before, handle, pct);
        e.preventDefault();
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const pct = getPctFromEvent(e);
        setSliderPosition(before, handle, pct);
    }
    function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        slider.classList.remove('ba-slider-dragging');
    }

    slider.addEventListener('mousedown', onPointerDown);
    slider.addEventListener('touchstart', onPointerDown, { passive: false });
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('touchmove', onPointerMove, { passive: true });
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('touchcancel', onPointerUp);

    handle.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 10 : 4;
        const current = parseFloat(handle.style.left) || 50;
        if (e.key === 'ArrowLeft') {
            setSliderPosition(before, handle, current - step);
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            setSliderPosition(before, handle, current + step);
            e.preventDefault();
        } else if (e.key === 'Home') {
            setSliderPosition(before, handle, 0);
            e.preventDefault();
        } else if (e.key === 'End') {
            setSliderPosition(before, handle, 100);
            e.preventDefault();
        }
    });
}

function setSliderPosition(before, handle, pct) {
    pct = Math.max(0, Math.min(100, pct));
    // clip-path: inset(top right bottom left) — we hide everything to the
    // RIGHT of `pct`, i.e. inset right by (100 - pct)%. So as pct grows,
    // more of the "before" image is revealed from the left.
    before.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    handle.style.left = pct + '%';
    handle.setAttribute('aria-valuenow', String(Math.round(pct)));
}

async function loadCatalog() {
    try {
        const res = await fetch('/api/catalog.json', { cache: 'no-cache' });
        catalogData = await res.json();
        buildFilters();
        renderCatalog();
    } catch (e) {
        console.error('Failed to load catalog:', e);
    }
}

// ---------------------------------------------------------------------------
// Data-driven catalog filters
// ---------------------------------------------------------------------------
// Today catalog.json items only have `style` and `color`. Tomorrow we expect
// `silhouette`, `length`, `neckline`, `sleeves`, `fabric`, `details` etc. when
// the catalog gets reworked around Russian dress brands. The filter UI is
// built from whatever categorical fields actually appear in the data, so a
// new field automatically gets a new accordion without touching any code.

const FILTER_FIELD_BLACKLIST = new Set([
    'id', 'name', 'name_en', 'name_ru', 'description',
    'image', 'image_url', 'price', 'currency',
    'source', 'source_url',
]);

// Per-field display config: human label + value translations. Falls back to
// auto-derived label and the raw value if the field is unknown.
const FILTER_FIELD_CONFIG = {
    vendor: { label: 'Бренд' },
    brand: { label: 'Бренд' },
    style: { label: 'Силуэт', valueLabels: () => STYLE_RU },
    color: { label: 'Цвет', valueLabels: () => COLOR_RU },
    silhouette: { label: 'Силуэт' },
    length: { label: 'Длина' },
    neckline: { label: 'Вырез' },
    sleeves: { label: 'Рукава' },
    fabric: { label: 'Ткань' },
    details: { label: 'Детали' },
    fit: { label: 'Посадка' },
};

function detectFilterFields(items) {
    if (!items || items.length === 0) return [];
    // Keys appear in insertion order; iterate every item so we don't miss
    // fields that are only set on some dresses (common after schema migration).
    const seen = new Map(); // key -> Set<string>
    for (const item of items) {
        for (const key of Object.keys(item)) {
            if (FILTER_FIELD_BLACKLIST.has(key)) continue;
            const v = item[key];
            if (v == null || v === '') continue;
            if (typeof v !== 'string') continue;
            if (!seen.has(key)) seen.set(key, new Set());
            seen.get(key).add(v);
        }
    }
    const fields = [];
    for (const [key, values] of seen.entries()) {
        // Single-value fields are useless as filters; >15 values clutter UI.
        if (values.size < 2 || values.size > 15) continue;
        fields.push({ key, values: [...values].sort() });
    }
    return fields;
}

function fieldLabel(key) {
    const cfg = FILTER_FIELD_CONFIG[key];
    if (cfg && cfg.label) return cfg.label;
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

function fieldValueLabel(key, value) {
    const cfg = FILTER_FIELD_CONFIG[key];
    if (cfg && cfg.valueLabels) {
        const map = cfg.valueLabels();
        if (map && Object.prototype.hasOwnProperty.call(map, value)) {
            return map[value];
        }
    }
    return value;
}

function buildFilters() {
    const fields = detectFilterFields(catalogData);
    activeFilters = {};
    for (const f of fields) activeFilters[f.key] = null;

    const container = document.getElementById('catalog-accordions');
    if (!container) return;
    container.innerHTML = fields.map((f, idx) => renderAccordion(f, idx === 0)).join('');
    renderSummary();
}

function renderAccordion(field, openByDefault) {
    const optionsHtml = field.values.map(v => `
        <button type="button" class="filter-option" data-value="${escapeAttr(v)}" onclick="setFilterValue('${escapeAttr(field.key)}', '${escapeAttr(v)}', this)">
            ${escapeHtml(fieldValueLabel(field.key, v))}
        </button>
    `).join('');
    return `
        <div class="filter-accordion${openByDefault ? ' is-open' : ''}" data-field="${escapeAttr(field.key)}">
            <button type="button" class="filter-accordion-head" onclick="toggleAccordion('${escapeAttr(field.key)}')">
                <span class="filter-accordion-label">${escapeHtml(fieldLabel(field.key))}</span>
                <span class="filter-accordion-value" id="accordion-value-${escapeAttr(field.key)}"><em>любой</em></span>
                <svg class="filter-accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </button>
            <div class="filter-accordion-body">
                <button type="button" class="filter-option is-active" data-value="" onclick="setFilterValue('${escapeAttr(field.key)}', null, this)">
                    Любой
                </button>
                ${optionsHtml}
            </div>
        </div>
    `;
}

function toggleAccordion(key) {
    const el = document.querySelector(`.filter-accordion[data-field="${cssEscape(key)}"]`);
    if (el) el.classList.toggle('is-open');
}

function setFilterValue(key, value, btn) {
    activeFilters[key] = value;

    const accordion = document.querySelector(`.filter-accordion[data-field="${cssEscape(key)}"]`);
    if (accordion) {
        accordion.querySelectorAll('.filter-option').forEach(b => b.classList.remove('is-active'));
        if (btn) btn.classList.add('is-active');
        const valueEl = accordion.querySelector('.filter-accordion-value');
        if (valueEl) {
            valueEl.innerHTML = (value == null || value === '')
                ? '<em>любой</em>'
                : escapeHtml(fieldValueLabel(key, value));
        }
    }

    renderCatalog();
    renderSummary();
}

function resetCatalogFilters() {
    for (const key of Object.keys(activeFilters)) activeFilters[key] = null;
    document.querySelectorAll('.filter-accordion').forEach(a => {
        a.querySelectorAll('.filter-option').forEach(o => o.classList.remove('is-active'));
        const first = a.querySelector('.filter-option');
        if (first) first.classList.add('is-active');
        const valueEl = a.querySelector('.filter-accordion-value');
        if (valueEl) valueEl.innerHTML = '<em>любой</em>';
    });
    renderCatalog();
    renderSummary();
}

function renderSummary() {
    const container = document.getElementById('catalog-summary');
    if (!container) return;
    const keys = Object.keys(activeFilters);
    if (keys.length === 0) {
        container.innerHTML = '';
        return;
    }
    const rows = keys.map(key => {
        const v = activeFilters[key];
        const display = (v == null || v === '')
            ? '<em>любой</em>'
            : escapeHtml(fieldValueLabel(key, v));
        const checked = (v == null || v === '') ? '○' : '✓';
        return `
            <div class="catalog-summary-row${(v == null || v === '') ? '' : ' is-set'}">
                <span class="catalog-summary-bullet" aria-hidden="true">${checked}</span>
                <span class="catalog-summary-key">${escapeHtml(fieldLabel(key))}</span>
                <span class="catalog-summary-val">${display}</span>
            </div>
        `;
    }).join('');
    container.innerHTML = rows;
}

function renderCatalog() {
    const filtered = catalogData.filter(d => {
        for (const key of Object.keys(activeFilters)) {
            const want = activeFilters[key];
            if (want == null || want === '') continue;
            if (d[key] !== want) return false;
        }
        return true;
    });

    const grid = document.getElementById('dress-catalog');
    if (!grid) return;
    if (filtered.length === 0) {
        grid.innerHTML = '<p class="no-results">Под выбранные параметры платьев пока нет — попробуйте сбросить фильтры.</p>';
        return;
    }
    grid.innerHTML = filtered.map(dress => `
        <div class="dress-card ${selectedDressId === dress.id ? 'selected' : ''}" data-id="${escapeAttr(dress.id)}" onclick="openDressModal('${escapeAttr(dress.id)}')">
            <span class="selected-badge">Выбрано</span>
            <span class="zoom-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg>
            </span>
            <img src="${escapeAttr(dress.image_url)}" alt="${escapeAttr(dressNamePrimary(dress))}" loading="lazy">
            <div class="dress-info">
                <div class="dress-name">${escapeHtml(dressNamePrimary(dress))}</div>
                ${dressNameSecondary(dress) ? `<div class="dress-name-en">${escapeHtml(dressNameSecondary(dress))}</div>` : ''}
                <div class="dress-meta">
                    <span class="dress-color" style="background:${getColorHex(dress.color)}"></span>
                    ${escapeHtml(colorLabel(dress.color))} · ${escapeHtml(styleLabel(dress.style))}
                </div>
            </div>
        </div>
    `).join('');
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
}
function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Tabs: Catalog vs custom upload
// ---------------------------------------------------------------------------
function setTryonSource(source) {
    if (source !== 'catalog' && source !== 'upload') return;
    activeTryonSource = source;
    document.querySelectorAll('.tryon-source-tab').forEach(t => {
        const isActive = t.dataset.source === source;
        t.classList.toggle('is-active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.tryon-source-pane').forEach(p => {
        const isActive = p.dataset.source === source;
        p.classList.toggle('is-active', isActive);
        if (isActive) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
    updateGenerateBtn();
}

let modalDressId = null;

function openDressModal(id) {
    const dress = catalogData.find(d => d.id === id);
    if (!dress) return;
    modalDressId = id;
    document.getElementById('modal-img').src = dress.image_url;
    document.getElementById('modal-img').alt = dressNamePrimary(dress);
    document.getElementById('modal-name').textContent = dressNamePrimary(dress);
    const modalNameEn = document.getElementById('modal-name-en');
    if (modalNameEn) {
        const en = dressNameSecondary(dress);
        modalNameEn.textContent = en;
        modalNameEn.style.display = en ? '' : 'none';
    }
    document.getElementById('modal-color').textContent = colorLabel(dress.color);
    document.getElementById('modal-color-swatch').style.background = getColorHex(dress.color);
    document.getElementById('modal-style').textContent = styleLabel(dress.style);
    document.getElementById('modal-description').textContent = dress.description || '';

    // Vendor pill
    const vendorPill = document.getElementById('modal-vendor-pill');
    if (dress.vendor) {
        document.getElementById('modal-vendor').textContent = dress.vendor;
        vendorPill.style.display = '';
    } else {
        vendorPill.style.display = 'none';
    }

    // Price pill
    const pricePill = document.getElementById('modal-price-pill');
    if (dress.price) {
        const cur = dress.currency || 'USD';
        const symbol = cur === 'USD' ? '$' : cur + ' ';
        document.getElementById('modal-price').textContent = `${symbol}${Math.round(dress.price)}`;
        pricePill.style.display = '';
    } else {
        pricePill.style.display = 'none';
    }

    // Retailer link + attribution
    const sourceLink = document.getElementById('modal-source-link');
    const attribution = document.getElementById('modal-attribution');
    if (dress.source_url) {
        sourceLink.href = dress.source_url;
        const retailerName = (dress.source && dress.source.includes('davidsbridal')) ? "David's Bridal" : (dress.source || 'retailer');
        sourceLink.innerHTML = `Открыть на ${retailerName} &rarr;`;
        sourceLink.style.display = '';
        attribution.innerHTML = `Фото и описание предоставлены <a href="${dress.source_url}" target="_blank" rel="noopener">${retailerName}</a>. Используются в демонстрационных целях.`;
        attribution.style.display = '';
    } else {
        sourceLink.style.display = 'none';
        attribution.style.display = 'none';
    }

    const btn = document.querySelector('.modal-select-btn');
    btn.textContent = (selectedDressId === id) ? 'Выбрано — закрыть' : 'Выбрать это платье';
    document.getElementById('dress-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeDressModal(e) {
    if (e && e.target && e.target.id !== 'dress-modal' && e.type !== 'click') return;
    document.getElementById('dress-modal').style.display = 'none';
    document.body.style.overflow = '';
    modalDressId = null;
}

function selectDressFromModal() {
    if (!modalDressId) return;
    selectedDressId = modalDressId;
    customDressFile = null;
    const customPreview = document.getElementById('custom-dress-preview');
    if (customPreview) customPreview.style.display = 'none';
    document.querySelectorAll('.dress-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.id === selectedDressId);
    });
    updateGenerateBtn();
    closeDressModal();
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('dress-modal').style.display === 'flex') {
        closeDressModal();
    }
});

function getColorHex(color) {
    const map = {
        'White': '#FFFFFF',
        'Ivory': '#FFFFF0',
        'Champagne': '#F7E7CE',
        'Blush': '#FFB6C1',
        'Pink': '#FF69B4',
        'Coral': '#FF7F50',
        'Navy Blue': '#000080',
    };
    return map[color] || '#CCCCCC';
}

const COLOR_RU = {
    'White': 'Белый',
    'Ivory': 'Айвори',
    'Champagne': 'Шампань',
    'Blush': 'Блаш',
    'Pink': 'Розовый',
    'Coral': 'Коралловый',
    'Navy Blue': 'Тёмно-синий',
};
const STYLE_RU = {
    'A-Line': 'А-силуэт',
    'Mermaid': '«Русалка»',
    'Sheath': 'Прямой',
    'Ball Gown': 'Бальное',
};
function colorLabel(color) { return COLOR_RU[color] || color; }
function styleLabel(style) { return STYLE_RU[style] || style; }
function dressNamePrimary(dress) { return dress.name_ru || dress.name; }
function dressNameSecondary(dress) { return dress.name_ru ? dress.name : ''; }

function selectDress(id, el) {
    selectedDressId = id;
    customDressFile = null;
    document.getElementById('custom-dress-preview').style.display = 'none';
    document.querySelectorAll('.dress-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    updateGenerateBtn();
}

// Proactive auth guard. authedFetch's reactive 401 handler still works as a
// safety net, but checking here means signed-out users see the modal *before*
// the request goes out — friendlier and works even if the API is offline.
async function ensureSignedIn() {
    const auth = await getAuthHeader();
    if (!auth) {
        openAuthRequiredModal();
        return false;
    }
    return true;
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}
function handleDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}
function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    ensureSignedIn().then(ok => { if (ok) uploadPhoto(files[0]); });
}

function handlePhotoUpload(e) {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    ensureSignedIn().then(ok => {
        if (ok) {
            uploadPhoto(file);
        } else {
            // Reset file input so the user can re-trigger after sign-in.
            e.target.value = '';
        }
    });
}

async function uploadPhoto(file) {
    const formData = new FormData();
    formData.append('file', file);

    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('preview-img').src = e.target.result;
        document.getElementById('upload-placeholder').style.display = 'none';
        document.getElementById('upload-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);

    try {
        const res = await authedFetch('/api/upload-photo', { method: 'POST', body: formData });
        if (res && res.__authMissing) {
            openAuthRequiredModal();
            removePhoto();
            return;
        }
        if (res.status === 401) {
            openAuthRequiredModal();
            removePhoto();
            return;
        }
        if (!res.ok) {
            const err = await res.json().catch(function () { return {}; });
            alert('Не удалось загрузить фото: ' + (err.detail || res.statusText));
            removePhoto();
            return;
        }
        const data = await res.json();
        uploadedPhotoId = data.file_id;
        updateGenerateBtn();
    } catch (e) {
        alert('Не удалось загрузить фото. Попробуйте ещё раз.');
        removePhoto();
    }
}

function removePhoto() {
    uploadedPhotoId = null;
    document.getElementById('preview-img').src = '';
    document.getElementById('upload-placeholder').style.display = 'block';
    document.getElementById('upload-preview').style.display = 'none';
    document.getElementById('photo-input').value = '';
    updateGenerateBtn();
}

function handleCustomDress(e) {
    const file = e.target.files[0];
    if (!file) return;
    customDressFile = file;
    selectedDressId = null;
    document.querySelectorAll('.dress-card').forEach(c => c.classList.remove('selected'));

    const reader = new FileReader();
    reader.onload = (ev) => {
        document.getElementById('custom-dress-img').src = ev.target.result;
        document.getElementById('custom-dress-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
    updateGenerateBtn();
}

function removeCustomDress() {
    customDressFile = null;
    document.getElementById('custom-dress-preview').style.display = 'none';
    document.getElementById('custom-dress-input').value = '';
    updateGenerateBtn();
}

function updateGenerateBtn() {
    const btn = document.getElementById('generate-btn');
    btn.disabled = !(uploadedPhotoId && (selectedDressId || customDressFile));
    // Step-1 / step-2 "next" buttons follow the same gating logic as the
    // generate button: step 1 needs a photo, step 2 needs photo+dress.
    const step1Next = document.getElementById('step1-next');
    if (step1Next) step1Next.disabled = !uploadedPhotoId;
    const step2Next = document.getElementById('step2-next');
    if (step2Next) step2Next.disabled = !(uploadedPhotoId && (selectedDressId || customDressFile));
    updateStepper();
}

// Step state — which wizard step is currently visible. The visible step
// renders full-width; others are hidden via [data-current-step] on the
// container.
let currentTryonStep = 1;

function setStep(n, opts) {
    const scroll = !opts || opts.scroll !== false;
    currentTryonStep = Math.max(1, Math.min(3, n | 0));
    const wizard = document.querySelector('.tryon-wizard');
    if (wizard) wizard.setAttribute('data-current-step', String(currentTryonStep));
    if (scroll) {
        // Scroll to the top of the wizard so the user sees the new step
        // without having to hunt for it.
        const tryonContainer = document.querySelector('.tryon-container');
        if (tryonContainer) {
            tryonContainer.scrollIntoView({behavior: 'smooth', block: 'start'});
        }
    }
    updateStepper();
}

// Visual stepper at the top of the try-on flow. Marks completed steps as
// is-done, the active step as is-active, and disables stepper buttons for
// steps the user can't yet jump to (forward jumps are gated until the
// previous step is satisfied; backward jumps are always allowed).
function updateStepper() {
    const stepper = document.querySelector('.tryon-stepper');
    if (!stepper) return;
    const hasPhoto = !!uploadedPhotoId;
    const hasDress = !!(selectedDressId || customDressFile);
    const hasResult = document.getElementById('result-image')?.style.display !== 'none'
                   && document.getElementById('result-img')?.src;

    const items = stepper.querySelectorAll('.tryon-stepper-item');
    if (items.length < 3) return;

    // Reachability: the user can always go back, can go to step 2 once a
    // photo is uploaded, and to step 3 once both photo and dress are set.
    const reachable = [true, hasPhoto, hasPhoto && hasDress];
    // Done state: a step is "done" if its prerequisite has been satisfied
    // and it's behind the current step.
    const done = [hasPhoto, hasDress, hasResult];

    items.forEach((el, i) => {
        el.classList.remove('is-active', 'is-done');
        el.disabled = !reachable[i];
        if (done[i]) el.classList.add('is-done');
        if (i + 1 === currentTryonStep) el.classList.add('is-active');
    });
}

// Async tryon: POST starts the generation and returns a generation_id
// quickly, then we poll GET /api/try-on/<id> until it's completed or
// failed. Total wall time is dominated by FASHN; the browser side just
// keeps the UI responsive.
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes — FASHN tryon-max usually finishes in 30-90s

async function buildResultUrl(rawPath) {
    // /results/<key> is auth-protected; <img src> can't send Authorization
    // headers, so we append the access token as ?t= which the function
    // accepts as a fallback.
    if (!rawPath) return rawPath;
    const sess = window.TWD_AUTH ? await window.TWD_AUTH.getSession() : null;
    const token = sess && sess.access_token;
    if (!token) return API + rawPath;
    const sep = rawPath.includes('?') ? '&' : '?';
    return API + rawPath + sep + 't=' + encodeURIComponent(token);
}

async function pollTryon(generationId) {
    const start = Date.now();
    while (true) {
        const res = await authedFetch('/api/try-on/' + encodeURIComponent(generationId));
        if (res && res.__authMissing) {
            throw Object.assign(new Error('auth'), { authMissing: true });
        }
        if (res.status === 401) {
            throw Object.assign(new Error('auth'), { authMissing: true });
        }
        if (!res.ok) {
            const err = await res.json().catch(function () { return {}; });
            throw new Error(err.detail || 'Ошибка при опросе результата');
        }
        const data = await res.json();
        if (data.status === 'completed') return data;
        if (data.status === 'failed') {
            throw new Error(data.error || 'Генерация не удалась');
        }
        if (Date.now() - start > POLL_TIMEOUT_MS) {
            throw new Error('Превышено время ожидания. Попробуйте позже.');
        }
        await new Promise(function (r) { setTimeout(r, POLL_INTERVAL_MS); });
    }
}

async function generateTryOn() {
    const btn = document.getElementById('generate-btn');
    if (!(await ensureSignedIn())) {
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Создаём…';

    document.getElementById('result-placeholder').style.display = 'none';
    document.getElementById('result-image').style.display = 'none';
    document.getElementById('result-actions').style.display = 'none';
    document.getElementById('result-loading').style.display = 'block';

    try {
        const formData = new FormData();
        formData.append('model_photo_id', uploadedPhotoId);

        if (customDressFile) {
            formData.append('dress_file', customDressFile);
        } else {
            formData.append('dress_id', selectedDressId);
        }

        const res = await authedFetch('/api/try-on', { method: 'POST', body: formData });

        if (res && res.__authMissing) {
            document.getElementById('result-loading').style.display = 'none';
            document.getElementById('result-placeholder').style.display = 'block';
            openAuthRequiredModal();
            return;
        }
        if (res.status === 401) {
            document.getElementById('result-loading').style.display = 'none';
            document.getElementById('result-placeholder').style.display = 'block';
            openAuthRequiredModal();
            return;
        }
        if (res.status === 402) {
            document.getElementById('result-loading').style.display = 'none';
            document.getElementById('result-placeholder').style.display = 'block';
            openOutOfCreditsModal();
            return;
        }
        if (!res.ok) {
            const err = await res.json().catch(function () { return {}; });
            throw new Error(err.detail || 'Не удалось создать изображение');
        }
        const startData = await res.json();
        const generationId = startData.generation_id;
        if (!generationId) {
            throw new Error('Сервер не вернул generation_id');
        }

        const finalData = await pollTryon(generationId);

        const signedUrl = await buildResultUrl(finalData.result_url);
        document.getElementById('result-loading').style.display = 'none';
        document.getElementById('result-img').src = signedUrl;
        document.getElementById('result-image').style.display = 'block';
        document.getElementById('download-btn').href = signedUrl;
        document.getElementById('result-actions').style.display = 'flex';
    } catch (e) {
        document.getElementById('result-loading').style.display = 'none';
        document.getElementById('result-placeholder').style.display = 'block';
        if (e && e.authMissing) {
            openAuthRequiredModal();
        } else {
            alert('Ошибка: ' + e.message);
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Примерить';
        updateGenerateBtn();
    }
}

function resetResult() {
    document.getElementById('result-image').style.display = 'none';
    document.getElementById('result-actions').style.display = 'none';
    document.getElementById('result-placeholder').style.display = 'block';
    document.getElementById('result-img').src = '';
    updateStepper();
}

// Init
function applyHashRoute() {
    // Cross-page deep link: dashboard.html / gallery.html / etc. point at
    // "/#tryon" when they want to open the wizard. Since index.html is a
    // single-page shell with showPage(), translate the hash on first load
    // (and on hashchange events) into the right page swap.
    const h = (window.location.hash || '').replace(/^#/, '');
    if (h === 'tryon' && document.getElementById('page-tryon')) {
        showPage('tryon');
    } else if (h === 'landing' && document.getElementById('page-landing')) {
        showPage('landing');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadExamples();
    loadCatalog();
    // Make sure the wizard starts on step 1 with the right stepper state.
    if (document.querySelector('.tryon-wizard')) {
        setStep(1, {scroll: false});
    }
    applyHashRoute();
});

window.addEventListener('hashchange', applyHashRoute);
