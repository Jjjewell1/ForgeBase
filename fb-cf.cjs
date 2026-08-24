const fs = require('fs');
function loadEnv(p) {
  try {
    return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
  } catch { return {}; }
}
const env = { ...loadEnv('D:/Sites/LaunchBase/.env'), ...loadEnv('D:/Sites/ForgeBase/.env') };
const T = env.CF_WRITE_TOKEN;
const acct = env.CF_ACCOUNT_ID, zone = env.CF_ZONE_ID, tunnel = env.TUNNEL_ID;
const H = { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' };
const host = 'forge.jewellcore.com';

(async () => {
  // 1. read tunnel config
  let r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/cfd_tunnel/${tunnel}/configurations`, { headers: H });
  let cfg = (await r.json()).result;
  const has = cfg.config.ingress.some(i => i.hostname === host);
  if (!has) {
    const catchAll = cfg.config.ingress[cfg.config.ingress.length - 1];
    const rest = cfg.config.ingress.slice(0, -1);
    rest.push({ hostname: host, service: 'http://localhost:80', originRequest: {} });
    cfg.config.ingress = [...rest, catchAll];
    r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/cfd_tunnel/${tunnel}/configurations`, {
      method: 'PUT', headers: H, body: JSON.stringify({ config: cfg.config })
    });
    console.log('ingress PUT:', r.status);
  } else {
    console.log('ingress already has', host);
  }

  // 2. DNS CNAME
  r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?name=${host}`, { headers: H });
  const existing = (await r.json()).result;
  if (existing.length === 0) {
    r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ type: 'CNAME', name: host, content: `${tunnel}.cfargotunnel.com`, proxied: true })
    });
    console.log('DNS POST:', r.status);
  } else {
    console.log('DNS record exists:', existing[0].type, existing[0].content);
  }
})();
