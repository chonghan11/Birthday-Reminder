// Throwaway-inbox providers. Sign-ups from these are refused: they are how bots and people
// avoiding accountability make accounts. 
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'burnermail.io', 'discard.email',
  'dispostable.com', 'emailondeck.com', 'fakeinbox.com', 'getairmail.com', 'getnada.com',
  'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'inboxbear.com', 'mailcatch.com', 'maildrop.cc', 'mailinator.com',
  'mailnesia.com', 'mailtemp.info', 'mintemail.com', 'moakt.com', 'mohmal.com',
  'mytemp.email', 'sharklasers.com', 'spam4.me', 'spamgourmet.com', 'temp-mail.io',
  'temp-mail.org', 'tempail.com', 'tempinbox.com', 'tempmail.com', 'tempmail.net',
  'tempmailo.com', 'throwawaymail.com', 'tmpmail.net', 'tmpmail.org', 'trashmail.com',
  'trashmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
]);

// True for a listed domain and for any subdomain of one (a@x.mailinator.com).
function isDisposableEmail(email) {
  const domain = String(email).trim().toLowerCase().split('@')[1] || '';
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

module.exports = { isDisposableEmail };
