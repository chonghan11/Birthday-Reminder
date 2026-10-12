// In-memory storage. Data is lost when the server stops.
//
// Pluggable storage layer with an in-memory fallback for local development and DynamoDB for production.
//
//   put(birthday)          create a birthday
//   get(id)                one birthday, or null
//   listByEmail(email)     all birthdays saved under that email
//   listByMonthDay(md)     all birthdays on that month-day, e.g. "1005" (the hourly job uses this)
//   delete(id)             true if something was deleted
//   markSent(id, key)      remember that reminder `key` (e.g. "2026:3") was emailed
function createMemoryStorage() {
  const items = new Map();
  const copy = (item) => structuredClone(item);

  return {
    async put(item) {
      items.set(item.id, copy(item));
    },
    async get(id) {
      const item = items.get(id);
      return item ? copy(item) : null;
    },
    async listByEmail(email) {
      return [...items.values()].filter((item) => item.email === email).map(copy);
    },
    async listByMonthDay(monthDay) {
      return [...items.values()].filter((item) => item.monthDay === monthDay).map(copy);
    },
    async delete(id) {
      return items.delete(id);
    },
    async markSent(id, key) {
      const item = items.get(id);
      if (item && !item.sent.includes(key)) item.sent.push(key);
    },
  };
}

module.exports = createMemoryStorage;
