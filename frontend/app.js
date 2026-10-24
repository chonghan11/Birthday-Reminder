(() => {
  const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '';
  // Set only on the deployed site. Without it the page uses the plain email box (local mode).
  const COGNITO = (window.APP_CONFIG && window.APP_CONFIG.COGNITO) || null;
  const EMAIL_KEY = 'birthday-buddy:email';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const LEAD_LABELS = { 0: 'on the day', 1: '1 day', 3: '3 days', 7: '1 week', 14: '2 weeks' };
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // Same rule as the server (backend/src/service.js): letters, emoji, spaces, hyphens, apostrophes
  // and dots, starting with a letter or emoji. No numbers or other symbols.
  const EMOJI = '(?:\\p{Regional_Indicator}{2}|(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\ufe0f)\\p{Emoji_Modifier}?'
    + '(?:\\u200d(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic})\\ufe0f?\\p{Emoji_Modifier}?)*)';
  const NAME_PATTERN = new RegExp(`^(?:[\\p{L}\\p{M}]|${EMOJI})(?:[\\p{L}\\p{M} .'’-]|${EMOJI})*$`, 'u');

  const $ = (id) => document.getElementById(id);
  const emailInput = $('email');
  const addForm = $('add-form');
  const monthSelect = $('month');
  const daySelect = $('day');

  let currentEmail = '';
  let birthdays = [];



  //  Login (Cognito)

  const TOKEN_KEY = 'birthday-buddy:tokens';
  let tokens = null; // { idToken, refreshToken }

  function jwtPayload(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
  }

  const signedInEmail = () => (tokens ? jwtPayload(tokens.idToken).email || '' : '');

  function storeTokens(result) {
    tokens = { idToken: result.IdToken, refreshToken: result.RefreshToken || (tokens && tokens.refreshToken) };
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch { /* storage may be blocked */ }
  }

  function clearTokens() {
    tokens = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage may be blocked */ }
  }

  // One call to the Cognito API. The app client has no secret, so these actions are open to the public.
  async function cognito(action, body) {
    const endpoint = COGNITO.endpoint || `https://cognito-idp.${COGNITO.region}.amazonaws.com/`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify({ ClientId: COGNITO.clientId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'Something went wrong. Please try again.');
      err.code = String(data.__type || '').split('#').pop();
      // The sign-up guard (backend/lambda/pre-signup.js) refuses with a readable message; Cognito wraps it.
      if (err.code === 'UserLambdaValidationException') {
        err.message = err.message.replace(/^PreSignUp failed with error /, '').replace(/\.+$/, '.');
      }
      throw err;
    }
    return data;
  }

  const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';
  const AUTH_ERRORS = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'Incorrect email or password.',
    UsernameExistsException: 'An account with this email already exists. Try logging in.',
    CodeMismatchException: 'That code is not right. Check your email and try again.',
    ExpiredCodeException: 'That code has expired. Ask for a new one.',
    LimitExceededException: TOO_MANY,
    TooManyRequestsException: TOO_MANY,
    TooManyFailedAttemptsException: TOO_MANY,
  };

  const PASSWORD_RULES = 'At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.';
  const VIEWS = {
    login: { title: 'Welcome back', sub: 'Log in to see and save your birthdays.', submit: 'Log in', tabs: true, forgot: true },
    register: { title: 'Create your account', sub: 'Get an email before every birthday you save.', submit: 'Create account', tabs: true, confirm: true, hint: PASSWORD_RULES, newPassword: true },
    verify: { title: 'Check your email', submit: 'Verify email', code: true, noPassword: true, resend: true, back: true },
    forgot: { title: 'Reset your password', sub: "Enter your email and we'll send you a code.", submit: 'Send code', noPassword: true, back: true },
    reset: { title: 'Choose a new password', submit: 'Save new password', code: true, resend: true, back: true, hint: PASSWORD_RULES, newPassword: true, passwordLabel: 'New password' },
  };

  let authView = 'login';
  let pendingPassword = ''; // kept in memory only, so a new account can be logged in right after its email is verified

  const authEmail = $('auth-email');
  const authPassword = $('auth-password');

  function showAuthMessage(kind, text) {
    const node = $(kind === 'error' ? 'auth-error' : 'auth-info');
    node.textContent = text || '';
    node.hidden = !text;
  }

  // The eye shows the current state: a plain eye while the password is visible, a crossed-out eye while it is hidden.
  function showPassword(show) {
    authPassword.type = show ? 'text' : 'password';
    $('auth-confirm').type = authPassword.type;
    $('auth-show').setAttribute('aria-pressed', String(show));
    $('auth-show').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    // SVG elements have no `hidden` property, so the attribute is switched directly.
    $('auth-show').querySelector('.eye-open').toggleAttribute('hidden', !show);
    $('auth-show').querySelector('.eye-closed').toggleAttribute('hidden', show);
  }

  function setView(view, info, focus = true) {
    authView = view;
    const v = VIEWS[view];
    $('auth-title').textContent = v.title;
    $('auth-sub').textContent = v.sub || '';
    $('auth-sub').hidden = !v.sub;
    $('auth-tabs').hidden = !v.tabs;
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.view === view)));
    $('field-code').hidden = !v.code;
    $('field-password').hidden = !!v.noPassword;
    $('field-confirm').hidden = !v.confirm;
    $('auth-password-label').textContent = v.passwordLabel || 'Password';
    authPassword.autocomplete = v.newPassword ? 'new-password' : 'current-password';
    $('auth-hint').textContent = v.hint || '';
    $('auth-submit').textContent = v.submit;
    $('link-forgot').hidden = !v.forgot;
    $('link-resend').hidden = !v.resend;
    $('link-back').hidden = !v.back;
    authEmail.readOnly = view === 'verify' || view === 'reset';
    for (const id of ['auth-password', 'auth-confirm', 'auth-code']) $(id).value = '';
    showPassword(false);
    showAuthMessage('error', '');
    showAuthMessage('info', info);
    if (focus) (v.code ? $('auth-code') : authEmail.readOnly || authEmail.value ? (v.noPassword ? authEmail : authPassword) : authEmail).focus();
  }

  const localError = (message) => Object.assign(new Error(message), { code: 'local' });

  function checkNewPassword(password, confirm) {
    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
      throw localError(`Your password needs: ${PASSWORD_RULES.charAt(0).toLowerCase()}${PASSWORD_RULES.slice(1)}`);
    }
    if (confirm !== undefined && password !== confirm) throw localError('The two passwords do not match.');
  }

  async function signIn(email, password) {
    let result;
    try {
      ({ AuthenticationResult: result } = await cognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }));
    } catch (err) {
      if (err.code !== 'UserNotConfirmedException') throw err;
      pendingPassword = password;
      await cognito('ResendConfirmationCode', { Username: email }).catch(() => {});
      setView('verify', `Your email is not verified yet. We sent a new 6-digit code to ${email}.`);
      return;
    }
    if (!result) throw new Error('Could not log in. Please try again.');
    pendingPassword = '';
    storeTokens(result);
    renderAuth();
    load().catch((err) => toast(err.message, true));
  }

  async function runAuth(view, email, password, code) {
    if (view === 'login') {
      if (!password) throw localError('Enter your password.');
      return signIn(email, password);
    }
    if (view === 'register') {
      checkNewPassword(password, $('auth-confirm').value);
      await cognito('SignUp', { Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }] });
      pendingPassword = password;
      return setView('verify', `We emailed a 6-digit code to ${email}. Enter it to finish creating your account.`);
    }
    if (view === 'verify') {
      if (!code) throw localError('Enter the code from your email.');
      await cognito('ConfirmSignUp', { Username: email, ConfirmationCode: code });
      if (pendingPassword) return signIn(email, pendingPassword);
      return setView('login', 'Email verified. You can log in now.');
    }
    if (view === 'forgot') {
      await cognito('ForgotPassword', { Username: email });
      return setView('reset', `If ${email} has an account, we emailed it a code.`);
    }
    if (!code) throw localError('Enter the code from your email.');
    checkNewPassword(password);
    await cognito('ConfirmForgotPassword', { Username: email, ConfirmationCode: code, Password: password });
    return setView('login', 'Password updated. Log in with your new password.');
  }

  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmail.value.trim().toLowerCase();
    showAuthMessage('error', '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAuthMessage('error', 'Enter a valid email address.');
      return;
    }
    const button = $('auth-submit');
    button.disabled = true;
    try {
      await runAuth(authView, email, authPassword.value, $('auth-code').value.trim());
    } catch (err) {
      showAuthMessage('error', AUTH_ERRORS[err.code] || err.message);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
  $('link-forgot').addEventListener('click', () => setView('forgot'));
  $('link-back').addEventListener('click', () => { pendingPassword = ''; setView('login'); });
  $('auth-show').addEventListener('click', () => showPassword(authPassword.type === 'password'));
  $('link-resend').addEventListener('click', async () => {
    const email = authEmail.value.trim().toLowerCase();
    try {
      if (authView === 'verify') await cognito('ResendConfirmationCode', { Username: email });
      else await cognito('ForgotPassword', { Username: email });
      showAuthMessage('error', '');
      showAuthMessage('info', `We sent a new code to ${email}.`);
    } catch (err) {
      showAuthMessage('info', '');
      showAuthMessage('error', AUTH_ERRORS[err.code] || err.message);
    }
  });

  // An ID token that has not expired, renewed quietly when needed. null means: log in again.
  async function validIdToken() {
    if (!tokens) return null;
    if (jwtPayload(tokens.idToken).exp * 1000 > Date.now() + 60000) return tokens.idToken;
    if (!tokens.refreshToken) {
      clearTokens();
      return null;
    }
    try {
      const { AuthenticationResult: result } = await cognito('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: tokens.refreshToken },
      });
      storeTokens(result);
      return tokens.idToken;
    } catch {
      clearTokens();
      return null;
    }
  }

  function logout() {
    const refreshToken = tokens && tokens.refreshToken;
    clearTokens();
    birthdays = [];
    renderAuth();
    setView('login', undefined, false);
    render();
    if (refreshToken) cognito('RevokeToken', { Token: refreshToken }).catch(() => { /* the token expires on its own */ });
  }

  let authStarted = false;
  function renderAuth() {
    if (!COGNITO) return;
    currentEmail = signedInEmail();
    $('email-form').hidden = true;
    // Signed out: only the log-in card is shown. The app itself appears after login.
    $('auth-screen').hidden = !!currentEmail;
    $('auth-card').hidden = !currentEmail;
    $('app-area').hidden = !currentEmail;
    if (currentEmail) $('auth-status').textContent = `Signed in as ${currentEmail}`;
    else if (!authStarted) setView('login', undefined, false);
    authStarted = true;
  }

  $('auth-button').addEventListener('click', logout);

  async function api(path, options) {
    const headers = { 'Content-Type': 'application/json' };
    if (COGNITO) {
      const token = await validIdToken();
      if (!token) {
        renderAuth();
        throw new Error('Please log in first.');
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(API_BASE + path, { ...options, headers });
    if (res.status === 401 && COGNITO) {
      clearTokens();
      renderAuth();
      birthdays = [];
      render();
      throw new Error('Your login has expired. Please log in again.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  async function load() {
    birthdays = currentEmail ? await api(`/api/birthdays?email=${encodeURIComponent(currentEmail)}`) : [];
    render();
  }

  //  Dates 

  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  // Next time this birthday happens (Feb 29 -> Feb 28 in non-leap years), plus days away.
  function nextOccurrence(b, today) {
    for (let y = today.getFullYear(); ; y++) {
      const day = b.month === 2 && b.day === 29 && !isLeap(y) ? 28 : b.day;
      const date = new Date(y, b.month - 1, day);
      if (date >= today) return { date, days: Math.round((date - today) / 86400000) };
    }
  }

  const countdown = (days) => (days === 0 ? 'Today! 🎉' : days === 1 ? 'Tomorrow' : `in ${days} days`);

  // Gift ideas 

  const GIFT_SOON_DAYS = 14; // show the gift button when the birthday is this close
  const giftDialog = $('gift-dialog');
  let giftRequest = 0;
  let giftTimer;

  function openGifts(b) {
    $('gift-title').textContent = `Gift ideas for ${b.name}`;
    $('gift-search').value = '';
    giftDialog.showModal();
    searchGifts();
  }

  function giftLink(label, href) {
    const link = el('a', undefined, label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  async function searchGifts() {
    const request = ++giftRequest; 
    const params = new URLSearchParams({ category: $('gift-category').value, q: $('gift-search').value.trim() });
    const status = $('gift-status');
    status.textContent = 'Searching…';
    try {
      const items = await api(`/api/gifts?${params}`);
      if (request !== giftRequest) return;
      status.textContent = items.length === 1 && items[0].custom
        ? 'Not in our list yet. Search for it instead:'
        : items.length ? '' : 'Nothing found. Try another search.';
      $('gift-results').replaceChildren(...items.map((item) => {
        const li = el('li', 'gift-card');
        const links = el('div', 'gift-links');
        links.append(giftLink('📍 Nearby shops', item.nearbyLink), giftLink('🔎 Search online', item.onlineLink));
        li.append(el('div', 'gift-emoji', item.emoji), el('p', 'gift-name', item.name), el('p', 'gift-blurb', item.blurb), links);
        return li;
      }));
      giftDialog.scrollTop = 0;
    } catch (err) {
      if (request !== giftRequest) return;
      $('gift-results').replaceChildren();
      status.textContent = err.message;
    }
  }

  $('gift-category').addEventListener('change', searchGifts);
  $('gift-search').addEventListener('input', () => {
    clearTimeout(giftTimer);
    giftTimer = setTimeout(searchGifts, 300);
  });
  $('gift-close').addEventListener('click', () => giftDialog.close());
  giftDialog.addEventListener('click', (e) => { if (e.target === giftDialog) giftDialog.close(); }); // click outside

  function giftButton(b, className) {
    const button = el('button', className, '🎁 Gift ideas');
    button.type = 'button';
    button.addEventListener('click', () => openGifts(b));
    return button;
  }

  //  Rendering 

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Avatar colour comes from the name, kept in the blue-to-violet range 
  function avatar(name) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    const node = el('div', 'avatar', [...name][0].toUpperCase());
    node.style.background = `hsl(${200 + (hash % 80)} 65% 48%)`;
    return node;
  }

  function describe(b, upcoming) {
    const age = b.year ? ` · turning ${upcoming.date.getFullYear() - b.year}` : '';
    return `${b.day} ${MONTHS[b.month - 1]}${age}`;
  }

  function render() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = birthdays
      .map((b) => ({ b, upcoming: nextOccurrence(b, today) }))
      .sort((x, y) => x.upcoming.days - y.upcoming.days);

    // Hero card for the soonest birthday.
    const nextUp = $('next-up');
    nextUp.replaceChildren();
    if (rows.length) {
      const { b, upcoming } = rows[0];
      const card = el('div', 'next-up');
      const text = el('div');
      text.append(el('p', 'eyebrow', 'Next up'), el('p', 'big', `${b.name} · ${countdown(upcoming.days)}`), el('p', 'sub', describe(b, upcoming)));
      card.append(avatar(b.name), text);
      if (upcoming.days <= GIFT_SOON_DAYS) card.append(giftButton(b, 'gift-btn light'));
      nextUp.append(card);
    }

    $('list').replaceChildren(...rows.map(({ b, upcoming }) => {
      const li = el('li', 'item');
      const info = el('div', 'info');
      const reminders = `Reminders: ${b.remindDaysBefore.map((n) => LEAD_LABELS[n]).join(', ')}`;
      info.append(el('p', 'name', b.name), el('p', 'meta', `${describe(b, upcoming)} · ${reminders} · ${b.timezone.replace(/_/g, ' ')}`));
      if (b.note) info.append(el('p', 'meta', `“${b.note}”`));

      const when = el('span', upcoming.days === 0 ? 'when today' : 'when', countdown(upcoming.days));
      const remove = el('button', 'remove', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${b.name}`);
      remove.addEventListener('click', () => removeBirthday(b));

      li.append(avatar(b.name), info, when);
      if (upcoming.days <= GIFT_SOON_DAYS) li.append(giftButton(b, 'gift-btn'));
      li.append(remove);
      return li;
    }));

    $('empty').hidden = rows.length > 0;
    $('apply-timezone').disabled = rows.length === 0;
    $('empty-text').textContent = currentEmail
      ? 'No birthdays yet. Add your first one!'
      : COGNITO ? 'Log in above to see your birthdays.' : 'Enter your email above to see your birthdays.';
  }

  let toastTimer;
  function toast(message, isError) {
    const node = $('toast');
    node.textContent = message;
    node.className = isError ? 'show error' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = ''; }, 3500);
  }

  //  Actions 

  async function removeBirthday(b) {
    if (!confirm(`Remove ${b.name}'s birthday?`)) return;
    try {
      await api(`/api/birthdays/${encodeURIComponent(b.id)}?email=${encodeURIComponent(currentEmail)}`, { method: 'DELETE' });
      await load();
      toast('Removed');
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    currentEmail = emailInput.value.trim().toLowerCase();
    try { localStorage.setItem(EMAIL_KEY, currentEmail); } catch { /* storage may be blocked */ }
    try {
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEmail) {
      toast(COGNITO ? 'Log in first' : 'Enter your email first', true);
      if (!COGNITO) emailInput.focus();
      return;
    }
    const year = $('year').value.trim();
    const name = $('name').value;
    const month = Number(monthSelect.value);
    const day = Number(daySelect.value);
    const leads = [...addForm.querySelectorAll('input[name=lead]:checked')].map((i) => Number(i.value));

    // Check before saving, so the user gets an instant answer. The server checks again.
    if (!NAME_PATTERN.test(name.trim())) {
      toast('Name can only have letters, emoji, spaces, hyphens, apostrophes and dots (no numbers or symbols).', true);
      return;
    }
    if (leads.length === 0) {
      toast('Choose at least one reminder.', true);
      return;
    }
    // 1. No duplicates: the same name on the same day would send double reminders.
    const tidy = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (birthdays.some((b) => b.month === month && b.day === day && tidy(b.name) === tidy(name))) {
      toast(`You already saved ${name.trim()} on ${day} ${MONTHS[month - 1]}.`, true);
      return;
    }
    // 2. A reminder can't be longer than the time left: 5 days to go and "1 week before" is rejected.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysAway = nextOccurrence({ month, day }, today).days;
    const tooEarly = leads.filter((n) => n > daysAway);
    if (tooEarly.length > 0) {
      const when = daysAway === 0 ? 'today' : `in ${daysAway} day${daysAway === 1 ? '' : 's'}`;
      toast(`This birthday is ${when}, so untick: ${tooEarly.map((n) => `${LEAD_LABELS[n]} before`).join(', ')}.`, true);
      return;
    }

    const button = addForm.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/api/birthdays', {
        method: 'POST',
        body: JSON.stringify({
          email: currentEmail,
          name,
          month,
          day,
          year: year ? Number(year) : null,
          remindDaysBefore: leads,
          note: $('note').value,
          timezone: $('timezone').value,
        }),
      });
      $('name').value = '';
      $('year').value = '';
      $('note').value = '';
      await load();
      toast('Birthday saved 🎂');
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });

  //  Setup 

  function fillDays() {
    const selected = Number(daySelect.value) || 1;
    const count = DAYS_IN_MONTH[Number(monthSelect.value) - 1];
    daySelect.replaceChildren(...Array.from({ length: count }, (_, i) => new Option(i + 1, i + 1)));
    daySelect.value = Math.min(selected, count);
  }

  // Reminders longer than the time left can't be chosen: untick them and grey them out.
  function updateReminderOptions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysAway = nextOccurrence({ month: Number(monthSelect.value), day: Number(daySelect.value) }, today).days;
    let blocked = false;
    addForm.querySelectorAll('input[name=lead]').forEach((input) => {
      const tooLong = Number(input.value) > daysAway;
      input.disabled = tooLong;
      if (tooLong) {
        input.checked = false;
        blocked = true;
      }
    });
    $('lead-note').textContent = !blocked ? ''
      : daysAway === 0 ? "This birthday is today, so only 'On the day' is available."
        : `Only ${daysAway} day${daysAway === 1 ? '' : 's'} left, so longer reminders aren't available.`;
  }

  monthSelect.replaceChildren(...MONTHS.map((m, i) => new Option(m, i + 1)));
  monthSelect.addEventListener('change', () => { fillDays(); updateReminderOptions(); });
  daySelect.addEventListener('change', updateReminderOptions);
  fillDays();
  updateReminderOptions();

  // Time zone dropdown. It starts on the zone this browser is in right now, and the person can pick another
  // one (for example after moving, or when using a VPN). The server saves it with the birthday and sends the
  // reminder once it is 7am there.
  const zoneSelect = $('timezone');

  function zoneLabel(zone) {
    let offset = '';
    try {
      offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date()).find((part) => part.type === 'timeZoneName').value;
    } catch { /* the zone is still listed, just without its offset */ }
    return `${zone.replace(/_/g, ' ')}${offset ? ` (${offset})` : ''}`;
  }

  function showZone() {
    $('tz-note').textContent = `Emails arrive in the morning, ${zoneSelect.value.replace(/_/g, ' ')} time.`;
  }

  function setupTimezone() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browsers: only the current zone and UTC are offered */ }
    const all = [...new Set([browserZone, 'UTC', ...zones])].sort((a, b) => a.localeCompare(b));
    zoneSelect.replaceChildren(...all.map((zone) => new Option(zoneLabel(zone), zone)));
    zoneSelect.value = browserZone;
    showZone();
  }

  zoneSelect.addEventListener('change', showZone);
  setupTimezone();

  // Moves every saved birthday to the zone chosen in the dropdown.
  $('apply-timezone').addEventListener('click', async () => {
    const zone = zoneSelect.value;
    const count = birthdays.length;
    const plural = `birthday${count === 1 ? '' : 's'}`;
    if (!currentEmail || count === 0) return;
    if (!confirm(`Change ${count} saved ${plural} to ${zone.replace(/_/g, ' ')} time?`)) return;
    const button = $('apply-timezone');
    button.disabled = true;
    try {
      const result = await api('/api/timezone', { method: 'PUT', body: JSON.stringify({ email: currentEmail, timezone: zone }) });
      await load();
      toast(`${result.updated} ${plural} now use ${zone.replace(/_/g, ' ')} time`);
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });

  async function start() {
    if (COGNITO) {
      try { tokens = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { tokens = null; }
      await validIdToken(); // renews a stale token now, or signs the person out if it cannot
      renderAuth();
    } else {
      try { currentEmail = localStorage.getItem(EMAIL_KEY) || ''; } catch { /* storage may be blocked */ }
      emailInput.value = currentEmail;
    }
    await load();
  }
  start().catch((err) => toast(err.message, true));
})();
