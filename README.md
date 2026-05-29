# GRC Stack Search — Stripe Checkout Backend

Vercel serverless API + static JS host for the GRC Stack Search questionnaire form on stack.grcreport.com.

## What this does

1. Receives questionnaire submissions from the Webflow form (`grc-form.js` runs in the browser, fetches this API)
2. Validates form data, generates a Stripe Checkout session
3. Emails the submission (with PDF attached) to NOTIFICATION_EMAIL as "pending"
4. After Stripe confirms payment via webhook, emails a "paid" confirmation

## Setup

### 1. Install & push to GitHub

```bash
cd grc-stripe-api
npm install
git init
git add .
git commit -m "Initial commit"
# Create new repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/grc-stripe-api.git
git branch -M main
git push -u origin main
```

### 2. Deploy to Vercel

- Go to https://vercel.com → Add New → Project
- Import the GitHub repo
- Framework Preset: **Other** (Vercel auto-detects Node functions from `/api`)
- Root directory: `./`
- Build & Output settings: leave defaults
- Click **Deploy**

After first deploy, note the production URL (e.g. `https://grc-stripe-api-xxxx.vercel.app`).

### 3. Environment variables

In Vercel: Project → Settings → Environment Variables. Add these for both **Production** and **Preview**:

| Variable | Value |
|----------|-------|
| `STRIPE_SECRET_KEY` | `sk_test_...` (from Stripe Dashboard → Developers → API keys, **Test mode**) |
| `STRIPE_PRICE_ID` | `price_...` (from the GRC Stack Search Vendor Listing product, Test mode) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (set in step 5 below — leave empty for now) |
| `RESEND_API_KEY` | `re_...` (from resend.com) |
| `NOTIFICATION_EMAIL` | The inbox that receives all submission notifications |
| `FROM_EMAIL` | `GRC Stack Search <onboarding@resend.dev>` (until grcreport.com is verified in Resend) |
| `ALLOWED_ORIGINS` | `https://stack.grcreport.com,https://YOUR-SITE.webflow.io` |
| `PUBLIC_SITE_URL` | `https://stack.grcreport.com` |

After adding env vars, **redeploy** (Deployments → click latest → Redeploy) so they take effect.

### 4. Update the Webflow embed

In your Webflow page, find the embed and update the script src to point at your Vercel domain:

```html
<script src="https://YOUR-VERCEL-DOMAIN.vercel.app/grc-form.js"></script>
```

Also open `public/grc-form.js` and set:

```js
const API_ENDPOINT = 'https://YOUR-VERCEL-DOMAIN.vercel.app/api/create-checkout';
```

Commit and push — Vercel auto-deploys.

### 5. Set up Stripe webhook (after first deploy)

- Stripe Dashboard → Developers → Webhooks → Add endpoint
- Endpoint URL: `https://YOUR-VERCEL-DOMAIN.vercel.app/api/stripe-webhook`
- Events to listen to:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.payment_failed`
- Add endpoint → click into it → reveal **Signing secret** (`whsec_...`)
- Copy that and add to Vercel env vars as `STRIPE_WEBHOOK_SECRET`
- Redeploy (Vercel)

## Testing

1. Visit the questionnaire page on stack.grcreport.com (or your Webflow preview URL)
2. Fill out the form, click Submit & Pay
3. You should:
   - Get redirected to Stripe Checkout
   - Receive the "🟡 New submission (awaiting payment)" email with PDF attached
4. On Stripe Checkout, use test card: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP
5. Complete payment → redirected back to stack.grcreport.com
6. Within ~5 seconds you should receive the "✅ Payment received" email

### Other test cards

- `4000 0000 0000 9995` — insufficient funds decline
- `4000 0025 0000 3155` — requires 3D Secure authentication
- Full list: https://docs.stripe.com/testing#cards

## Going to production

1. In Stripe Dashboard, toggle to **Live mode**
2. Re-create the Product + Price in Live mode → copy new `price_...` (different from test mode)
3. Get the Live secret key (`sk_live_...`) from Developers → API keys
4. Create new webhook endpoint in Live mode pointing at the same Vercel URL → copy new `whsec_...`
5. Update Vercel env vars with live values
6. Verify your domain in Resend and switch `FROM_EMAIL` to a verified address like `noreply@grcreport.com`

## File layout

```
api/
  create-checkout.js    POST /api/create-checkout
  stripe-webhook.js     POST /api/stripe-webhook
lib/
  cors.js               CORS allowed-origins helper
  emails.js             pending + paid email HTML templates
public/
  grc-form.js           browser JS for the Webflow embed
```
