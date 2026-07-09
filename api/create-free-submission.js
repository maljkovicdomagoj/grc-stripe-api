// POST /api/create-free-submission
// 1. Validates form data (required fields, email format, honeypot)
// 2. Creates a draft Webflow CMS item immediately — Active=false, status=pending
//    (William publishes/activates manually, or it flips to Active on later payment)
// 3. Sends a free-submission email to NOTIFICATION_EMAIL with PDF + file attachments
// 4. Returns { ok: true, submissionId }
//
// No Stripe checkout, no Vercel KV — unlike the paid flow, the CMS item is written
// synchronously here since there's no webhook step to defer it to.

import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { applyCors } from '../lib/cors.js';
import { freeEmailHTML, getNotificationRecipients, buildEmailAttachments } from '../lib/emails.js';
import { createSubmissionItem } from '../lib/webflow.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL || 'GRC Stack Search <onboarding@resend.dev>';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'companyName'];

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    if (!NOTIFICATION_EMAIL || !process.env.RESEND_API_KEY) {
        console.error('Missing required env vars');
        return res.status(500).json({ message: 'Server configuration error. Please contact wg@grcreport.com.' });
    }

    try {
        const body = req.body || {};

        // Honeypot — silently reject bots
        if (body.website_url_hp && String(body.website_url_hp).trim() !== '') {
            console.warn('Honeypot triggered from IP:', req.headers['x-forwarded-for']);
            return res.status(200).json({ ok: true, submissionId: 'bot-' + randomUUID() });
        }

        // Required field validation
        for (const field of REQUIRED_FIELDS) {
            if (!body[field] || String(body[field]).trim() === '') {
                return res.status(400).json({ message: `Missing required field: ${field}` });
            }
        }
        if (!EMAIL_REGEX.test(body.email)) {
            return res.status(400).json({ message: 'Invalid email address' });
        }

        const submissionId = randomUUID();
        const companyName = String(body.companyName).trim();
        const contactName = `${body.firstName} ${body.lastName}`.trim();
        const submittedAt = new Date().toISOString();

        const pdfBase64 = body.pdfBase64;
        const pdfFilename = body.pdfFilename || `GRC-Submission-${submissionId}.pdf`;
        const incomingAttachments = Array.isArray(body.fileAttachments) ? body.fileAttachments : [];

        const cleanData = { ...body };
        delete cleanData.pdfBase64;
        delete cleanData.pdfFilename;
        delete cleanData.fileAttachments;
        delete cleanData.website_url_hp;

        // === Create Webflow CMS item immediately as an Inactive draft ===
        let cmsItemCreated = false;
        let cmsErrorMsg = null;
        try {
            await createSubmissionItem({
                submissionId,
                companyName,
                contactName,
                contactEmail: body.email,
                contactPhone: body.phone || '',
                website: body.website || '',
                submittedAt,
                fullData: cleanData,
                active: false,
                status: 'pending',
            });
            cmsItemCreated = true;
        } catch (cmsErr) {
            console.error('Webflow CMS create failed (non-fatal — free submission still recorded via email):', cmsErr);
            cmsErrorMsg = cmsErr?.message || String(cmsErr);
        }

        // === Send free-submission email with PDF + attachments (non-fatal) ===
        try {
            const { attachments, skipped: attachmentsSkipped } = buildEmailAttachments({
                pdfBase64,
                pdfFilename,
                fileAttachments: incomingAttachments,
            });

            await resend.emails.send({
                from: FROM_EMAIL,
                to: getNotificationRecipients(),
                reply_to: body.email,
                subject: `🆓 Free submission (Inactive) — ${companyName}`,
                html: freeEmailHTML({
                    submissionId,
                    data: cleanData,
                    cmsItemCreated,
                    cmsErrorMsg,
                    attachmentsSkipped,
                }),
                attachments,
            });
        } catch (emailErr) {
            console.error('Free submission email failed (non-fatal):', emailErr);
        }

        return res.status(200).json({ ok: true, submissionId });
    } catch (err) {
        console.error('create-free-submission error:', err);
        const message = err?.message || 'Server error. Please try again or contact wg@grcreport.com.';
        return res.status(500).json({ message });
    }
}
