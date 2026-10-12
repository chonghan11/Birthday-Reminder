const config = require('./config');
const { createApp } = require('./app');
const { createStorage } = require('./storage');
const { createMailer } = require('./mailer');
const { createCatalog } = require('./catalog');
const { processDueReminders } = require('./service');

const storage = createStorage();
const mailer = createMailer();
const catalog = createCatalog();

const server = createApp({ storage, catalog }).listen(config.port, () => {
  console.log(`Open http://localhost:${config.port} (storage=${config.storage}, mailer=${config.mailer})`);
});

// Local stand-in for a cloud scheduler: runs the "email due reminders" job on a timer.
const timer = setInterval(async () => {
  const sent = await processDueReminders({ storage, mailer, sendFromHour: config.sendFromHour });
  if (sent) console.log(`Sent ${sent} reminder(s)`);
}, config.localSchedulerSeconds * 1000);

function shutdown() {
  clearInterval(timer);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
