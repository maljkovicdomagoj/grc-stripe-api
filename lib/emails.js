// HTML email templates for pending (submission received) and paid (payment confirmed) states.

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

export function pendingEmailHTML({ submissionId, data, checkoutUrl }) {
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

    <p style="margin:24px 0 8px;color:#555;font-size:14px;">📎 Full questionnaire (all 20 sections) is attached as PDF.</p>

    <hr style="margin:32px 0;border:0;border-top:1px solid #eee;">
    <p style="font-size:12px;color:#999;margin:0;">Stripe Checkout session (for support reference):<br><a href="${escapeHtml(checkoutUrl || '')}" style="color:#999;word-break:break-all;">${escapeHtml(truncatedUrl || '')}</a></p>
  </div>
</body></html>`;
}

export function paidEmailHTML({ submissionId, companyName, contactName, contactEmail, amountTotal, currency, paidAt, sessionId, paymentIntent, isTestMode }) {
    const amount = (amountTotal / 100).toFixed(2);
    const stripeBase = isTestMode
        ? 'https://dashboard.stripe.com/test/payments/'
        : 'https://dashboard.stripe.com/payments/';
    const piLink = paymentIntent ? `${stripeBase}${paymentIntent}` : '#';
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

    ${isTestMode ? '<p style="margin-top:24px;padding:12px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e;">⚠️ This is a <strong>TEST MODE</strong> payment. No real money was charged.</p>' : ''}
  </div>
</body></html>`;
}
