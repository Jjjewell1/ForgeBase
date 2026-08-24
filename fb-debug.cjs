const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/ForgeBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const BASE = 'https://forge.jewellcore.com';
const cmd = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).cmd;

(async () => {
  let r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.FORGE_PASSWORD })
  });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  r = await fetch(BASE + '/api/debug/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ cmd, timeoutMs: 290000 })
  });
  const j = await r.json();
  console.log('code:', j.code);
  if (j.out) console.log('OUT:', j.out.slice(-3000));
  if (j.err) console.log('ERR:', j.err.slice(-3000));
})();
