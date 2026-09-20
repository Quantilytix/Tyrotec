const nodemailer = require('nodemailer');
const supabase = require('../config/supabase');
const { sendText } = require('../config/whatsapp');
const { STAFF_ROLES } = require('../utils/roles');

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

let transporter = null;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

// The sender as configured -- `Tyrotec <sales@tyrotec.co.za>` or a bare
// address. EMAIL_FROM is the current name; SMTP_FROM still works so existing
// SMTP setups don't need renaming.
function senderAddress() {
  return process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '';
}

function parseSender(from) {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"|"$/g, '') || undefined, email: match[2].trim() };
  return { email: from.trim() };
}

// Brevo's transactional email API over HTTPS. Used whenever BREVO_API_KEY is
// set, because hosts like Render's Free plan block outbound SMTP ports (25,
// 465, 587) but not HTTPS.
// attachments: [{ filename, content: Buffer }] -- Brevo takes each file as
// base64 alongside the message, so a quote PDF rides along with the email
// rather than needing somewhere public to host it.
async function sendViaBrevo(to, subject, text, attachments = []) {
  const res = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseSender(senderAddress()),
      to: [{ email: to }],
      subject,
      textContent: text,
      ...(attachments.length > 0 && {
        attachment: attachments.map((file) => ({
          name: file.filename,
          content: Buffer.from(file.content).toString('base64'),
        })),
      }),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo responded ${res.status}: ${detail.slice(0, 200)}`);
  }
}

// Swallows its own errors: notifications are fire-and-forget side channels,
// and a bounced email must never fail the action that triggered it. Callers
// that need to *know* whether it went out (sending a quote to a customer on
// request) use sendEmailOrThrow below instead.
async function sendEmail(to, subject, text, { attachments = [] } = {}) {
  if (!to) return;
  try {
    await sendEmailOrThrow(to, subject, text, { attachments });
  } catch (err) {
    console.error('Failed to send email to', to, '-', err.message);
  }
}

// Same send, but surfaces failures. Used where a person clicked "send" and is
// waiting to hear whether it worked.
async function sendEmailOrThrow(to, subject, text, { attachments = [] } = {}) {
  if (!to) throw new Error('No email address to send to.');
  if (!isEmailConfigured()) {
    throw new Error('Email is not set up on the server yet, so this could not be sent.');
  }
  if (!senderAddress()) {
    throw new Error('No sender address is configured (EMAIL_FROM), so this could not be sent.');
  }

  if (process.env.BREVO_API_KEY) {
    await sendViaBrevo(to, subject, text, attachments);
    return;
  }

  await getTransporter().sendMail({
    from: senderAddress(),
    to,
    subject,
    text,
    ...(attachments.length > 0 && {
      attachments: attachments.map((file) => ({ filename: file.filename, content: file.content })),
    }),
  });
}

// Whether any email provider is configured at all -- checked before promising
// a user their email was sent.
function isEmailConfigured() {
  return Boolean(process.env.BREVO_API_KEY || process.env.SMTP_HOST);
}

// Creates an in-app notification for one user and, if given, emails and/or
// WhatsApps them too -- whichever contact channels the caller has on hand.
// Neither is awaited: a real SMTP send (Gmail included) takes several
// seconds and a WhatsApp Graph API call is its own network round trip, and
// every caller of notifyUser sits in the middle of a latency-sensitive
// request -- a WhatsApp webhook reply, a PayFast ITN response, an admin
// action's response. Blocking any of those on a side-channel message nobody
// is synchronously waiting on made every one of them feel sluggish for no
// benefit; both sendEmail and sendText already swallow their own errors, so
// firing them and moving on is safe -- the process stays alive to finish
// them since this is a long-running server, not a serverless function. The
// one caller that doesn't stay alive on its own (the reservation-expiry
// cron job) accounts for that itself rather than forcing every other caller
// to wait around for a channel it may not have even been given.
async function notifyUser({ userId, type, title, message, relatedType, relatedId, email, phone }) {
  const { error } = await supabase.from('notifications').insert([{
    user_id: userId,
    type,
    title,
    message,
    related_type: relatedType || null,
    related_id: relatedId || null,
  }]);

  if (error) console.error('Failed to create notification:', error.message);
  if (email) sendEmail(email, title, message);
  if (phone) sendText(phone, message);
}

// Notifies every staff member (including super admins), both in-app and by
// email. Same
// fire-and-forget reasoning as notifyUser above -- the in-app notification
// insert is awaited (it's what other admins/sales_reps actually see), the
// emails are not.
async function notifyInternalTeam({ type, title, message, relatedType, relatedId }) {
  const { data: staff, error } = await supabase
    .from('users')
    .select('id, email')
    .in('role', STAFF_ROLES);

  if (error) {
    console.error('Failed to load internal team for notification:', error.message);
    return;
  }
  if (!staff || staff.length === 0) return;

  const rows = staff.map((s) => ({
    user_id: s.id,
    type,
    title,
    message,
    related_type: relatedType || null,
    related_id: relatedId || null,
  }));

  const { error: insertErr } = await supabase.from('notifications').insert(rows);
  if (insertErr) console.error('Failed to create internal notifications:', insertErr.message);

  staff.forEach((s) => sendEmail(s.email, title, message));
}

module.exports = { notifyUser, notifyInternalTeam, sendEmail, sendEmailOrThrow, isEmailConfigured };
