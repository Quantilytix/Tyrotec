const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { sendText, sendButtons } = require('../../config/whatsapp');
const { findUserByPhone } = require('../whatsappConversationService');

const HAS_ACCOUNT_BUTTONS = [
  { id: 'has_account_yes', title: 'Yes' },
  { id: 'has_account_no', title: 'No' },
];

const MAX_EMAIL_ATTEMPTS = 5;

async function greetAndShowMenu(phone, user) {
  const { sendMenu } = require('./mainMenu');
  await sendMenu(phone, `👋 Welcome back${user.full_name ? `, ${user.full_name}` : ''}!`);
  return { newState: 'main_menu', newContext: {}, newUserId: user.id };
}

// Runs on every message from a phone with no linked account yet. `state`
// tracks which step of this sub-flow they're in; a brand new conversation
// (no prior state reaching here) falls through to the initial phone lookup.
async function handle(conversation, message) {
  const { phone, state, context } = conversation;

  if (state === 'awaiting_has_account') {
    const said = (message.text || '').trim().toLowerCase();
    if (message.interactiveId === 'has_account_yes' || /^y(es)?$/.test(said)) {
      await sendText(
        phone,
        'No problem. Log into the customer portal, open your profile, and add this WhatsApp number. Message us again once that\'s done and we\'ll recognize you right away.'
      );
      return { newState: 'main_menu', newContext: {} };
    }
    if (message.interactiveId === 'has_account_no' || /^n(o)?$/.test(said)) {
      await sendText(phone, "Let's get you set up! What's your name?");
      return { newState: 'awaiting_new_account_name', newContext: {} };
    }
    await sendButtons(phone, {
      body: "Sorry, I didn't catch that. Do you already have a Tyrotec account?",
      buttons: HAS_ACCOUNT_BUTTONS,
    });
    return { newState: 'awaiting_has_account', newContext: {} };
  }

  if (state === 'awaiting_new_account_name') {
    const name = (message.text || '').trim();
    if (!name) {
      await sendText(phone, "What's your name?");
      return { newState: 'awaiting_new_account_name', newContext: {} };
    }
    await sendText(phone, "Thanks! What's your email address? (Only needed if you'd ever like to log into the web portal too.)");
    return { newState: 'awaiting_new_account_email', newContext: { name } };
  }

  if (state === 'awaiting_new_account_email') {
    const attempts = (context.attempts || 0) + 1;
    if (attempts > MAX_EMAIL_ATTEMPTS) {
      await sendText(phone, "That's not working out. Please contact us directly to get set up.");
      return { newState: 'main_menu', newContext: {} };
    }

    const email = (message.text || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await sendText(phone, "That doesn't look like a valid email. What's your email address?");
      return { newState: 'awaiting_new_account_email', newContext: { ...context, attempts } };
    }

    const { data: existingByEmail } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (existingByEmail) {
      await sendText(
        phone,
        "That email's already registered to an account. Log into the portal and add this number to your profile instead, then message us again."
      );
      return { newState: 'main_menu', newContext: {} };
    }

    const name = context.name || null;
    // Supabase requires a password syntactically; nobody's ever meant to
    // know or use this one -- portal access happens via "Forgot password?".
    const randomPassword = crypto.randomBytes(24).toString('hex');

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { full_name: name, role: 'customer' },
    });
    if (error) {
      await sendText(phone, 'Something went wrong creating your account. Please try again in a moment.');
      return { newState: 'main_menu', newContext: {} };
    }

    // Same trigger-timing safety net used by the portal's register() --
    // see the comment there for why this can't just rely on the DB trigger.
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .upsert(
        { id: created.user.id, email, full_name: name, role: 'customer', status: 'approved', phone },
        { onConflict: 'id' }
      )
      .select('id, full_name')
      .single();

    if (profileError) {
      await sendText(phone, 'Something went wrong creating your account. Please try again in a moment.');
      return { newState: 'main_menu', newContext: {} };
    }

    await sendText(
      phone,
      `You're all set${name ? `, ${name}` : ''}! Your Tyrotec account is ready to use right here on WhatsApp. Want the web portal too? Visit the login page and use "Forgot password?" with ${email} to set one.`
    );
    return greetAndShowMenu(phone, profile);
  }

  // No prior state -- first-ever message from this (still unlinked) number.
  const existingUser = await findUserByPhone(phone);
  if (existingUser) {
    return greetAndShowMenu(phone, existingUser);
  }

  await sendButtons(phone, {
    body: '👋 Welcome to Tyrotec! Do you already have an account on our customer portal?',
    buttons: HAS_ACCOUNT_BUTTONS,
  });
  return { newState: 'awaiting_has_account', newContext: {} };
}

module.exports = { handle };
