// POST /api/stripe-webhook
// Receives signed events from Stripe. On checkout.session.completed,
// sends a "Payment Received" confirmation email.
//
// IMPORTANT: requires bodyParser:false so Stripe signature verification
// can run against the raw request body bytes.

import Stripe from 'stripe';
import { Resend } from 'resend';
import { paidEmailHTML } from '../lib/emails.js';

export const config = {
    api: {
        bodyParser: false,
    },
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
                const session = event.data.object;
                const meta = session.metadata || {};
                const isTestMode = event.livemode === false;

                try {
                    await resend.emails.send({
                        from: FROM_EMAIL,
                        to: NOTIFICATION_EMAIL,
                        subject: `✅ Payment received — ${meta.companyName || 'Unknown company'}`,
                        html: paidEmailHTML({
                            submissionId: meta.submissionId,
                            companyName: meta.companyName,
                            contactName: meta.contactName,
                            contactEmail: meta.contactEmail,
                            amountTotal: session.amount_total,
                            currency: (session.currency || 'usd').toUpperCase(),
                            paidAt: new Date().toISOString(),
                            sessionId: session.id,
                            paymentIntent: session.payment_intent,
                            isTestMode,
                        }),
                    });
                } catch (emailErr) {
                    console.error('Paid email failed:', emailErr);
                    // Don't 500 — Stripe will retry the webhook, we'd get duplicate emails
                }
                break;
            }
            case 'checkout.session.expired':
                console.log('Checkout session expired:', event.data.object.id);
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
