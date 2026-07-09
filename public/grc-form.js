// =====================================================================
// CONFIG — change API_ENDPOINT after Vercel deploy
// =====================================================================
const API_ENDPOINT = 'https://grc-stripe-api.vercel.app/api/create-checkout';
const FREE_API_ENDPOINT = 'https://grc-stripe-api.vercel.app/api/create-free-submission';
const HOME_URL = 'https://stack.grcreport.com/';
const TOTAL_PAGES = document.querySelectorAll('.page').length || 22;
const AUTOSAVE_DELAY = 1000;
const STORAGE_KEY = 'grcQuestionnaire';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// File attachment limits (product images + materials on page 21)
const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_MATERIALS = 10;
const MAX_MATERIAL_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENTS_SIZE = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg'];
const ALLOWED_MATERIAL_TYPES = ['application/pdf'];

// =====================================================================
// STATE
// =====================================================================
let currentPage = 1;
let saveTimeout;
let popupDismissTimeout;
let isSubmitting = false;

// =====================================================================
// DOM REFS
// =====================================================================
const formElement = document.getElementById('questionnaireForm');
const formAlert = document.getElementById('formAlert');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const submitBtn = document.getElementById('submitBtn');
const submitFreeBtn = document.getElementById('submitFreeBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const productImagesInput = document.getElementById('productImages');
const productMaterialsInput = document.getElementById('productMaterials');
const imagesHint = document.getElementById('imagesHint');
const materialsHint = document.getElementById('materialsHint');
const submissionPopup = document.getElementById('submissionPopup');
const popupTitle = document.getElementById('popupTitle');
const popupMessage = document.getElementById('popupMessage');
const popupCloseBtn = document.getElementById('popupCloseBtn');
const popupAcknowledgeBtn = document.getElementById('popupAcknowledgeBtn');
const popupContent = submissionPopup ? submissionPopup.querySelector('.popup-content') : null;

// Set yearFounded max dynamically to current year
const yearField = document.getElementById('yearFounded');
if (yearField) yearField.max = new Date().getFullYear();

// =====================================================================
// VALIDATION
// =====================================================================
function showFormAlert(msg) {
    if (!formAlert) return;
    formAlert.textContent = msg;
    formAlert.style.display = 'block';
}

function hideFormAlert() {
    if (!formAlert) return;
    formAlert.textContent = '';
    formAlert.style.display = 'none';
}

function clearFieldError(field) {
    if (!field) return;
    field.classList.remove('invalid');
    const group = field.closest('.form-group');
    if (!group) return;
    const err = group.querySelector('.error-message-q');
    if (err) err.remove();
}

function showFieldError(field, msg) {
    if (!field) return;
    const group = field.closest('.form-group');
    if (!group) return;
    field.classList.remove('valid');
    let err = group.querySelector('.error-message-q');
    if (!err) {
        err = document.createElement('div');
        err.className = 'error-message-q';
        group.appendChild(err);
    }
    err.textContent = msg;
    field.classList.add('invalid');
}

function validateField(field) {
    if (!field) return true;
    const raw = field.value || '';
    const trimmed = typeof raw === 'string' ? raw.trim() : raw;
    const shouldValidate = field.required || trimmed !== '';

    field.setCustomValidity('');
    clearFieldError(field);

    if (field.required && trimmed === '') {
        field.setCustomValidity('This field is required.');
    } else if (field.type === 'email' && trimmed !== '' && !EMAIL_PATTERN.test(trimmed)) {
        field.setCustomValidity('Enter a valid email address.');
    }

    if (!shouldValidate) {
        field.classList.remove('valid');
        return true;
    }

    if (!field.checkValidity()) {
        showFieldError(field, field.validationMessage || 'Please correct this field.');
        return false;
    }

    field.classList.remove('invalid');
    if (trimmed !== '') {
        field.classList.add('valid');
    } else {
        field.classList.remove('valid');
    }

    const page = field.closest('.page');
    if (page && !page.querySelector('.invalid')) hideFormAlert();
    return true;
}

function validatePage(pageNum) {
    const page = document.querySelector(`[data-page="${pageNum}"]`);
    if (!page) {
        hideFormAlert();
        return true;
    }

    let firstInvalid = null;
    page.querySelectorAll('input, select, textarea').forEach(field => {
        if (!validateField(field) && !firstInvalid) {
            firstInvalid = field;
        }
    });

    if (firstInvalid) {
        if (typeof firstInvalid.focus === 'function') {
            firstInvalid.focus({ preventScroll: false });
        }
        return false;
    }

    hideFormAlert();
    return true;
}

// Validates every page (not just the current one) — used before either submit path.
// Returns the first invalid page number, or null if the whole form is valid.
function validateAllPages() {
    let firstInvalidPage = null;
    for (let p = 1; p <= TOTAL_PAGES; p++) {
        const page = document.querySelector(`[data-page="${p}"]`);
        if (!page) continue;
        let pageOk = true;
        page.querySelectorAll('input, select, textarea').forEach(field => {
            if (!validateField(field)) pageOk = false;
        });
        if (!pageOk && firstInvalidPage === null) firstInvalidPage = p;
    }
    return firstInvalidPage;
}

// =====================================================================
// AUTO-SAVE
// =====================================================================
function saveFormData() {
    if (!formElement) return;
    const data = new FormData(formElement);
    const payload = { currentPage };
    for (const [key, val] of data.entries()) {
        if (key === 'website_url_hp') continue; // never persist honeypot
        if (key === 'productImages' || key === 'productMaterials') continue; // File objects — not persistable
        payload[key] = val;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('localStorage save failed:', e);
    }

    const indicator = document.getElementById('autoSaveIndicator');
    if (indicator) {
        indicator.style.display = 'flex';
        setTimeout(() => { indicator.style.display = 'none'; }, 2000);
    }
}

function loadFormData() {
    let saved;
    try {
        saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        return;
    }
    if (!saved) {
        updateProgress();
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(saved);
    } catch (e) {
        return;
    }

    if (parsed.currentPage) {
        currentPage = parsed.currentPage;
        showPage(currentPage);
    }

    for (const [key, val] of Object.entries(parsed)) {
        if (key === 'currentPage') continue;
        const field = document.querySelector(`[name="${key}"]`);
        if (!field) continue;
        field.value = val;
        updateCharCounter(field);
        if (typeof val === 'string' && val.trim() !== '') {
            validateField(field);
        } else {
            clearFieldError(field);
            field.classList.remove('valid');
        }
    }

    updateProgress();
}

function updateCharCounter(field) {
    const counter = document.querySelector(`[data-counter="${field.id}"]`);
    if (!counter) return;
    const max = field.getAttribute('maxlength');
    counter.textContent = `${field.value.length} / ${max}`;
}

// =====================================================================
// PAGE NAVIGATION
// =====================================================================
function updateProgress() {
    const pct = Math.round((currentPage / TOTAL_PAGES) * 100);
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = `Page ${currentPage} of ${TOTAL_PAGES}`;
}

function showPage(pageNum) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.querySelector(`[data-page="${pageNum}"]`);
    if (target) target.classList.add('active');

    if (prevBtn) prevBtn.disabled = pageNum === 1;

    if (pageNum === TOTAL_PAGES) {
        if (nextBtn) nextBtn.style.display = 'none';
        if (submitBtn) submitBtn.style.display = 'block';
    } else {
        if (nextBtn) nextBtn.style.display = 'block';
        if (submitBtn) submitBtn.style.display = 'none';
    }

    updateProgress();
    hideFormAlert();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =====================================================================
// PDF GENERATION (used by both Download button and Submit flow)
// =====================================================================
function ensureJsPDFLoaded() {
    return new Promise((resolve, reject) => {
        if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load PDF library.'));
        document.head.appendChild(script);
    });
}

function buildPDFDocument() {
    if (!formElement) throw new Error('Form not found.');
    const jspdfNs = window.jspdf || {};
    const { jsPDF } = jspdfNs;
    if (!jsPDF) throw new Error('jsPDF not loaded.');

    const doc = new jsPDF();
    const data = new FormData(formElement);
    let y = 20;
    const margin = 20;
    const textWidth = doc.internal.pageSize.width - 40;

    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text('GRC Stack Search Questionnaire', margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, y);
    y += 15;
    doc.setTextColor(0, 0, 0);

    const sections = {
        'Contact Information': ['firstName', 'lastName', 'title', 'email', 'phone'],
        'Company Information': ['companyName', 'companyDescription', 'yearFounded', 'mainPhone', 'generalEmail', 'website'],
        'Headquarters Location': ['hqStreet', 'hqCity', 'hqState', 'hqPostal', 'hqCountry', 'regionsActive'],
        'Company Details': ['companySize', 'latestRevenue', 'previousRevenue', 'companyType', 'tickerSymbol', 'investors', 'executives'],
        'Social Media': ['twitter', 'linkedin'],
        'GRC Offerings': ['grcSoftware', 'grcSoftwareList', 'grcServices', 'grcServicesList', 'grcContent', 'grcContentList', 'competitors', 'industries', 'specificIndustries'],
        'Solution Capabilities': ['auditManagement', 'businessContinuity', 'complianceEthics', 'environmental', 'healthSafety', 'internalControl', 'issueReporting', 'kyc', 'legal', 'physicalSecurity', 'quality', 'reputation', 'riskManagement', 'thirdParty']
    };

    for (const [section, fields] of Object.entries(sections)) {
        const hasContent = fields.some(f => {
            const v = data.get(f);
            return v && v.trim() !== '';
        });
        if (!hasContent) continue;

        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(255, 95, 31);
        doc.text(section, margin, y);
        y += 8;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);

        for (const fieldName of fields) {
            const val = data.get(fieldName);
            if (!val || val.trim() === '') continue;
            const labelEl = document.querySelector(`label[for="${fieldName}"]`);
            const labelText = labelEl ? labelEl.textContent.replace('*', '').trim() : fieldName;

            if (y > 270) { doc.addPage(); y = 20; }
            doc.setFont(undefined, 'bold');
            doc.text(`${labelText}:`, margin, y);
            y += 5;
            doc.setFont(undefined, 'normal');
            const lines = doc.splitTextToSize(val, textWidth);
            for (const line of lines) {
                if (y > 280) { doc.addPage(); y = 20; }
                doc.text(line, margin, y);
                y += 5;
            }
            y += 3;
        }
        y += 5;
    }

    return doc;
}

function generatePDF() {
    try {
        const doc = buildPDFDocument();
        doc.save('GRC-Questionnaire-Response.pdf');
    } catch (e) {
        console.error('PDF generation failed:', e);
    }
}

function getPDFAsBase64() {
    const doc = buildPDFDocument();
    // 'datauristring' returns "data:application/pdf;filename=...;base64,JVBERi0xLjMK..."
    const dataUri = doc.output('datauristring');
    const commaIdx = dataUri.indexOf(',');
    return commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
}

// =====================================================================
// FILE ATTACHMENTS (page 21 — product images + materials)
// =====================================================================
function updateFileHints() {
    const imageCount = productImagesInput?.files ? productImagesInput.files.length : 0;
    const materialCount = productMaterialsInput?.files ? productMaterialsInput.files.length : 0;
    if (imagesHint) imagesHint.textContent = `${imageCount} / ${MAX_IMAGES} selected`;
    if (materialsHint) materialsHint.textContent = `${materialCount} / ${MAX_MATERIALS} selected`;
}

// Validates one file input against count/type/size limits. On violation, clears the
// input (browsers won't let us remove individual files from a FileList) and shows
// the shared form alert so the user knows to reselect.
function validateFileInput(input, { max, maxSize, allowedTypes, label }) {
    if (!input) return true;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length > max) {
        showFormAlert(`You can attach up to ${max} ${label}.`);
        input.value = '';
        return false;
    }
    for (const file of files) {
        if (!allowedTypes.includes(file.type)) {
            showFormAlert(`"${file.name}" is not an allowed file type for ${label}.`);
            input.value = '';
            return false;
        }
        if (file.size > maxSize) {
            showFormAlert(`"${file.name}" exceeds the ${(maxSize / (1024 * 1024)).toFixed(0)}MB limit for ${label}.`);
            input.value = '';
            return false;
        }
    }
    return true;
}

function enforceFileLimits() {
    const imagesOk = validateFileInput(productImagesInput, {
        max: MAX_IMAGES, maxSize: MAX_IMAGE_SIZE, allowedTypes: ALLOWED_IMAGE_TYPES, label: 'product images (PNG/JPEG)',
    });
    const materialsOk = validateFileInput(productMaterialsInput, {
        max: MAX_MATERIALS, maxSize: MAX_MATERIAL_SIZE, allowedTypes: ALLOWED_MATERIAL_TYPES, label: 'product material PDFs',
    });

    let totalSize = 0;
    if (productImagesInput?.files) for (const f of productImagesInput.files) totalSize += f.size;
    if (productMaterialsInput?.files) for (const f of productMaterialsInput.files) totalSize += f.size;

    let totalOk = true;
    if (totalSize > MAX_TOTAL_ATTACHMENTS_SIZE) {
        showFormAlert(`Total attachments (images + PDFs) must be under ${(MAX_TOTAL_ATTACHMENTS_SIZE / (1024 * 1024)).toFixed(0)}MB combined.`);
        totalOk = false;
    }

    updateFileHints();
    return imagesOk && materialsOk && totalOk;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result || '';
            const commaIdx = result.indexOf(',');
            resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('File read failed.'));
        reader.readAsDataURL(file);
    });
}

// Reads the selected product images + materials and returns them as
// [{ filename, content(base64), type }], ready to attach to the submit payload.
async function collectFileAttachments() {
    const files = [
        ...(productImagesInput?.files ? Array.from(productImagesInput.files) : []),
        ...(productMaterialsInput?.files ? Array.from(productMaterialsInput.files) : []),
    ];
    const attachments = [];
    for (const file of files) {
        const content = await fileToBase64(file);
        attachments.push({ filename: file.name, content, type: file.type });
    }
    return attachments;
}

if (productImagesInput) productImagesInput.addEventListener('change', enforceFileLimits);
if (productMaterialsInput) productMaterialsInput.addEventListener('change', enforceFileLimits);

// =====================================================================
// POPUP
// =====================================================================
// True only while the popup is showing the free-submission success confirmation —
// reset on every showSubmissionPopup() call, so it never leaks into unrelated popups
// (e.g. errors, or the paid flow, which doesn't use this popup at all).
let popupIsFreeSuccess = false;

function showSubmissionPopup(msg, kind = 'success', { freeSuccess = false } = {}) {
    if (!submissionPopup || !popupContent) return;
    clearTimeout(popupDismissTimeout);
    popupIsFreeSuccess = freeSuccess;
    if (popupMessage) popupMessage.textContent = msg;
    if (popupTitle) popupTitle.textContent = kind === 'error' ? 'Action Required' : 'Heads up';

    popupContent.classList.remove('popup-success', 'popup-error');
    popupContent.classList.add(kind === 'error' ? 'popup-error' : 'popup-success');
    submissionPopup.classList.add('visible');
    submissionPopup.setAttribute('aria-hidden', 'false');
    if (popupCloseBtn) popupCloseBtn.focus();

    // Free-success stays open until the user explicitly acknowledges it (which redirects
    // home) — don't auto-dismiss it out from under that flow.
    if (kind === 'success' && !popupIsFreeSuccess) {
        popupDismissTimeout = setTimeout(hideSubmissionPopup, 7000);
    }
}

function hideSubmissionPopup() {
    if (!submissionPopup || !popupContent) return;
    clearTimeout(popupDismissTimeout);
    submissionPopup.classList.remove('visible');
    submissionPopup.setAttribute('aria-hidden', 'true');
}

// Bound to the popup's acknowledge/close buttons. Redirects home only when the popup
// currently showing is the free-submission success confirmation; otherwise just closes it.
function dismissSubmissionPopup() {
    if (popupIsFreeSuccess) {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore — already cleared on submit in the common case */ }
        window.location.href = HOME_URL;
        return;
    }
    hideSubmissionPopup();
}

// =====================================================================
// SUBMISSION → STRIPE CHECKOUT
// =====================================================================
function gatherFormPayload() {
    const data = new FormData(formElement);
    const payload = {};
    for (const [key, val] of data.entries()) {
        if (key === 'productImages' || key === 'productMaterials') continue; // File objects — sent separately via fileAttachments
        // include honeypot so server can detect bots, but in a known field
        payload[key] = val;
    }
    // Normalize promotion code: trim + uppercase (Stripe codes are case-insensitive
    // but normalizing avoids surprises and makes logs consistent)
    if (payload.promotionCode) {
        payload.promotionCode = String(payload.promotionCode).trim().toUpperCase();
        if (payload.promotionCode === '') delete payload.promotionCode;
    }
    return payload;
}

async function submitToCheckout() {
    if (isSubmitting) return;

    // Final validation across all pages, not just current one
    const firstInvalidPage = validateAllPages();
    if (firstInvalidPage !== null) {
        currentPage = firstInvalidPage;
        showPage(currentPage);
        saveFormData();
        showSubmissionPopup(
            `Some required fields on page ${firstInvalidPage} need attention before you can submit.`,
            'error'
        );
        return;
    }

    if (!enforceFileLimits()) return;

    isSubmitting = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Preparing checkout…';

    const payload = gatherFormPayload();

    // Generate PDF and attach as base64 — best effort, continue without it if it fails
    try {
        submitBtn.textContent = 'Generating PDF…';
        await ensureJsPDFLoaded();
        payload.pdfBase64 = getPDFAsBase64();
        const rawName = payload.companyName || 'submission';
        const safeName = rawName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
        payload.pdfFilename = `GRC-Submission-${safeName}.pdf`;
    } catch (e) {
        console.warn('PDF generation failed, continuing without attachment:', e);
    }

    try {
        payload.fileAttachments = await collectFileAttachments();
    } catch (e) {
        console.warn('File attachment read failed, continuing without them:', e);
        payload.fileAttachments = [];
    }

    submitBtn.textContent = 'Preparing checkout…';

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            const msg = result.message || result.error || `Server error (${response.status}). Please try again or contact wg@grcreport.com.`;
            throw new Error(msg);
        }

        if (!result.checkoutUrl) {
            throw new Error('We could not start the checkout session. Please try again or contact wg@grcreport.com.');
        }

        // Store submission reference (cleared on success page after payment)
        if (result.submissionId) {
            try {
                localStorage.setItem('grcSubmissionId', result.submissionId);
            } catch (e) { /* ignore */ }
        }

        // Redirect to Stripe Checkout
        window.location.href = result.checkoutUrl;
    } catch (err) {
        console.error('Submission error:', err);
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        showSubmissionPopup(err.message || 'Submission failed. Please try again.', 'error');
    }
}

// =====================================================================
// SUBMISSION → FREE (INACTIVE) LISTING
// =====================================================================
async function submitFree() {
    if (isSubmitting) return;

    const firstInvalidPage = validateAllPages();
    if (firstInvalidPage !== null) {
        currentPage = firstInvalidPage;
        showPage(currentPage);
        saveFormData();
        showSubmissionPopup(
            `Some required fields on page ${firstInvalidPage} need attention before you can submit.`,
            'error'
        );
        return;
    }

    if (!enforceFileLimits()) return;

    isSubmitting = true;
    const originalLabel = submitFreeBtn.textContent;
    submitFreeBtn.disabled = true;
    submitFreeBtn.textContent = 'Generating PDF…';

    const payload = gatherFormPayload();

    try {
        await ensureJsPDFLoaded();
        payload.pdfBase64 = getPDFAsBase64();
        const rawName = payload.companyName || 'submission';
        const safeName = rawName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
        payload.pdfFilename = `GRC-Submission-${safeName}.pdf`;
    } catch (e) {
        console.warn('PDF generation failed, continuing without attachment:', e);
    }

    try {
        payload.fileAttachments = await collectFileAttachments();
    } catch (e) {
        console.warn('File attachment read failed, continuing without them:', e);
        payload.fileAttachments = [];
    }

    submitFreeBtn.textContent = 'Submitting…';

    try {
        const response = await fetch(FREE_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok) {
            const msg = result.message || `Server error (${response.status}). Please try again or contact wg@grcreport.com.`;
            throw new Error(msg);
        }

        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore */ }

        showSubmissionPopup(
            'Your submission has been received. It will appear in the directory as Inactive until you activate it.',
            'success',
            { freeSuccess: true }
        );
    } catch (err) {
        console.error('Free submission error:', err);
        showSubmissionPopup(err.message || 'Submission failed. Please try again.', 'error');
    } finally {
        isSubmitting = false;
        submitFreeBtn.disabled = false;
        submitFreeBtn.textContent = originalLabel;
    }
}

// =====================================================================
// EVENT LISTENERS
// =====================================================================
document.querySelectorAll('textarea[maxlength]').forEach(el => {
    el.addEventListener('input', function () { updateCharCounter(this); });
});

if (nextBtn) {
    nextBtn.addEventListener('click', () => {
        if (currentPage < TOTAL_PAGES) {
            if (!validatePage(currentPage)) return;
            currentPage += 1;
            showPage(currentPage);
            saveFormData();
        }
    });
}

if (prevBtn) {
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage -= 1;
            showPage(currentPage);
            saveFormData();
        }
    });
}

if (formElement) {
    formElement.addEventListener('input', (e) => {
        const t = e.target;
        if (t && t.matches('input, select, textarea')) {
            const v = typeof t.value === 'string' ? t.value.trim() : '';
            if (t.classList.contains('invalid')) {
                validateField(t);
            } else if (t.required && v !== '') {
                t.classList.add('valid');
            } else if (!t.required && v === '') {
                t.classList.remove('valid');
            }
        }
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveFormData, AUTOSAVE_DELAY);
    });

    formElement.querySelectorAll('input, select, textarea').forEach(el => {
        el.addEventListener('blur', () => validateField(el));
        el.addEventListener('change', () => validateField(el));
    });

    formElement.addEventListener('submit', (e) => {
        e.preventDefault();
        submitToCheckout();
    });
}

if (submitFreeBtn) {
    submitFreeBtn.addEventListener('click', () => {
        submitFree();
    });
}

if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
        const original = exportPdfBtn.textContent;
        exportPdfBtn.disabled = true;
        exportPdfBtn.textContent = 'Preparing PDF…';
        try {
            await ensureJsPDFLoaded();
            generatePDF();
        } catch (e) {
            console.error('Could not load PDF library:', e);
            showSubmissionPopup('Could not generate PDF. Please try again or check your internet connection.', 'error');
        } finally {
            exportPdfBtn.disabled = false;
            exportPdfBtn.textContent = original;
        }
    });
}

if (submissionPopup) {
    submissionPopup.addEventListener('click', (e) => {
        if (e.target === submissionPopup) hideSubmissionPopup();
    });
}
if (popupCloseBtn) popupCloseBtn.addEventListener('click', dismissSubmissionPopup);
if (popupAcknowledgeBtn) popupAcknowledgeBtn.addEventListener('click', dismissSubmissionPopup);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && submissionPopup && submissionPopup.classList.contains('visible')) {
        hideSubmissionPopup();
    }
});

window.addEventListener('DOMContentLoaded', loadFormData);
