const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/ForgeBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const BASE = 'https://forge.jewellcore.com';
const id = process.argv[2];
if (!id) { console.log('usage: node fb-build.cjs <buildId>'); process.exit(1); }

(async () => {
  let r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.FORGE_PASSWORD })
  });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (process.argv[3] === 'files') {
    const files = await (await fetch(`${BASE}/api/builds/${id}/files`, { headers: { Cookie: cookie } })).json();
    for (const f of files) console.log(f.size.toString().padStart(7), f.path);
    return;
  }
  r = await fetch(`${BASE}/api/builds/${id}`, { headers: { Cookie: cookie } });
  const b = await r.json();
  console.log('status:', b.status, '| logs:', b.totalLogs ?? b.logs?.length);
  for (const l of (b.logs || []).slice(-12)) console.log(' ', l.line);
  if (b.error) console.log('ERROR:', b.error);
})();
