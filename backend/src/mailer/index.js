const config = require('../config');

// Register new mailers here, then select one with MAILER_BACKEND.
const backends = {
  console: () => require('./console'),
};

function createMailer() {
  const factory = backends[config.mailer];
  if (!factory) {
    throw new Error(`Unknown MAILER_BACKEND "${config.mailer}". Available: ${Object.keys(backends).join(', ')}`);
  }
  return factory()();
}

module.exports = { createMailer };
