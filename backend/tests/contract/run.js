#!/usr/bin/env node
// Old-vs-new contract test:  node tests/contract/run.js   (from backend/)
// Boots the ORIGINAL Node API (in-memory PGlite) and the Laravel API (own MySQL database), plays tests/contract/scenario.js
// against both and prints every difference. Exit code 1 when any step differs.
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { recorder, compare } = require('./lib');
const { run } = require('./scenario');

const backend = path.resolve(__dirname, '../..');
const PASSWORD = 'contract-test-password-123';
const EMAIL = 'owner@example.com';
const NODE_PORT = Number(process.env.NODE_PORT || 18081), PHP_PORT = Number(process.env.PHP_PORT || 18082);
const salt = crypto.randomBytes(16).toString('hex');
const scrypt = `${salt}:${crypto.scryptSync(PASSWORD, salt, 64).toString('hex')}`;
const bcrypt = execFileSync('php', ['-r', 'echo password_hash($argv[1], PASSWORD_BCRYPT, ["cost"=>4]);', PASSWORD]).toString();
const kids = [];
const wait = async (url, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, 250)); } } throw new Error(`timeout waiting for ${url}`); };
const start = (cmd, args, env, cwd) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); p.stderr.on('data', d => process.env.CONTRACT_VERBOSE && process.stderr.write(d)); p.on('exit', c => { if (c) console.error(`${cmd} exited with ${c}`); }); kids.push(p); return p; };
const stop = () => kids.forEach(k => { try { k.kill('SIGKILL'); } catch {} });
process.on('exit', stop);

(async () => {
  const db = { DB_CONNECTION: 'mysql', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: process.env.CONTRACT_DB || 'dwira_contract', DB_USERNAME: 'dwira', DB_PASSWORD: 'dwira_dev_pw' };
  const laravelEnv = { ...db, APP_ENV: 'production', APP_DEBUG: 'false', APP_URL: `http://127.0.0.1:${PHP_PORT}`, APP_ORIGINS: 'http://localhost:4173,http://localhost:8080', ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: bcrypt, CACHE_STORE: 'file', SESSION_DRIVER: 'array', LOG_CHANNEL: 'stderr', LOG_LEVEL: 'error', CONTENT_S_MAXAGE: '30', COOKIE_SECURE: 'true', PHP_CLI_SERVER_WORKERS: '4' };
  execFileSync('php', ['artisan', 'migrate:fresh', '--force'], { cwd: backend, env: { ...process.env, ...laravelEnv }, stdio: 'ignore' });
  execFileSync('php', ['artisan', 'cache:clear'], { cwd: backend, env: { ...process.env, ...laravelEnv }, stdio: 'ignore' });

  // The reference API runs on a real Postgres (what production used). PGlite needs ~350 MB of WASM heap and is OOM-killed on small
  // machines. Set CONTRACT_PG_URL to any empty-able database; its public schema is wiped on every run.
  const pgUrl = process.env.CONTRACT_PG_URL || 'postgres://dwira:dwira_dev_pw@127.0.0.1:5432/dwira_contract_pg';
  const { Client } = require(path.resolve(backend, '../node_modules/pg'));
  const pg = new Client({ connectionString: pgUrl }); await pg.connect();
  await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await pg.end();
  start('node', [path.join(__dirname, 'node-server.js')], { PORT: String(NODE_PORT), DATABASE_URL: pgUrl, NODE_ENV: 'test', ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: scrypt, DISABLE_DEFAULT_ADMIN: 'true', PUSH_WAIT_MS: '2000' }, backend);
  start('php', ['-S', `127.0.0.1:${PHP_PORT}`, '-t', 'public', 'public/index.php'], laravelEnv, backend);
  await Promise.all([wait(`http://127.0.0.1:${NODE_PORT}/api/health`), wait(`http://127.0.0.1:${PHP_PORT}/api/health`)]);

  const node = recorder(`http://127.0.0.1:${NODE_PORT}`), laravel = recorder(`http://127.0.0.1:${PHP_PORT}`);
  // Sequential on purpose: the two servers must see the same history.
  await run(node, { adminEmail: EMAIL, adminPassword: PASSWORD });
  await run(laravel, { adminEmail: EMAIL, adminPassword: PASSWORD });

  const problems = compare(node.log, laravel.log);
  console.log(`steps: node=${node.log.length} laravel=${laravel.log.length}  identical=${node.log.length - problems.length}  different=${problems.length}`);
  for (const p of problems) { console.log(`\n✗ ${p.step}`); p.list.slice(0, 8).forEach(l => console.log('    ' + l.slice(0, 400))); }
  if (process.env.CONTRACT_DUMP) require('node:fs').writeFileSync(process.env.CONTRACT_DUMP, JSON.stringify({ node: node.log, laravel: laravel.log }, null, 1));
  stop();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); stop(); process.exit(2); });
