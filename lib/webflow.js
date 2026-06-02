// Webflow CMS v2 API client for creating Stack Search Submission items.
// Collection schema (slugs): name, slug, submission-id, status (Option),
// stripe-session-id, stripe-payment-intent, paid-at (DateTime),
// amount-cents (Number), company-name, contact-name, contact-email (Email),
// contact-phone, submitted-at (DateTime), website (Link), full-data (RichText)

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_SUBMISSIONS_COLLECTION_ID;
const WEBFLOW_API_BASE = 'https://api.webflow.com/v2';

function ensureWebflowConfigured() {
    if (!WEBFLOW_API_TOKEN || !WEBFLOW_COLLECTION_ID) {
        throw new Error('Webflow not configured (WEBFLOW_API_TOKEN / WEBFLOW_SUBMISSIONS_COLLECTION_ID missing)');
    }
}

// Convert a string into a URL-safe slug (alphanumeric + hyphens, lowercase).
function slugify(text, maxLength = 100) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')      // strip diacritics
        .replace(/[^a-z0-9\s-]/g, '')          // remove non-alphanum (except spaces/hyphens)
        .trim()
        .replace(/\s+/g, '-')                  // spaces to hyphens
        .replace(/-+/g, '-')                   // collapse multiple hyphens
        .slice(0, maxLength)
        .replace(/^-|-$/g, '');                // trim leading/trailing hyphens
}

// Format full questionnaire data as a readable HTML block for the RichText field.
function formatFullDataHTML(data) {
    const sections = {
        'Contact Information': ['firstName', 'lastName', 'title', 'email', 'phone'],
        'Company': ['companyName', 'companyDescription', 'yearFounded', 'mainPhone', 'generalEmail', 'website'],
        'Headquarters': ['hqStreet', 'hqCity', 'hqState', 'hqPostal', 'hqCountry', 'regionsActive'],
        'Company Details': ['companySize', 'companyType', 'tickerSymbol', 'latestRevenue', 'previousRevenue', 'investors', 'executives'],
        'Social Media': ['twitter', 'linkedin'],
        'GRC Offerings': ['grcSoftware', 'grcSoftwareList', 'grcServices', 'grcServicesList', 'grcContent', 'grcContentList'],
        'Market Position': ['competitors', 'industries', 'specificIndustries'],
        'Capabilities': ['auditManagement', 'businessContinuity', 'complianceEthics', 'environmental', 'healthSafety', 'internalControl', 'issueReporting', 'kyc', 'legal', 'physicalSecurity', 'quality', 'reputation', 'riskManagement', 'thirdParty'],
    };

    const labels = {
        firstName: 'First Name', lastName: 'Last Name', title: 'Title', email: 'Email', phone: 'Phone',
        companyName: 'Company Name', companyDescription: 'Description', yearFounded: 'Year Founded',
        mainPhone: 'Main Phone', generalEmail: 'General Email', website: 'Website',
        hqStreet: 'Street', hqCity: 'City', hqState: 'State', hqPostal: 'Postal Code', hqCountry: 'Country',
        regionsActive: 'Regions Active', companySize: 'Size', companyType: 'Type', tickerSymbol: 'Ticker',
        latestRevenue: 'Latest Revenue', previousRevenue: 'Previous Revenue',
        investors: 'Investors', executives: 'Executives',
        twitter: 'Twitter', linkedin: 'LinkedIn',
        grcSoftware: 'GRC Software', grcSoftwareList: 'Software List',
        grcServices: 'GRC Services', grcServicesList: 'Services List',
        grcContent: 'GRC Content', grcContentList: 'Content List',
        competitors: 'Competitors', industries: 'Industries', specificIndustries: 'Industry-Specific',
        auditManagement: 'Audit Management', businessContinuity: 'Business Continuity',
        complianceEthics: 'Compliance & Ethics', environmental: 'Environmental',
        healthSafety: 'Health & Safety', internalControl: 'Internal Control',
        issueReporting: 'Issue Reporting', kyc: 'KYC', legal: 'Legal',
        physicalSecurity: 'Physical Security', quality: 'Quality', reputation: 'Reputation',
        riskManagement: 'Risk Management', thirdParty: 'Third Party',
    };

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    let html = '';
    for (const [sectionTitle, fields] of Object.entries(sections)) {
        const hasContent = fields.some(f => data[f] && String(data[f]).trim() !== '');
        if (!hasContent) continue;
        html += `<h3>${esc(sectionTitle)}</h3>`;
        for (const field of fields) {
            const val = data[field];
            if (!val || String(val).trim() === '') continue;
            const label = labels[field] || field;
            html += `<p><strong>${esc(label)}:</strong> ${esc(val).replace(/\n/g, '<br>')}</p>`;
        }
    }
    return html || '<p>No data provided.</p>';
}

// Create a Submission CMS item as a DRAFT (William manually reviews and publishes).
// Returns the created item or throws on error.
export async function createSubmissionItem({
    submissionId,
    companyName,
    contactName,
    contactEmail,
    contactPhone,
    website,
    submittedAt,
    paidAt,
    stripeSessionId,
    stripePaymentIntent,
    amountCents,
    fullData,
}) {
    ensureWebflowConfigured();

    const itemName = `${companyName} — ${submissionId.slice(0, 8)}`.slice(0, 256);
    const itemSlug = slugify(`${companyName}-${submissionId.slice(0, 8)}`, 100);

    const fieldData = {
        name: itemName,
        slug: itemSlug,
        'submission-id': submissionId,
        'status': 'paid',
        'stripe-session-id': stripeSessionId || '',
        'stripe-payment-intent': stripePaymentIntent || '',
        'paid-at': paidAt,
        'amount-cents': amountCents,
        'company-name': companyName,
        'contact-name': contactName || '',
        'contact-email': contactEmail || '',
        'contact-phone': contactPhone || '',
        'submitted-at': submittedAt,
        'full-data': formatFullDataHTML(fullData || {}),
    };

    // Only include website if it looks like a URL (Link field validates this)
    if (website && /^https?:\/\//i.test(website)) {
        fieldData.website = website;
    }

    const url = `${WEBFLOW_API_BASE}/collections/${WEBFLOW_COLLECTION_ID}/items`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WEBFLOW_API_TOKEN}`,
            'Content-Type': 'application/json',
            'accept-version': '2.0.0',
        },
        body: JSON.stringify({
            isArchived: false,
            isDraft: true,    // sjedi kao draft — William publish-a ručno nakon reviewa
            fieldData,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errDetail;
        try { errDetail = JSON.parse(errText); } catch { errDetail = errText; }
        const err = new Error(`Webflow CMS create failed (${response.status}): ${JSON.stringify(errDetail)}`);
        err.status = response.status;
        err.detail = errDetail;
        throw err;
    }

    return response.json();
}
