# CEOSkit Signal Engine

Deriv Options trading signal engine with integrated new Deriv API (OAuth2 PKCE + REST).

## Stack
- Pure HTML/CSS/JS — no build step required
- Vercel static hosting
- Deriv new REST API + WebSocket

## Deploy

### First time setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/ceoskit-signal-engine.git
cd ceoskit-signal-engine

# 2. Install Vercel CLI (once)
npm i -g vercel

# 3. Login to Vercel
vercel login

# 4. Deploy (first time — follow prompts)
vercel

# 5. For production
vercel --prod
```

### Subsequent deploys (after editing index.html)

```bash
git add .
git commit -m "update"
git push origin main
# Vercel auto-deploys on push if linked
```

### Or deploy manually from terminal

```bash
vercel --prod
```

## Deriv App Setup

1. Go to [developers.deriv.com](https://developers.deriv.com)
2. Register a new OAuth2 application
3. Set redirect URI to your Vercel URL: `https://your-app.vercel.app`
4. Copy your `client_id` and `App ID`
5. Open the app → ⚙️ API Admin Panel → paste credentials → Save & Apply

## Environment

All config is stored in `localStorage` via the in-app Admin Panel.  
No `.env` files or server-side secrets needed for this static build.
