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
    try {
        const res = await fetch(API + '/api/examples');
        const examples = await res.json();
        const grid = document.getElementById('examples-grid');
        grid.innerHTML = examples.map(ex => `
            <div class="example-card">
                <div class="example-images">
                    <img src="${API}${ex.before}" alt="Before" loading="lazy">
                    <img src="${API}${ex.after}" alt="After" loading="lazy">
                    <span class="example-label before">Before</span>
                    <span class="example-label after">After</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load examples:', e);
    }
}

async function loadCatalog() {
    try {
        const res = await fetch(API + '/api/catalog');
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
    colorContainer.innerHTML = '<button class="filter-pill active" data-filter="all" onclick="setColorFilter(\'all\', this)">All</button>' +
        colors.map(c => `<button class="filter-pill" data-filter="${c}" onclick="setColorFilter('${c}', this)">${c}</button>`).join('');

    const styleContainer = document.getElementById('style-filters');
    styleContainer.innerHTML = '<button class="filter-pill active" data-filter="all" onclick="setStyleFilter(\'all\', this)">All</button>' +
        styles.map(s => `<button class="filter-pill" data-filter="${s}" onclick="setStyleFilter('${s}', this)">${s}</button>`).join('');
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
        grid.innerHTML = '<p class="no-results">No dresses match the selected filters</p>';
        return;
    }
    grid.innerHTML = filtered.map(dress => `
        <div class="dress-card ${selectedDressId === dress.id ? 'selected' : ''}" data-id="${dress.id}" onclick="openDressModal('${dress.id}')">
            <span class="selected-badge">Selected</span>
            <span class="zoom-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg>
            </span>
            <img src="${API}${dress.image_url}" alt="${dress.name}" loading="lazy">
            <div class="dress-info">
                <div class="dress-name">${dress.name}</div>
                <div class="dress-meta">
                    <span class="dress-color" style="background:${getColorHex(dress.color)}"></span>
                    ${dress.color} · ${dress.style}
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
    document.getElementById('modal-img').src = API + dress.image_url;
    document.getElementById('modal-img').alt = dress.name;
    document.getElementById('modal-name').textContent = dress.name;
    document.getElementById('modal-color').textContent = dress.color;
    document.getElementById('modal-color-swatch').style.background = getColorHex(dress.color);
    document.getElementById('modal-style').textContent = dress.style;
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
        sourceLink.innerHTML = `View on ${retailerName} &rarr;`;
        sourceLink.style.display = '';
        attribution.innerHTML = `Photo and product details courtesy of <a href="${dress.source_url}" target="_blank" rel="noopener">${retailerName}</a>. Used for demonstration purposes.`;
        attribution.style.display = '';
    } else {
        sourceLink.style.display = 'none';
        attribution.style.display = 'none';
    }

    const btn = document.querySelector('.modal-select-btn');
    btn.textContent = (selectedDressId === id) ? 'Selected — close' : 'Use this dress';
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
    if (files.length > 0) uploadPhoto(files[0]);
}

function handlePhotoUpload(e) {
    if (e.target.files.length > 0) uploadPhoto(e.target.files[0]);
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
            alert('Failed to upload photo: ' + (err.detail || res.statusText));
            removePhoto();
            return;
        }
        const data = await res.json();
        uploadedPhotoId = data.file_id;
        updateGenerateBtn();
    } catch (e) {
        alert('Failed to upload photo. Please try again.');
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
}

async function generateTryOn() {
    const btn = document.getElementById('generate-btn');
    btn.disabled = true;
    btn.textContent = 'Generating...';

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
            throw new Error(err.detail || 'Generation failed');
        }
        const data = await res.json();

        document.getElementById('result-loading').style.display = 'none';
        document.getElementById('result-img').src = API + data.result_url;
        document.getElementById('result-image').style.display = 'block';
        document.getElementById('download-btn').href = API + data.result_url;
        document.getElementById('result-actions').style.display = 'flex';
    } catch (e) {
        document.getElementById('result-loading').style.display = 'none';
        document.getElementById('result-placeholder').style.display = 'block';
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Try It On';
        updateGenerateBtn();
    }
}

function resetResult() {
    document.getElementById('result-image').style.display = 'none';
    document.getElementById('result-actions').style.display = 'none';
    document.getElementById('result-placeholder').style.display = 'block';
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadExamples();
    loadCatalog();
});
