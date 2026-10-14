(() => {
  const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '';
  const EMAIL_KEY = 'birthday-buddy:email';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const LEAD_LABELS = { 0: 'on the day', 1: '1 day', 3: '3 days', 7: '1 week', 14: '2 weeks' };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const $ = (id) => document.getElementById(id);
  const emailInput = $('email');
  const addForm = $('add-form');
  const monthSelect = $('month');
  const daySelect = $('day');

  let currentEmail = '';
  let birthdays = [];

  // --- API ---------------------------------------------------------------------------

  async function api(path, options) {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  async function load() {
    birthdays = currentEmail ? await api(`/api/birthdays?email=${encodeURIComponent(currentEmail)}`) : [];
    render();
  }

  // --- Dates -------------------------------------------------------------------------

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

  // --- Gift ideas (our API looks them up from an outside API) -----------------------

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
    const request = ++giftRequest; // ignore answers that arrive after a newer search
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

  // --- Rendering ---------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Avatar colour comes from the name, kept in the blue-to-violet range to match the theme.
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
      info.append(el('p', 'name', b.name), el('p', 'meta', `${describe(b, upcoming)} · ${reminders}`));
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
    $('empty-text').textContent = currentEmail
      ? 'No birthdays yet. Add your first one!'
      : 'Enter your email above to see your birthdays.';
  }

  let toastTimer;
  function toast(message, isError) {
    const node = $('toast');
    node.textContent = message;
    node.className = isError ? 'show error' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = ''; }, 3500);
  }

  // --- Actions -----------------------------------------------------------------------

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
      toast('Enter your email first', true);
      emailInput.focus();
      return;
    }
    const year = $('year').value.trim();
    const button = addForm.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/api/birthdays', {
        method: 'POST',
        body: JSON.stringify({
          email: currentEmail,
          name: $('name').value,
          month: Number(monthSelect.value),
          day: Number(daySelect.value),
          year: year ? Number(year) : null,
          remindDaysBefore: [...addForm.querySelectorAll('input[name=lead]:checked')].map((i) => Number(i.value)),
          note: $('note').value,
          timezone,
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

  // --- Setup -------------------------------------------------------------------------

  function fillDays() {
    const selected = Number(daySelect.value) || 1;
    const count = DAYS_IN_MONTH[Number(monthSelect.value) - 1];
    daySelect.replaceChildren(...Array.from({ length: count }, (_, i) => new Option(i + 1, i + 1)));
    daySelect.value = Math.min(selected, count);
  }

  monthSelect.replaceChildren(...MONTHS.map((m, i) => new Option(m, i + 1)));
  monthSelect.addEventListener('change', fillDays);
  fillDays();
  $('tz-note').textContent = `Emails arrive in the morning, ${timezone} time.`;

  try { currentEmail = localStorage.getItem(EMAIL_KEY) || ''; } catch { /* storage may be blocked */ }
  emailInput.value = currentEmail;
  load().catch((err) => toast(err.message, true));
})();
