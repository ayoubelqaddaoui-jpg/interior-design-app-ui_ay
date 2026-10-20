/** Vercel serverless entry: every /api/* request is handled by the same code as the Node/Bun server. */
const { createBackend } = require('../server');
let backend;
module.exports = (req, res) => (backend ||= createBackend()).handle(req, res);
module.exports.config = { maxDuration: 30 };
