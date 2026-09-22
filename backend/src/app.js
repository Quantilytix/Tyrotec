const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoute');
const quoteRoutes = require('./routes/quoteRoutes');
const orderRoutes = require('./routes/orderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const customerRoutes = require('./routes/customerRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const payfastRoutes = require('./routes/payfastRoutes');
const adminReviewRoutes = require('./routes/adminReviewRoutes');
const activityLogRoutes = require('./routes/activityLogRoutes');
const staffRoutes = require('./routes/staffRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { startInProcessJobs } = require('./jobs/inProcessScheduler');
const { isEnabled } = require('./utils/envFlag');
const { syncDbClock } = require('./utils/dbClock');

const app = express();

// Render (and most PaaS hosts) put this app behind a reverse proxy, which
// sets X-Forwarded-For to the real client IP. Without telling Express to
// trust exactly one hop of proxy, express-rate-limit (authRoutes.js) can't
// safely tell one real client IP from another -- it logged a warning every
// request rather than silently misbehaving, but "trust proxy: false" is
// still wrong here. `1` (not `true`) trusts only the first proxy hop, since
// that's genuinely how many sit between the client and this app on Render --
// trusting more than actually exist would let a client spoof its own IP via
// a forged X-Forwarded-For header.
app.set('trust proxy', 1);

// Browser origins allowed to call this API, comma-separated (the deployed
// frontend URL, e.g. https://portal.tyrotec.co.za). Left unset, any origin is
// allowed -- convenient for local development, but set it in production.
// Server-to-server callers (the PayFast ITN, Meta's WhatsApp webhook) send no
// Origin header, so they're unaffected either way.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Global Middlewares
app.use(helmet());
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));

// Scoped to exactly this path, and registered before the global
// express.json() below, so it captures the raw request bytes into
// req.rawBody -- webhookController's signature check needs the exact bytes
// Meta signed, not a re-serialized copy of the parsed object. body-parser
// (which express.json wraps) marks the request as already-parsed, so the
// global express.json() further down safely skips re-reading this route's
// already-consumed stream instead of double-parsing it.
app.use('/api/whatsapp/webhook', express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Same reasoning as the WhatsApp webhook above, but PayFast's ITN posts
// application/x-www-form-urlencoded, not JSON, so this needs express's
// urlencoded parser instead -- and payfastService's signature check needs
// the exact raw bytes PayFast signed, not a re-serialized copy.
app.use(
  '/api/payments/payfast/notify',
  express.urlencoded({ extended: false, verify: (req, res, buf) => { req.rawBody = buf; } })
);
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments/payfast', payfastRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/admin/reviews', adminReviewRoutes);
app.use('/api/activity-log', activityLogRoutes);
app.use('/api/staff', staffRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

app.use(notFound);
app.use(errorHandler);

// Not required to boot (config/supabase.js already refuses to start without
// the Supabase keys), but each one silently disables a feature when missing --
// a PayFast checkout with no return URL, emails never sent -- so say so loudly
// in the deploy log instead of finding out from a customer.
const EXPECTED_ENV = [
  'FRONTEND_URL',
  'BACKEND_URL',
  'CORS_ORIGINS',
  'PAYFAST_MERCHANT_ID',
  'PAYFAST_MERCHANT_KEY',
  'PAYFAST_RETURN_URL',
  'PAYFAST_CANCEL_URL',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'GEMINI_API_KEY',
];

// Start Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const missingEnv = EXPECTED_ENV.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    console.warn(`Missing environment variables (the features that use them won't work): ${missingEnv.join(', ')}`);
  }
  // Measure the gap between this host's clock and the database's up front,
  // so the first order page already counts down correctly and a badly set
  // host clock is reported at boot rather than discovered as a mysterious
  // "reservation expired".
  syncDbClock();

  if (!process.env.BREVO_API_KEY && !process.env.SMTP_HOST) {
    console.warn('No email provider configured (BREVO_API_KEY or SMTP_HOST): email notifications are disabled.');
  } else if (!process.env.EMAIL_FROM && !process.env.SMTP_FROM) {
    console.warn('EMAIL_FROM is not set: emails have no sender address and will be rejected.');
  }

  // Hosting without scheduled jobs (Render Free) runs the reservation jobs
  // here instead -- see jobs/inProcessScheduler.js for why only one instance
  // may have this on. Says so either way: a silent "off" looks identical to a
  // working job until stock quietly stays reserved for days.
  if (isEnabled(process.env.RUN_JOBS_IN_PROCESS)) {
    startInProcessJobs();
    console.log('Reservation warning/release jobs running in-process every 5 minutes.');
  } else {
    console.warn(
      `Reservation jobs are OFF (RUN_JOBS_IN_PROCESS=${JSON.stringify(process.env.RUN_JOBS_IN_PROCESS ?? null)}). ` +
        'Expired stock reservations will not be released. Set it to "true", or run the cron jobs.'
    );
  }
});

// Render sends SIGTERM to the old instance once a new deploy is live. Stop
// taking new connections but let in-flight requests finish -- a PayFast ITN
// cut off halfway would leave PayFast retrying a half-processed payment.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

module.exports = app;
