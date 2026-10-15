// The Lambda for the website's API. API Gateway (an HTTP API) calls `handler` once per web request.

const service = require('../src/service');
const { createStorage } = require('../src/storage');
const { createCatalog } = require('../src/catalog');

// Created once when the Lambda container starts, then reused by every request it handles.

const storage = createStorage();
const catalog = createCatalog();

// A web response. `body` must be a string, data is turned into JSON text.
function reply(statusCode, data) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? '' : JSON.stringify(data),
  };
}

// The request body sometimes arrives as base64 encoded, so turn it back into an object.
function readBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new service.ValidationError('body must be valid JSON');
  }
}

exports.handler = async (event) => {
  // An HTTP API event keeps the method inside requestContext.http, and the path in rawPath.
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const query = event.queryStringParameters || {};
  const id = event.pathParameters && event.pathParameters.id; 

  try {
    if (method === 'POST' && path === '/api/birthdays') {
      return reply(201, await service.createBirthday(storage, readBody(event)));
    }

    if (method === 'GET' && path === '/api/birthdays') {
      return reply(200, await service.listBirthdays(storage, query.email));
    }

    if (method === 'DELETE' && id) {
      const removed = await service.deleteBirthday(storage, id, query.email);
      return removed ? reply(204) : reply(404, { error: 'not found' });
    }

    if (method === 'GET' && path === '/api/gifts') {
      return reply(200, await service.searchGifts(catalog, query));
    }

    return reply(404, { error: 'not found' });
  } catch (err) {
    if (err instanceof service.ValidationError) return reply(400, { error: err.message });
    console.error(err);
    return reply(500, { error: 'internal error' });
  }
};
