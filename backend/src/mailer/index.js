const config = require('../config');

const backends = {
  console: () => require('./console'),
  ses: () => require('./ses'),
};

function createMailer() {
  const factory = backends[config.mailer];
  if (!factory) {
    throw new Error(`Unknown MAILER_BACKEND "${config.mailer}". Available: ${Object.keys(backends).join(', ')}`);
  }
  return factory()();
}

module.exports = { createMailer };
