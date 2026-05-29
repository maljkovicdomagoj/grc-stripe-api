// CORS helper. Allowed origins set via env var ALLOWED_ORIGINS (comma-separated).
// Defaults to GRC production domain.

const DEFAULT_ORIGINS = ['https://stack.grcreport.com'];

function getAllowedOrigins() {
    const raw = process.env.ALLOWED_ORIGINS;
    if (!raw) return DEFAULT_ORIGINS;
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export function applyCors(req, res) {
    const origin = req.headers.origin;
    const allowed = getAllowedOrigins();
    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}
