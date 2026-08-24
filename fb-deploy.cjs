const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/LaunchBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const base = env.COOLIFY_BASE_URL, tok = env.COOLIFY_API_TOKEN;
fetch(base + '/api/v1/deploy', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
  body: JSON.stringify({ uuid: process.argv[2] || 'a6yy09e2paf6vut5o2yj944w' })
}).then(async r => {
  const j = await r.json();
  console.log(r.status, JSON.stringify(j.deployments ? j.deployments[0] : j));
});
