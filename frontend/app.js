const API = '';

let uploadedPhotoId = null;
let selectedDressId = null;
let customDressFile = null;
let catalogData = [];
let activeColorFilter = 'all';
let activeStyleFilter = 'all';

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

function buildFilters() {
    const colors = [...new Set(catalogData.map(d => d.color))].sort();
    const styles = [...new Set(catalogData.map(d => d.style))].sort();

    const colorContainer = document.getElementById('color-filters');
    colorContainer.innerHTML = '<button class="filter-pill active" data-filter="all" onclick="setColorFilter(\'all\', this)">Все</button>' +
        colors.map(c => `<button class="filter-pill" data-filter="${c}" onclick="setColorFilter('${c}', this)">${colorLabel(c)}</button>`).join('');

    const styleContainer = document.getElementById('style-filters');
    styleContainer.innerHTML = '<button class="filter-pill active" data-filter="all" onclick="setStyleFilter(\'all\', this)">Все</button>' +
        styles.map(s => `<button class="filter-pill" data-filter="${s}" onclick="setStyleFilter('${s}', this)">${styleLabel(s)}</button>`).join('');
}

function setColorFilter(color, btn) {
    activeColorFilter = color;
    document.querySelectorAll('#color-filters .filter-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    renderCatalog();
}

function setStyleFilter(style, btn) {
    activeStyleFilter = style;
    document.querySelectorAll('#style-filters .filter-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    renderCatalog();
}

function renderCatalog() {
    const filtered = catalogData.filter(d => {
        if (activeColorFilter !== 'all' && d.color !== activeColorFilter) return false;
        if (activeStyleFilter !== 'all' && d.style !== activeStyleFilter) return false;
        return true;
    });

    const grid = document.getElementById('dress-catalog');
    if (filtered.length === 0) {
        grid.innerHTML = '<p class="no-results">Нет платьев по выбранным фильтрам</p>';
        return;
    }
    grid.innerHTML = filtered.map(dress => `
        <div class="dress-card ${selectedDressId === dress.id ? 'selected' : ''}" data-id="${dress.id}" onclick="openDressModal('${dress.id}')">
            <span class="selected-badge">Выбрано</span>
            <span class="zoom-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg>
            </span>
            <img src="${dress.image_url}" alt="${dressNamePrimary(dress)}" loading="lazy">
            <div class="dress-info">
                <div class="dress-name">${dressNamePrimary(dress)}</div>
                ${dressNameSecondary(dress) ? `<div class="dress-name-en">${dressNameSecondary(dress)}</div>` : ''}
                <div class="dress-meta">
                    <span class="dress-color" style="background:${getColorHex(dress.color)}"></span>
                    ${colorLabel(dress.color)} · ${styleLabel(dress.style)}
                </div>
            </div>
        </div>
    `).join('');
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

function filterCatalog() {
    renderCatalog();
}

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
document.addEventListener('DOMContentLoaded', () => {
    loadExamples();
    loadCatalog();
    // Make sure the wizard starts on step 1 with the right stepper state.
    if (document.querySelector('.tryon-wizard')) {
        setStep(1, {scroll: false});
    }
});
