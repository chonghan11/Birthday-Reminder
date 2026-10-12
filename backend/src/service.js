// All business logic lives here. It knows nothing about HTTP or AWS: it is handed a
// `storage` and a `mailer` (see storage/memory.js and mailer/console.js for their shape).
// Local server and cloud functions both call these same functions.
const { randomUUID } = require('node:crypto');

const LEAD_DAYS = [0, 1, 3, 7, 14]; // how many days before the birthday we may email
const MAX_PER_EMAIL = 100;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// "1005" for 5 October: a string key that sorts and looks up cleanly.
const monthDayKey = (month, day) => `${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;

const GIFT_CATEGORIES = ['all', 'cakes', 'flowers', 'treats', 'experiences'];

class ValidationError extends Error {} // -> 400

// --- Birthdays (saved under the email they are reminded at) --------------------------

function checkEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new ValidationError('a valid email is required');
  }
  return value;
}

function checkTimezone(timezone) {
  if (!timezone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    throw new ValidationError('unknown timezone');
  }
}

function cleanText(value, max, field, required) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new ValidationError(`${field} is required`);
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new ValidationError(`${field} is invalid`);
  return text;
}

async function createBirthday(storage, input = {}, now = new Date()) {
  const email = checkEmail(input.email);
  const name = cleanText(input.name, 80, 'name', true);
  const note = cleanText(input.note ?? '', 200, 'note', false);

  const { month, day } = input;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new ValidationError('month must be 1-12');
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]) throw new ValidationError('day is not valid for that month');

  const year = input.year ?? null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > now.getUTCFullYear())) {
    throw new ValidationError('year is not valid');
  }

  const lead = input.remindDaysBefore;
  if (!Array.isArray(lead) || lead.length === 0 || !lead.every((n) => LEAD_DAYS.includes(n))) {
    throw new ValidationError(`remindDaysBefore must be a non-empty list of: ${LEAD_DAYS.join(', ')}`);
  }

  if ((await storage.listByEmail(email)).length >= MAX_PER_EMAIL) {
    throw new ValidationError(`limit of ${MAX_PER_EMAIL} birthdays per email reached`);
  }

  const birthday = {
    id: randomUUID(),
    email,
    name,
    month,
    day,
    monthDay: monthDayKey(month, day), // e.g. "1005"; the hourly job looks birthdays up by this
    year,
    note,
    remindDaysBefore: [...new Set(lead)].sort((a, b) => b - a),
    timezone: checkTimezone(input.timezone),
    createdAt: now.toISOString(),
    sent: [], // keys like "2026:3" = reminder 3 days before the 2026 birthday already emailed
  };
  await storage.put(birthday);
  return toPublic(birthday);
}

async function listBirthdays(storage, email) {
  const items = await storage.listByEmail(checkEmail(email));
  return items.map(toPublic).sort((a, b) => a.month - b.month || a.day - b.day);
}

// Only the matching email can delete. Returns true if something was deleted.
async function deleteBirthday(storage, id, email) {
  const birthday = await storage.get(id);
  if (!birthday || birthday.email !== checkEmail(email)) return false;
  return storage.delete(id);
}

function toPublic({ sent, monthDay, ...birthday }) {
  return birthday;
}

// --- Gift ideas (from the `catalog`) ---------------------------------------------------

async function searchGifts(catalog, { category = 'all', q = '' } = {}) {
  if (!GIFT_CATEGORIES.includes(category)) throw new ValidationError(`category must be one of: ${GIFT_CATEGORIES.join(', ')}`);
  const query = typeof q === 'string' ? q.trim() : '';
  if (query.length > 50) throw new ValidationError('search is too long');
  return catalog.search({ category, query });
}

// --- The hourly job: email whoever is due --------------------------------------------

// Calendar date (and hour) it currently is in a timezone.
function localTime(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Which birthdays could be due right now? Anyone's local date is within a day of the UTC date,
// and a reminder looks up to 14 days ahead, so only these few month-days matter. This lets the
// job query a handful of month-days instead of scanning every birthday in the database.
function candidateMonthDays(now) {
  const utcToday = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const keys = new Set();
  for (let shift = -1; shift <= 1; shift++) {
    const localToday = addDays(utcToday, shift);
    for (const lead of LEAD_DAYS) {
      const date = addDays(localToday, lead);
      keys.add(monthDayKey(date.month, date.day));
      // Feb 29 birthdays are celebrated on Feb 28 in non-leap years
      if (date.month === 2 && date.day === 28 && !isLeap(date.year)) keys.add(monthDayKey(2, 29));
    }
  }
  return [...keys];
}

// Does the birthday fall on this date? Feb 29 birthdays are celebrated on Feb 28 in non-leap years.
function isBirthdayOn(birthday, date) {
  const day = birthday.month === 2 && birthday.day === 29 && !isLeap(date.year) ? 28 : birthday.day;
  return date.month === birthday.month && date.day === day;
}

function buildEmail(birthday, lead, date) {
  const when = lead === 0 ? 'today' : lead === 1 ? 'tomorrow' : `in ${lead} days`;
  const dateText = new Date(Date.UTC(date.year, date.month - 1, date.day))
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const age = birthday.year ? ` They turn ${date.year - birthday.year}.` : '';
  const lines = [`${birthday.name}'s birthday is ${when} (${dateText}).${age}`];
  if (birthday.note) lines.push('', `Your note: ${birthday.note}`);
  lines.push('', '- Birthday Buddy');
  return {
    to: birthday.email,
    subject: lead === 0 ? `It's ${birthday.name}'s birthday today!` : `${birthday.name}'s birthday is ${when}`,
    text: lines.join('\n'),
  };
}

// Run this on a schedule (hourly is fine). It is safe to run often: each reminder is
// remembered in `birthday.sent`, so it is emailed once per year. A reminder goes out once the
// birthday person's local time reaches `sendFromHour`. Returns how many emails were sent.
async function processDueReminders({ storage, mailer, now = new Date(), sendFromHour = 8 }) {
  let sentCount = 0;
  const candidates = [];
  for (const monthDay of candidateMonthDays(now)) candidates.push(...(await storage.listByMonthDay(monthDay)));

  for (const birthday of candidates) {
    const today = localTime(now, birthday.timezone);
    if (today.hour < sendFromHour) continue;

    for (const lead of birthday.remindDaysBefore) {
      const date = addDays(today, lead);
      const key = `${date.year}:${lead}`;
      if (!isBirthdayOn(birthday, date) || birthday.sent.includes(key)) continue;
      try {
        await mailer.send(buildEmail(birthday, lead, date));
      } catch (err) {
        console.error(`Email for ${birthday.id} failed, will retry next run:`, err.message);
        continue;
      }
      await storage.markSent(birthday.id, key);
      sentCount++;
    }
  }
  return sentCount;
}

module.exports = {
  ValidationError, LEAD_DAYS, GIFT_CATEGORIES,
  createBirthday, listBirthdays, deleteBirthday, searchGifts, processDueReminders,
};
