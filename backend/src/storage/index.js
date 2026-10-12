const config = require('../config');

const backends = {
  memory: () => require('./memory'),
  dynamodb: () => require('./dynamodb'),
};

function createStorage() {
  const factory = backends[config.storage];
  if (!factory) {
    throw new Error(`Unknown STORAGE_BACKEND "${config.storage}". Available: ${Object.keys(backends).join(', ')}`);
  }
  return factory()();
}

module.exports = { createStorage };
