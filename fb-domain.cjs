const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/LaunchBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fetch(env.COOLIFY_BASE_URL + '/api/v1/applications/a6yy09e2paf6vut5o2yj944w', {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + env.COOLIFY_API_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ docker_compose_domains: [{ name: 'frontend', domain: 'https://forge.jewellcore.com' }] })
}).then(async r => console.log(r.status, JSON.stringify(await r.json()).slice(0, 200)));
