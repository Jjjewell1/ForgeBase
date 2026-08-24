const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('D:/Sites/LaunchBase/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fetch(env.COOLIFY_BASE_URL + '/api/v1/deployments/' + process.argv[2], {
  headers: { Authorization: 'Bearer ' + env.COOLIFY_API_TOKEN }
}).then(async r => {
  const j = await r.json();
  console.log('status:', j.status);
  let logs = j.logs;
  if (typeof logs === 'string') { try { logs = JSON.parse(logs); } catch {} }
  if (Array.isArray(logs)) {
    console.log('--- last 40 lines ---');
    for (const line of logs.slice(-40)) {
      const t = typeof line === 'string' ? line : (line.line || line.message || JSON.stringify(line));
      console.log(t);
    }
  } else {
    console.log('logs field:', JSON.stringify(logs));
    console.log('keys:', Object.keys(j).join(','));
  }
});
