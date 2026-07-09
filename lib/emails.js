// HTML email templates for pending (submission received) and paid (payment confirmed) states.

// Parses NOTIFICATION_EMAIL env var. Supports either a single email or a
// comma-separated list (e.g. "wg@grcreport.com,domagoj@example.com").
// Returns array of trimmed addresses for Resend's `to` field.
export function getNotificationRecipients() {
    const raw = process.env.NOTIFICATION_EMAIL || '';
    const list = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length === 0) {
        throw new Error('NOTIFICATION_EMAIL env var is not set');
    }
    return list;
}

const FIELD_LABELS = {
    firstName: 'First Name',
    lastName: 'Last Name',
    title: 'Title',
    email: 'Contact Email',
    phone: 'Contact Phone',
    companyName: 'Company Name',
    companyDescription: 'Company Description',
    yearFounded: 'Year Founded',
    mainPhone: 'Main Phone',
    generalEmail: 'General Email',
    website: 'Website',
    hqStreet: 'HQ Street',
    hqCity: 'HQ City',
    hqState: 'HQ State',
    hqPostal: 'HQ Postal',
    hqCountry: 'HQ Country',
    regionsActive: 'Regions Active',
    companySize: 'Company Size',
    companyType: 'Company Type',
    tickerSymbol: 'Ticker Symbol',
    latestRevenue: 'Latest Revenue',
    previousRevenue: 'Previous Revenue',
    investors: 'Investors',
    executives: 'Executives',
    twitter: 'Twitter',
    linkedin: 'LinkedIn',
};

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Resend request size backstop (base64 inflates raw file size by ~33%).
// Merges the questionnaire PDF with client-submitted file attachments (product
// images/materials), dropping items once the combined size would cross this
// budget so an oversized upload can't block checkout or the pending email.
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export function buildEmailAttachments({ pdfBase64, pdfFilename, fileAttachments = [] }) {
    const candidates = [];
    if (pdfBase64) candidates.push({ filename: pdfFilename, content: pdfBase64 });
    for (const att of fileAttachments) {
        if (att && att.content) {
            candidates.push({ filename: att.filename || 'attachment', content: att.content });
        }
    }

    const attachments = [];
    let skipped = 0;
    let total = 0;
    for (const att of candidates) {
        const size = Buffer.byteLength(att.content, 'base64');
        if (total + size > MAX_ATTACHMENTS_BYTES) {
            skipped++;
            continue;
        }
        total += size;
        attachments.push(att);
    }
    return { attachments, skipped };
}

function attachmentsSkippedNote(attachmentsSkipped) {
    if (!attachmentsSkipped) return '';
    return `<p style="margin-top:16px;padding:10px 12px;background:#fff7ed;border-radius:6px;font-size:13px;color:#92400e;">⚠️ ${attachmentsSkipped} file(s) were not attached because the combined attachment size was too large. Ask the vendor to resend them directly if needed.</p>`;
}

function summaryTable(data) {
    const summaryFields = ['firstName', 'lastName', 'title', 'email', 'phone', 'companyName', 'website'];
    const rows = summaryFields
        .filter(f => data[f] && String(data[f]).trim())
        .map(f => `
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;border-bottom:1px solid #eee;width:160px;">${escapeHtml(FIELD_LABELS[f] || f)}</td>
        <td style="padding:8px 12px;color:#1d1d1f;border-bottom:1px solid #eee;">${escapeHtml(data[f])}</td>
      </tr>
    `).join('');
    return `<table style="width:100%;border-collapse:collapse;margin-top:16px;">${rows}</table>`;
}

export function pendingEmailHTML({ submissionId, data, checkoutUrl, attachmentsSkipped }) {
    const truncatedUrl = checkoutUrl && checkoutUrl.length > 80
        ? checkoutUrl.slice(0, 80) + '…'
        : checkoutUrl;
    return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1d1d1f;background:#f5f5f7;">
  <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="border-left:4px solid #FF9500;padding:12px 16px;background:#fff7ed;margin-bottom:24px;border-radius:4px;">
      <strong style="color:#c2410c;">🟡 Payment Pending</strong><br>
      <span style="font-size:14px;color:#555;">A vendor submitted the questionnaire and was redirected to Stripe Checkout. If payment goes through, you'll receive a confirmation email next. If not, the form data is still in this email (PDF attached).</span>
    </div>

    <h2 style="margin:0 0 8px;font-size:20px;">New GRC Stack Search submission</h2>
    <p style="color:#666;margin:0 0 16px;font-size:14px;">Submission ID: <code style="background:#f5f5f7;padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(submissionId)}</code></p>

    ${summaryTable(data)}

    <p style="margin:24px 0 8px;color:#555;font-size:14px;">📎 Full questionnaire (all sections) is attached as PDF, plus any product images/materials the vendor uploaded.</p>
    ${attachmentsSkippedNote(attachmentsSkipped)}

    <hr style="margin:32px 0;border:0;border-top:1px solid #eee;">
    <p style="font-size:12px;color:#999;margin:0;">Stripe Checkout session (for support reference):<br><a href="${escapeHtml(checkoutUrl || '')}" style="color:#999;word-break:break-all;">${escapeHtml(truncatedUrl || '')}</a></p>
  </div>
</body></html>`;
}

export function freeEmailHTML({ submissionId, data, cmsItemCreated, cmsErrorMsg, attachmentsSkipped }) {
    const cmsBanner = cmsItemCreated
        ? `<div style="border-left:4px solid #0071e3;padding:12px 16px;background:#eff6ff;margin-bottom:24px;border-radius:4px;">
             <strong style="color:#1d4ed8;">🆓 Free Submission — Inactive</strong><br>
             <span style="font-size:14px;color:#555;">A draft submission was added to the Stack Search Submissions collection as <strong>Inactive</strong>. Publish and activate it in Webflow once reviewed (or after the vendor pays to activate it).</span>
           </div>`
        : `<div style="border-left:4px solid #ff9500;padding:12px 16px;background:#fff7ed;margin-bottom:24px;border-radius:4px;">
             <strong style="color:#c2410c;">⚠️ CMS Write Failed</strong><br>
             <span style="font-size:14px;color:#555;">Free submission received but the CMS item could not be created automatically. Add it manually using the PDF/attachments below.<br><br><code style="font-size:12px;background:#fafafa;padding:4px 8px;border-radius:4px;display:inline-block;">${escapeHtml(cmsErrorMsg || '').slice(0, 300)}</code></span>
           </div>`;

    return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1d1d1f;background:#f5f5f7;">
  <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    ${cmsBanner}

    <h2 style="margin:0 0 8px;font-size:20px;">New GRC Stack Search submission (Free / Inactive)</h2>
    <p style="color:#666;margin:0 0 16px;font-size:14px;">Submission ID: <code style="background:#f5f5f7;padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(submissionId)}</code></p>

    ${summaryTable(data)}

    <p style="margin:24px 0 8px;color:#555;font-size:14px;">📎 Full questionnaire (all sections) is attached as PDF, plus any product images/materials the vendor uploaded.</p>
    ${attachmentsSkippedNote(attachmentsSkipped)}
  </div>
</body></html>`;
}

export function paidEmailHTML({ submissionId, companyName, contactName, contactEmail, amountTotal, currency, paidAt, sessionId, paymentIntent, isTestMode, cmsItemCreated, cmsErrorMsg }) {
    const amount = (amountTotal / 100).toFixed(2);
    const stripeBase = isTestMode
        ? 'https://dashboard.stripe.com/test/payments/'
        : 'https://dashboard.stripe.com/payments/';
    const piLink = paymentIntent ? `${stripeBase}${paymentIntent}` : '#';

    const cmsBanner = cmsItemCreated
        ? `<div style="border-left:4px solid #34c759;padding:12px 16px;background:#f0fdf4;margin-top:24px;border-radius:4px;">
             <strong style="color:#15803d;">📋 CMS Item Created</strong><br>
             <span style="font-size:14px;color:#555;">A draft submission was added to the Stack Search Submissions collection. Review and publish it in Webflow when ready.</span>
           </div>`
        : cmsErrorMsg
        ? `<div style="border-left:4px solid #ff9500;padding:12px 16px;background:#fff7ed;margin-top:24px;border-radius:4px;">
             <strong style="color:#c2410c;">⚠️ CMS Write Failed</strong><br>
             <span style="font-size:14px;color:#555;">Payment succeeded but the CMS item could not be created automatically. Add the submission manually using the pending email's PDF.<br><br><code style="font-size:12px;background:#fafafa;padding:4px 8px;border-radius:4px;display:inline-block;">${escapeHtml(cmsErrorMsg).slice(0, 300)}</code></span>
           </div>`
        : '';

    return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1d1d1f;background:#f5f5f7;">
  <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="border-left:4px solid #34c759;padding:12px 16px;background:#f0fdf4;margin-bottom:24px;border-radius:4px;">
      <strong style="color:#15803d;">✅ Payment Received</strong><br>
      <span style="font-size:14px;color:#555;">Stripe confirmed payment. Full submission data is in the earlier pending email (PDF attached there).</span>
    </div>

    <h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(companyName || 'Unknown company')}</h2>

    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;border-bottom:1px solid #eee;width:140px;">Submission ID</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;"><code style="background:#f5f5f7;padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(submissionId || '—')}</code></td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;border-bottom:1px solid #eee;">Contact</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(contactName || '')}${contactEmail ? ` &lt;${escapeHtml(contactEmail)}&gt;` : ''}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;border-bottom:1px solid #eee;">Amount</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>$${amount} ${escapeHtml(currency)}</strong></td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;border-bottom:1px solid #eee;">Paid at</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(paidAt)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#555;">Stripe transaction</td>
        <td style="padding:8px 12px;"><a href="${escapeHtml(piLink)}" style="color:#0071e3;">View in Stripe Dashboard →</a></td>
      </tr>
    </table>

    ${cmsBanner}

    ${isTestMode ? '<p style="margin-top:24px;padding:12px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e;">⚠️ This is a <strong>TEST MODE</strong> payment. No real money was charged.</p>' : ''}
  </div>
</body></html>`;
}
