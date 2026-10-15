const express = require('express');
const path = require('node:path');
const service = require('./service');

// Local-only HTTP layer: it serves the frontend and the /api routes on one port
// TO run it locally. In AWS the frontend and API are separate.
function createApp({ storage, catalog }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/api/birthdays', async (req, res) => {
    res.status(201).json(await service.createBirthday(storage, req.body));
  });

  app.get('/api/birthdays', async (req, res) => {
    res.json(await service.listBirthdays(storage, req.query.email));
  });

  app.delete('/api/birthdays/:id', async (req, res) => {
    const removed = await service.deleteBirthday(storage, req.params.id, req.query.email);
    res.status(removed ? 204 : 404).end();
  });

  app.get('/api/gifts', async (req, res) => {
    res.json(await service.searchGifts(catalog, req.query));
  });

  app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  app.use((err, req, res, next) => {
    if (err instanceof service.ValidationError) return res.status(400).json({ error: err.message });    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp };
