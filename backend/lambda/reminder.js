// The Lambda for the hourly reminder job. EventBridge starts `handler` on a schedule, so there is
// no web request here and nobody waiting for an answer. It does what the local timer in
// backend/src/server.js does: find the birthdays that are due and email the reminders.
const config = require('../src/config');
const { createStorage } = require('../src/storage');
const { createMailer } = require('../src/mailer');
const { processDueReminders } = require('../src/service');

// Created once when the Lambda container starts, then reused by later runs.
// STORAGE_BACKEND, TABLE_NAME and MAILER_BACKEND (set in the CDK stack) choose the real services.
const storage = createStorage();
const mailer = createMailer();

exports.handler = async () => {
  try {
    const sent = await processDueReminders({ storage, mailer, sendFromHour: config.sendFromHour });
    console.log(JSON.stringify({ message: 'reminder run finished', sent }));
    return { sent };
  } catch (err) {
    // Log it for CloudWatch Logs, then rethrow so Lambda records the run as failed.
    // A failed run is visible in the function's metrics, and the next hourly run tries again.
    console.error('reminder run failed', err);
    throw err;
  }
};
