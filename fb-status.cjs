const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/LaunchBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fetch(env.COOLIFY_BASE_URL + '/api/v1/deployments/' + process.argv[2], {
  headers: { Authorization: 'Bearer ' + env.COOLIFY_API_TOKEN }
}).then(async r => {
  const j = await r.json();
  console.log('status:', j.status);
});
