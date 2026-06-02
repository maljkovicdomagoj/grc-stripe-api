// Vercel KV wrapper using REST API (no SDK needed, works on Node serverless)
// Stores form data between create-checkout and stripe-webhook (24h TTL by default)
// and processed webhook event IDs (7-day TTL for idempotency).

const KV_URL = process.env.NEW_KV_REST_API_URL;
const KV_TOKEN = process.env.NEW_KV_REST_API_TOKEN;

function ensureKvConfigured() {
    if (!KV_URL || !KV_TOKEN) {
        throw new Error('Vercel KV is not configured (NEW_KV_REST_API_URL / NEW_KV_REST_API_TOKEN missing)');
    }
}

async function kvFetch(pathSegments, options = {}) {
    ensureKvConfigured();
    const url = `${KV_URL}/${pathSegments.join('/')}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${KV_TOKEN}`,
            ...(options.headers || {}),
        },
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`KV error ${response.status}: ${text || response.statusText}`);
    }
    return response.json();
}

// Store a JSON value under a key with TTL in seconds. Uses Redis SET with EX.
export async function kvSet(key, value, ttlSeconds = 86400) {
    const encoded = encodeURIComponent(JSON.stringify(value));
    return kvFetch(['set', key, encoded, 'ex', String(ttlSeconds)]);
}

// Retrieve a JSON value. Returns parsed value or null if not found.
export async function kvGet(key) {
    const res = await kvFetch(['get', key]);
    if (res?.result == null) return null;
    try {
        return JSON.parse(res.result);
    } catch {
        return res.result;
    }
}

// Delete a key.
export async function kvDel(key) {
    return kvFetch(['del', key]);
}

// Check if key exists (returns true/false).
export async function kvExists(key) {
    const res = await kvFetch(['exists', key]);
    return res?.result === 1;
}

// === Convenience helpers for our use cases ===

const SUBMISSION_PREFIX = 'submission:';
const EVENT_PREFIX = 'stripe-event:';

export async function storeSubmission(submissionId, data, ttlSeconds = 86400) {
    return kvSet(SUBMISSION_PREFIX + submissionId, data, ttlSeconds);
}

export async function getSubmission(submissionId) {
    return kvGet(SUBMISSION_PREFIX + submissionId);
}

export async function deleteSubmission(submissionId) {
    return kvDel(SUBMISSION_PREFIX + submissionId);
}

// Idempotency: returns true if event was already processed, false if first time.
// Marks as processed atomically using SET NX (only set if not exists).
export async function markEventProcessed(eventId, ttlSeconds = 7 * 86400) {
    try {
        // SETNX returns 1 if set, 0 if already exists
        const url = `${KV_URL}/setnx/${EVENT_PREFIX + eventId}/processed`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
        });
        if (!response.ok) throw new Error(`KV setnx failed: ${response.statusText}`);
        const data = await response.json();
        if (data?.result === 1) {
            // Newly set — apply TTL
            await kvFetch(['expire', EVENT_PREFIX + eventId, String(ttlSeconds)]);
            return false; // wasn't processed yet
        }
        return true; // already processed
    } catch (err) {
        console.error('markEventProcessed error:', err);
        // On error, return false to allow processing (better to send duplicate email than skip)
        return false;
    }
}
