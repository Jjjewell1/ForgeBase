const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/ForgeBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const BASE = 'https://forge.jewellcore.com';
const prompt = process.argv[2] || 'Create a single-file index.html containing a page with a button that counts clicks and displays the count. Keep it minimal.';

(async () => {
  // login
  let r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.FORGE_PASSWORD })
  });
  console.log('login:', r.status);
  if (r.status !== 200) { console.log(await r.text()); return; }
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];

  // start build
  r = await fetch(BASE + '/api/builds', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ prompt })
  });
  const b = await r.json();
  console.log('build start:', r.status, JSON.stringify(b));
})();
