// POST /api/stripe-webhook
// On checkout.session.completed:
//   1. Verifies Stripe signature (rejects unsigned/tampered requests)
//   2. Checks idempotency — skip if event already processed (Stripe may retry)
//   3. Pulls full form data from Vercel KV using submissionId
//   4. Creates a draft Webflow CMS item (status: paid) — William publishes manually after review
//   5. Sends paid confirmation email to NOTIFICATION_EMAIL
//   6. Cleans up KV
//
// On checkout.session.expired and payment_intent.payment_failed: logged only.

import Stripe from 'stripe';
import { Resend } from 'resend';
import { paidEmailHTML, getNotificationRecipients } from '../lib/emails.js';
import { getSubmission, deleteSubmission, markEventProcessed } from '../lib/kv.js';
import { createSubmissionItem } from '../lib/webflow.js';

export const config = {
    api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL || 'GRC Stack Search <onboarding@resend.dev>';

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    if (!WEBHOOK_SECRET) {
        console.error('STRIPE_WEBHOOK_SECRET not set');
        return res.status(500).json({ message: 'Webhook not configured' });
    }

    let event;
    try {
        const rawBody = await readRawBody(req);
        const sig = req.headers['stripe-signature'];
        event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                // === Idempotency check — skip if Stripe already retried this event ===
                const alreadyProcessed = await markEventProcessed(event.id);
                if (alreadyProcessed) {
                    console.log(`Event ${event.id} already processed — skipping`);
                    return res.status(200).json({ received: true, duplicate: true });
                }

                const session = event.data.object;
                const meta = session.metadata || {};
                const submissionId = meta.submissionId;
                const isTestMode = event.livemode === false;

                // === Pull full form data from KV ===
                let kvData = null;
                if (submissionId) {
                    try {
                        kvData = await getSubmission(submissionId);
                    } catch (err) {
                        console.error('KV get failed:', err);
                    }
                }

                if (!kvData) {
                    console.warn(`No KV data for submission ${submissionId} — CMS write will use Stripe metadata only`);
                }

                // === Create Webflow CMS item (draft, William publishes after review) ===
                let cmsItemCreated = false;
                let cmsErrorMsg = null;
                try {
                    await createSubmissionItem({
                        submissionId: submissionId || `unknown-${event.id}`,
                        companyName: kvData?.companyName || meta.companyName || 'Unknown',
                        contactName: kvData?.contactName || meta.contactName || '',
                        contactEmail: kvData?.contactEmail || meta.contactEmail || '',
                        contactPhone: kvData?.contactPhone || '',
                        website: kvData?.website || '',
                        submittedAt: kvData?.submittedAt || meta.submittedAt || new Date().toISOString(),
                        paidAt: new Date().toISOString(),
                        stripeSessionId: session.id,
                        stripePaymentIntent: session.payment_intent || '',
                        amountCents: session.amount_total || 0,
                        fullData: kvData?.formData || {},
                        active: true,
                        status: 'paid',
                    });
                    cmsItemCreated = true;
                } catch (cmsErr) {
                    console.error('Webflow CMS create failed:', cmsErr);
                    cmsErrorMsg = cmsErr?.message || String(cmsErr);
                }

                // === Send paid confirmation email ===
                try {
                    await resend.emails.send({
                        from: FROM_EMAIL,
                        to: getNotificationRecipients(),
                        subject: `✅ Payment received — ${meta.companyName || 'Unknown company'}${cmsItemCreated ? '' : ' (⚠️ CMS write failed)'}`,
                        html: paidEmailHTML({
                            submissionId,
                            companyName: meta.companyName,
                            contactName: meta.contactName,
                            contactEmail: meta.contactEmail,
                            amountTotal: session.amount_total,
                            currency: (session.currency || 'usd').toUpperCase(),
                            paidAt: new Date().toISOString(),
                            sessionId: session.id,
                            paymentIntent: session.payment_intent,
                            isTestMode,
                            cmsItemCreated,
                            cmsErrorMsg,
                        }),
                    });
                } catch (emailErr) {
                    console.error('Paid email failed:', emailErr);
                }

                // === Clean up KV (free space, not strictly necessary thanks to TTL) ===
                if (submissionId && kvData) {
                    try {
                        await deleteSubmission(submissionId);
                    } catch (err) {
                        console.error('KV delete failed (non-fatal):', err);
                    }
                }

                break;
            }
            case 'checkout.session.expired':
                console.log('Checkout session expired:', event.data.object.id);
                // Future: send "submission abandoned" email if desired
                break;
            case 'payment_intent.payment_failed':
                console.log('Payment failed:', event.data.object.id, event.data.object.last_payment_error?.message);
                break;
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('Webhook handler error:', err);
        return res.status(500).json({ message: 'Webhook handler failed' });
    }
}
