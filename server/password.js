// Usage: ADMIN_PASSWORD='your strong password' npm --prefix server run password
// Output is a salted scrypt hash, never the plaintext password.
const crypto = require('node:crypto');
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) { console.error('Set ADMIN_PASSWORD to at least 12 characters.'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
console.log(`${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`);
