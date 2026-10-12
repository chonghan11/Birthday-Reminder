const config = require('../config');


const backends = {
  curated: () => require('./curated'),
};

function createCatalog() {
  const factory = backends[config.catalog];
  if (!factory) {
    throw new Error(`Unknown CATALOG_BACKEND "${config.catalog}". Available: ${Object.keys(backends).join(', ')}`);
  }
  return factory()();
}

module.exports = { createCatalog };
