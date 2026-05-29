// POST /api/create-checkout
// 1. Validates form data (required fields, email format, honeypot)
// 2. Sends pending email to NOTIFICATION_EMAIL with PDF attachment
// 3. Creates Stripe Checkout session with submissionId in metadata
// 4. Returns { checkoutUrl, submissionId } to client

import Stripe from 'stripe';
import { Resend } from 'resend';
import { randomUUID } from 'node:crypto';
import { applyCors } from '../lib/cors.js';
import { pendingEmailHTML } from '../lib/emails.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const FROM_EMAIL = process.env.FROM_EMAIL || 'GRC Stack Search <onboarding@resend.dev>';
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://stack.grcreport.com';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'companyName'];

export default async function handler(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    if (!STRIPE_PRICE_ID || !process.env.STRIPE_SECRET_KEY || !NOTIFICATION_EMAIL || !process.env.RESEND_API_KEY) {
        console.error('Missing required env vars');
        return res.status(500).json({ message: 'Server configuration error. Please contact wg@grcreport.com.' });
    }

    try {
        const body = req.body || {};

        // Honeypot — silently reject bots
        if (body.website_url_hp && String(body.website_url_hp).trim() !== '') {
            console.warn('Honeypot triggered from IP:', req.headers['x-forwarded-for']);
            // Pretend it worked so bots don't retry
            return res.status(200).json({ checkoutUrl: PUBLIC_SITE_URL, submissionId: 'bot-' + randomUUID() });
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

        // Extract PDF (don't pass it back to Stripe metadata or anywhere weird)
        const pdfBase64 = body.pdfBase64;
        const pdfFilename = body.pdfFilename || `GRC-Submission-${submissionId}.pdf`;

        // Clean copy for email (no PDF, no honeypot)
        const cleanData = { ...body };
        delete cleanData.pdfBase64;
        delete cleanData.pdfFilename;
        delete cleanData.website_url_hp;

        // Create Stripe Checkout session
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
            customer_email: body.email,
            success_url: `${PUBLIC_SITE_URL}/submission-success?session_id={CHECKOUT_SESSION_ID}&sid=${submissionId}`,
            cancel_url: `${PUBLIC_SITE_URL}/submission-cancelled?sid=${submissionId}`,
            metadata: {
                submissionId,
                companyName: companyName.slice(0, 500),
                contactEmail: body.email.slice(0, 500),
                contactName: contactName.slice(0, 500),
            },
            // To allow Stripe-managed promotion codes later, uncomment:
            // allow_promotion_codes: true,
        });

        // Send pending email with PDF (don't fail the request if email fails)
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: NOTIFICATION_EMAIL,
                reply_to: body.email,
                subject: `🟡 New submission (awaiting payment) — ${companyName}`,
                html: pendingEmailHTML({
                    submissionId,
                    data: cleanData,
                    checkoutUrl: session.url,
                }),
                attachments: pdfBase64 ? [{
                    filename: pdfFilename,
                    content: pdfBase64,
                }] : [],
            });
        } catch (emailErr) {
            console.error('Pending email failed (non-fatal):', emailErr);
        }

        return res.status(200).json({
            checkoutUrl: session.url,
            submissionId,
        });
    } catch (err) {
        console.error('create-checkout error:', err);
        const message = err?.raw?.message || err?.message || 'Server error. Please try again or contact wg@grcreport.com.';
        return res.status(500).json({ message });
    }
}
