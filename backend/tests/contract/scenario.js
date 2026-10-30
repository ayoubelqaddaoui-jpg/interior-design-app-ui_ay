// One ordered script of API calls. Run unchanged against the Node API and the Laravel API; every response is recorded and
// compared (status, content-type, cache-control, cookie attributes, ETag presence, CORS/nosniff headers, normalised body).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const J = { 'content-type': 'application/json' };
const phone = n => `+2126${String(n).padStart(8, '0')}`;

async function run(rec, { adminEmail, adminPassword }) {
  const { call } = rec;
  const device = 'd'.repeat(64);
  const native = { 'x-dwira-native': '1' };

  // ---- health / unknown / CORS / body rules ----
  await call('health', 'GET', '/api/health', { ignore: ['body.runtime', 'body.database', 'body.media', 'body.adminConfigured'] });
  await call('unknown route', 'GET', '/api/nope');
  await call('wrong method on known path', 'DELETE', '/api/health');
  await call('options preflight', 'OPTIONS', '/api/sync', { headers: { origin: 'http://localhost:4173' } });
  await call('foreign origin', 'GET', '/api/sync', { headers: { origin: 'https://evil.example' } });
  await call('allowed origin', 'GET', '/api/sync', { headers: { origin: 'http://localhost:4173' } });
  await call('non-json body', 'POST', '/api/user/login', { raw: 'name=x', headers: { 'content-type': 'text/plain' } });
  await call('invalid json', 'POST', '/api/user/login', { raw: '{bad', headers: J });
  await call('invalid profile', 'POST', '/api/user/login', { body: { name: 'A', phone: '1' } });

  // ---- public content / sync ----
  const content = await call('content public', 'GET', '/api/content', { ignore: ['body.version', 'etag'] }); // Laravel adds an ETag on purpose
  await call('content admin-panel copy', 'GET', '/api/content?a=1', { ignore: ['body.version'] });
  await call('sync anonymous', 'GET', '/api/sync', { ignore: ['body.content'] });
  await call('sync guest device', 'GET', '/api/sync', { headers: { 'x-demand-token': device }, ignore: ['body.content'] });

  // ---- admin auth ----
  await call('admin session without login', 'GET', '/api/admin/session');
  await call('admin login wrong password', 'POST', '/api/admin/login', { body: { email: adminEmail, password: 'nope-nope-nope' } });
  await call('admin login bad types', 'POST', '/api/admin/login', { body: { email: 1, password: 2 } });
  const login = await call('admin login', 'POST', '/api/admin/login', { body: { email: adminEmail, password: adminPassword }, headers: native });
  const A = { authorization: `Bearer ${login.json?.token}` };
  const cookieLogin = await call('admin login (cookie)', 'POST', '/api/admin/login', { body: { email: adminEmail, password: adminPassword } });
  const adminCookie = (cookieLogin.headers.getSetCookie?.()[0] || '').split(';')[0];
  await call('admin session via cookie', 'GET', '/api/admin/session', { headers: { cookie: adminCookie } });
  await call('admin session via bearer', 'GET', '/api/admin/session', { headers: A });
  await call('content admin copy', 'GET', '/api/content', { headers: A, ignore: ['body.version'] });
  await call('sync admin', 'GET', '/api/sync', { headers: A, ignore: ['body.content'] });
  await call('admin prefs get', 'GET', '/api/prefs?as=admin', { headers: A });
  await call('admin prefs patch', 'PATCH', '/api/prefs?as=admin', { headers: A, body: { notifications: false, theme: 'dark' } });
  await call('admin prefs wrong method', 'DELETE', '/api/prefs?as=admin', { headers: A });

  // ---- client accounts ----
  await call('requests list without admin', 'GET', '/api/requests');
  const c1 = await call('client login', 'POST', '/api/user/login', { body: { name: '  Salma Real ', phone: '0661 00 00 01' }, headers: { ...native, 'x-demand-token': device } });
  const U = { 'x-user-token': c1.json?.token, 'x-demand-token': device };
  await call('client login again (same phone)', 'POST', '/api/user/login', { body: { name: 'Salma Real', phone: '+212661000001' }, headers: native });
  await call('client session', 'GET', '/api/user/session', { headers: U });
  await call('client session without token', 'GET', '/api/user/session');
  await call('prefs patch', 'PATCH', '/api/prefs', { headers: U, body: { language: 'ar' } });
  await call('prefs get', 'GET', '/api/prefs', { headers: U });
  await call('sync client', 'GET', '/api/sync', { headers: U, ignore: ['body.content'] });

  // ---- render requests ----
  const demand = (id, extra = {}) => ({ id, photoUri: PNG, draft: { toolId: 'tool_interior', styleId: 's1', junk: 'x' }, ...extra });
  await call('request without device token', 'POST', '/api/requests', { headers: { 'x-user-token': c1.json?.token }, body: demand('req-contract-01') });
  await call('request bad id', 'POST', '/api/requests', { headers: U, body: demand('x') });
  await call('request bad photo', 'POST', '/api/requests', { headers: U, body: demand('req-contract-02', { photoUri: 'javascript:alert(1)' }) });
  await call('request no tool', 'POST', '/api/requests', { headers: U, body: { id: 'req-contract-03', photoUri: PNG, draft: {} } });
  const r1 = await call('request create', 'POST', '/api/requests', { headers: U, body: demand('req-contract-01') });
  await call('request replay (idempotent)', 'POST', '/api/requests', { headers: U, body: demand('req-contract-01') });
  await call('session after claim', 'GET', '/api/user/session', { headers: U });
  await call('user requests', 'GET', '/api/user/requests', { headers: U });
  await call('admin requests', 'GET', '/api/requests', { headers: A });
  const rid = r1.json?.id;
  await call('request get own', 'GET', `/api/requests/${rid}`, { headers: U });
  await call('request get anonymous', 'GET', `/api/requests/${rid}`);
  await call('request get unknown', 'GET', '/api/requests/unknown-id', { headers: A });
  await call('request patch bad status', 'PATCH', `/api/requests/${rid}`, { headers: A, body: { status: 'bogus' } });
  await call('request patch bad autoSent', 'PATCH', `/api/requests/${rid}`, { headers: A, body: { autoSent: 'yes' } });
  await call('request patch client tries status', 'PATCH', `/api/requests/${rid}`, { headers: U, body: { status: 'delivered', aiResult: 'https://example.invalid/x' } });
  await call('history create without claim', 'POST', '/api/user/history', { headers: U, body: { claimId: 'req-other-0001', draft: { toolId: 't' }, before: 'b', status: 'pending' } });
  await call('history invalid', 'POST', '/api/user/history', { headers: U, body: { claimId: 'req-contract-01', draft: {}, before: 1 } });
  await call('history create', 'POST', '/api/user/history', { headers: U, body: { claimId: 'req-contract-01', draft: { toolId: 'tool_interior' }, before: PNG, status: 'pending' } });
  await call('request link history', 'PATCH', `/api/requests/${rid}`, { headers: U, body: { historyId: 'req-contract-01' } });
  await call('request deliver (admin)', 'PATCH', `/api/requests/${rid}`, { headers: A, body: { status: 'delivered', finalResult: PNG } });
  await call('history after delivery', 'GET', '/api/user/history/req-contract-01', { headers: U });
  await call('history list', 'GET', '/api/user/history', { headers: U });
  await call('claim endpoint', 'POST', '/api/user/claim', { headers: U, body: { id: 'req-claim-0001' } });
  await call('claim endpoint bad id', 'POST', '/api/user/claim', { headers: U, body: { id: 'x' } });

  // ---- conversations: guest -> client ----
  const g = { 'x-demand-token': 'g'.repeat(64) };
  const gc = await call('guest chat create', 'POST', '/api/guest/conversations', { headers: g, body: { title: 'Hi', messages: [{ id: 'm1', role: 'user', text: 'hello', createdAt: 1700000000001 }, { id: 'm2', role: 'admin', text: 'forged', createdAt: 1700000000002 }] } });
  const gid = gc.json?.id;
  await call('guest chat list', 'GET', '/api/guest/conversations', { headers: g });
  await call('guest chat get', 'GET', `/api/guest/conversations/${gid}`, { headers: g });
  await call('guest chat get unknown', 'GET', '/api/guest/conversations/nope', { headers: g });
  await call('guest chat no token', 'GET', '/api/guest/conversations');
  await call('guest chat bad body', 'POST', '/api/guest/conversations', { headers: g, body: { title: 5, messages: 'x' } });
  await call('guest chat signed-in conflict', 'GET', '/api/guest/conversations', { headers: U });
  await call('admin conversations', 'GET', '/api/admin/conversations', { headers: A });
  await call('admin reply empty', 'POST', `/api/admin/conversations/${gid}`, { headers: A, body: { text: '  ' } });
  await call('admin reply guest', 'POST', `/api/admin/conversations/${gid}`, { headers: A, body: { text: ' Bonjour ' } });
  await call('admin reply unknown', 'POST', '/api/admin/conversations/nope', { headers: A, body: { text: 'x' } });
  await call('sync guest after reply', 'GET', '/api/sync', { headers: g, ignore: ['body.content'] });
  const conv = await call('client conversation create', 'POST', '/api/user/conversations', { headers: U, body: { title: 'Mine', messages: [{ id: 'c1', role: 'user', text: 'salut', createdAt: 1700000000100 }] } });
  const cid = conv.json?.id;
  await call('admin reply client', 'POST', `/api/admin/conversations/${cid}`, { headers: A, body: { text: 'Reponse' } });
  await call('client conversation patch keeps admin msgs', 'PATCH', `/api/user/conversations/${cid}`, { headers: U, body: { title: 'Mine', messages: [{ id: 'c1', role: 'user', text: 'salut', createdAt: 1700000000100 }] } });
  await call('client conversations list', 'GET', '/api/user/conversations', { headers: U });
  await call('client conversation delete', 'DELETE', `/api/user/conversations/${cid}`, { headers: U });
  await call('space wrong method', 'PUT', '/api/user/history', { headers: U, body: {} });

  // ---- admin: clients ----
  const second = await call('second client login', 'POST', '/api/user/login', { body: { name: 'Other Client', phone: '0662000002' }, headers: native });
  const sid = second.json?.user?.id;
  await call('admin clients', 'GET', '/api/admin/clients', { headers: A });
  await call('admin clients unauth', 'GET', '/api/admin/clients');
  await call('admin client credits', 'PATCH', `/api/admin/clients/${sid}`, { headers: A, body: { credits: 5 } });
  await call('admin client bad credits', 'PATCH', `/api/admin/clients/${sid}`, { headers: A, body: { credits: -1 } });
  await call('admin client bad blocked', 'PATCH', `/api/admin/clients/${sid}`, { headers: A, body: { blocked: 'yes' } });
  await call('admin bulk add credits', 'POST', '/api/admin/clients/bulk', { headers: A, body: { ids: [sid], action: 'credits', mode: 'add', amount: 2 } });
  await call('admin bulk bad ids', 'POST', '/api/admin/clients/bulk', { headers: A, body: { ids: [], action: 'block' } });
  await call('admin bulk bad action', 'POST', '/api/admin/clients/bulk', { headers: A, body: { ids: [sid], action: 'nuke' } });
  await call('admin block client', 'PATCH', `/api/admin/clients/${sid}`, { headers: A, body: { blocked: true } });
  await call('blocked client login', 'POST', '/api/user/login', { body: { name: 'Other Client', phone: '0662000002' } });
  await call('blocked client session', 'GET', '/api/user/session', { headers: { 'x-user-token': second.json?.token } });
  await call('blocked client sync', 'GET', '/api/sync', { headers: { 'x-user-token': second.json?.token }, ignore: ['body.content', 'body.client'] });
  await call('admin bulk delete', 'POST', '/api/admin/clients/bulk', { headers: A, body: { ids: [sid], action: 'delete' } });
  await call('admin delete missing client', 'DELETE', `/api/admin/clients/${sid}`, { headers: A });

  // ---- admin content ----
  const style = content.json?.collections?.styles?.[0];
  if (style) {
    await call('admin content put', 'PUT', `/api/admin/content/styles/${style.id}`, { headers: A, body: { ...style, name: 'Renamed' } });
    await call('admin content put bad body', 'PUT', `/api/admin/content/styles/${style.id}`, { headers: A, body: [1] });
    await call('admin content put unknown collection', 'PUT', '/api/admin/content/nothing/x1', { headers: A, body: { id: 'x1' } });
  }
  await call('admin content wrong method', 'PUT', '/api/admin/content/styles', { headers: A, body: {} });
  await call('admin doc patch', 'PATCH', '/api/admin/doc/settings', { headers: A, body: { defaultFreeCredits: 3 } });
  await call('admin doc unknown', 'PATCH', '/api/admin/doc/nothing', { headers: A, body: { a: 1 } });
  await call('content after edits', 'GET', '/api/content', { ignore: ['body.version', 'etag'] });

  // ---- media ----
  await call('media upload unauth', 'POST', '/api/admin/media', { body: { data: PNG } });
  await call('media upload bad data', 'POST', '/api/admin/media', { headers: A, body: { data: 'nope' } });
  await call('media upload bad type', 'POST', '/api/admin/media', { headers: A, body: { data: 'data:text/html;base64,PGI+' } });
  const up = await call('media upload', 'POST', '/api/admin/media', { headers: A, body: { data: PNG } });
  await call('media raw bad type', 'POST', '/api/admin/media/raw', { headers: { ...A, 'content-type': 'text/html' }, raw: '<b>' });
  await call('media presign', 'POST', '/api/admin/media/presign', { headers: A, body: { contentType: 'video/mp4', size: 10 } });
  await call('media complete', 'POST', '/api/admin/media/complete', { headers: A, body: { id: 'a'.repeat(32) } });
  await call('media import non-https', 'POST', '/api/admin/media/import', { headers: A, body: { url: 'http://example.com/a.png' } });
  await call('media import private host', 'POST', '/api/admin/media/import', { headers: A, body: { url: 'https://127.0.0.1/a.png' } });
  await call('media import bad url type', 'POST', '/api/admin/media/import', { headers: A, body: { url: 5 } });
  if (up.json?.url) {
    // Node keeps the original bytes (png); Laravel recompresses to WebP on purpose: only the shape of the response is compared.
    await call('media get', 'GET', up.json.url, { ignore: ['type', 'body', 'etag'] });
  }
  await call('media get unknown', 'GET', `/api/media/${'0'.repeat(32)}.png`);

  // ---- push ----
  await call('push config', 'GET', '/api/push/config', { ignore: ['body.publicKey'] });
  const sub = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/contract', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') } }, language: 'fr' };
  await call('push subscribe unauth', 'POST', '/api/push/subscriptions', { body: sub });
  await call('push subscribe client unauth', 'POST', '/api/push/subscriptions', { body: { ...sub, owner: 'client' } });
  await call('push subscribe invalid', 'POST', '/api/push/subscriptions', { headers: A, body: { junk: 1 } });
  await call('push subscribe bad provider', 'POST', '/api/push/subscriptions', { headers: A, body: { subscription: { endpoint: 'https://evil.example/x', keys: sub.subscription.keys } } });
  await call('push subscribe', 'POST', '/api/push/subscriptions', { headers: A, body: sub });
  await call('push subscribe client', 'POST', '/api/push/subscriptions', { headers: U, body: { ...sub, owner: 'client', subscription: { ...sub.subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/client-contract' } } });
  await call('push subscribers admin view', 'GET', '/api/admin/notification-subscribers', { headers: A });
  await call('push subscriptions wrong method', 'GET', '/api/push/subscriptions', { headers: A, body: sub });
  await call('push unsubscribe', 'DELETE', '/api/push/subscriptions', { headers: A, body: sub });
  await call('push test none', 'POST', '/api/push/test', { headers: A, body: {} });
  await call('push pump unauth', 'GET', '/api/push/pump');
  await call('push pump admin', 'POST', '/api/push/pump', { headers: A, body: {} });

  // ---- campaigns ----
  await call('campaigns unauth', 'GET', '/api/admin/campaigns');
  await call('campaigns list', 'GET', '/api/admin/campaigns', { headers: A });
  await call('campaign bad kind', 'POST', '/api/admin/campaigns', { headers: A, body: { kind: 'x' } });
  await call('campaign no name', 'POST', '/api/admin/campaigns', { headers: A, body: { kind: 'once', name: '' } });
  const camp = await call('campaign create', 'POST', '/api/admin/campaigns', { headers: A, body: { kind: 'once', name: 'Spring', title: { fr: 'Bonjour {name}', ar: 'مرحبا' }, body: { fr: 'Nouveaux designs' }, url: '/', audience: { segments: ['all'] } } });
  const kid = camp.json?.id;
  await call('campaign bad url', 'POST', '/api/admin/campaigns', { headers: A, body: { kind: 'once', name: 'X', url: 'javascript:1' } });
  await call('campaign get', 'GET', `/api/admin/campaigns/${kid}`, { headers: A });
  await call('campaign get bad id', 'GET', '/api/admin/campaigns/zz', { headers: A });
  await call('campaign get missing', 'GET', `/api/admin/campaigns/${'a'.repeat(8)}-0000`, { headers: A });
  await call('campaign patch', 'PATCH', `/api/admin/campaigns/${kid}`, { headers: A, body: { name: 'Spring 2' } });
  await call('campaign segments', 'GET', '/api/admin/campaigns/segments?newDays=3', { headers: A });
  await call('campaign preview', 'POST', '/api/admin/campaigns/preview', { headers: A, body: { segments: ['all'] } });
  await call('campaign preview bad segment', 'POST', '/api/admin/campaigns/preview', { headers: A, body: { segments: ['zzz'] } });
  await call('campaign people', 'GET', '/api/admin/campaigns/people', { headers: A });
  await call('campaign test no devices', 'POST', '/api/admin/campaigns/test', { headers: A, body: { name: 't', title: { fr: 'a' }, body: { fr: 'b' } } });
  await call('campaign duplicate', 'POST', `/api/admin/campaigns/${kid}/duplicate`, { headers: A, body: {} });
  await call('campaign action wrong method', 'GET', `/api/admin/campaigns/${kid}/pause`, { headers: A });
  await call('campaign unknown action', 'POST', `/api/admin/campaigns/${kid}/explode`, { headers: A, body: {} });
  await call('campaign pause', 'POST', `/api/admin/campaigns/${kid}/pause`, { headers: A, body: {} });
  await call('campaign delete', 'DELETE', `/api/admin/campaigns/${kid}`, { headers: A });

  // ---- assistant / chat ----
  await call('chat reply no token', 'POST', '/api/chat/reply', { body: { messages: [] } });
  await call('admin chat status', 'GET', '/api/admin/chat/status', { headers: A, ignore: ['body'] });
  await call('admin chat keys bad', 'PATCH', '/api/admin/chat/keys', { headers: A, body: { gemini: 'short' } });
  await call('admin translate bad', 'POST', '/api/admin/translate', { headers: A, body: {} });

  // ---- request delete + logout ----
  await call('request delete as client', 'DELETE', `/api/requests/${rid}`, { headers: U });
  await call('request delete as admin', 'DELETE', `/api/requests/${rid}`, { headers: A });
  await call('request delete again', 'DELETE', `/api/requests/${rid}`, { headers: A });
  await call('client logout', 'POST', '/api/user/logout', { headers: U, body: {} });
  await call('client session after logout', 'GET', '/api/user/session', { headers: U });
  await call('admin logout', 'POST', '/api/admin/logout', { headers: A, body: {} });
  await call('admin session after logout', 'GET', '/api/admin/session', { headers: A });
}
module.exports = { run };
