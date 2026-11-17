# Quenic Fast Food

Node.js 20+ / Express / SQLite food ordering starter.

## Included in this source package
- Responsive customer menu, registration/login, cart and order history
- Server-side price validation, COD ordering, coupons and customer order lookup
- Admin product add/edit price/availability/delete and coupon management
- Store settings: store name, phone, address, opening hours, delivery fee and delivery note
- Staff role separation: kitchen can move orders through Preparing/Ready; delivery can move Ready/Out for Delivery/Delivered; admin has full order controls
- Razorpay Checkout.js browser flow, server-side order creation, signature verification, and gateway-side captured-payment/amount/currency check
- Printable customer order bill (not a tax invoice)
- Manual SQLite online backup command
- JWT authentication, bcrypt password hashing, Helmet and API rate limiting

## Setup
1. Install Node.js 20 or newer.
2. Extract ZIP, run `npm install`.
3. Copy `.env.example` to `.env`; set a private random `JWT_SECRET` (32+ characters).
4. Run `npm run create-admin` once to create the owner login.
5. Optional: run `npm run create-staff` separately for each kitchen/delivery staff account.
6. Run `npm start`; open `http://localhost:3000`.
7. For Razorpay, set the merchant's live/test `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in server `.env`, restart, and test a full payment in test mode before enabling live credentials.
8. Run `npm run backup` to create a consistent SQLite backup in `backups/`.

## Still required before public launch
- Real Razorpay merchant account credentials and successful end-to-end test; payment popup cannot be tested without them.
- Real store contact, address, hours, delivery zones, menu, prices, and image URLs must be entered/verified by owner.
- Hosting with HTTPS, persistent disk for SQLite, environment secrets, firewall and monitoring.
- Automated SMS/WhatsApp notifications require a chosen provider account/API credentials and template approval; not configured in this project.
- Live map-based rider tracking requires a rider app/device location service; not included.
- Refund initiation requires an owner-approved Razorpay refund workflow and credentials; not included.
- GST/tax invoice configuration requires the owner's actual GST registration/tax settings; current printout is a basic order receipt, not a GST invoice.
- Configure off-site/automatic backups on the hosting provider; the included command is a manual local backup.
- Publish privacy, terms, cancellation/refund, delivery and food registration details applicable to the business.

This ZIP is source code, not a deployed live website. Never share owner credentials or put Razorpay secrets in browser code.


## Admin account on Render (without Shell)

In your Render Web Service, open **Environment** and add these three variables:

- `ADMIN_NAME` — the admin display name
- `ADMIN_PHONE` — the admin's 10-digit phone number
- `ADMIN_PASSWORD` — a new, unique password with at least 12 characters

Save changes and redeploy. On startup, the server creates or updates the account for that configured phone number with the `admin` role. The credentials are read from Render environment variables; do not put them in source code or share them. After the first successful setup, you may remove these three variables and redeploy; the created account remains in the database as long as the database storage persists.
