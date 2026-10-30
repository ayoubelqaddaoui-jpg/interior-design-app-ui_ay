// Starts the ORIGINAL Node API (server/index.js on in-memory PGlite) for the contract run. Never used in production.
const { createBackend } = require('../../../server');
const backend = createBackend();
backend.server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('node-ready'));
