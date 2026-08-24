# ForgeBase

AI app builder for the jewellcore.com homelab — describe an app in a prompt, and it gets
generated with opencode and deployed live to `<name>.jewellcore.com`.

## Status

- **v1 (live)**: static builder UI at forge.jewellcore.com
- **Phase 2**: opencode generation engine + model picker (Zen / Gemini / Ollama)
- **Phase 3**: full pipeline — GitHub repo create → Coolify deploy → Cloudflare wiring
  (built apps then appear in LaunchBase automatically)

## Deploy

Docker Compose app on the homelab Coolify VM; static build served by nginx through Traefik.

```powershell
npm install     # local dev
npm run dev     # vite dev server
npm run build   # production bundle → dist/
```
