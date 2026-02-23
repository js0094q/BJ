# BLACKJ Trainer, Vercel Deploy

## What changed
- Modern settings drawer for count system, decks, TC mode, bankroll, Kelly cap.
- Multiple count systems: Hi-Lo, Wong Halves, Hi-Opt II (Ace-neutral).
- True Count supports:
  - **SIM**: TC from cards dealt (training)
  - **CASINO**: TC from your **decks remaining** tray estimate
- Conservative edge model + capped fractional Kelly bet sizing.
- `vercel.json` includes security headers (CSP, frame-ancestors deny, etc.).

## Local test
From the folder containing `index.html`:

```bash
python3 -m http.server 8000
```

Then open: http://localhost:8000

## Deploy on Vercel (CLI)
1) Install Vercel CLI (once):
```bash
npm i -g vercel
```

2) From the project directory:
```bash
vercel login
vercel
```

- When asked for **Framework**, choose **Other**.
- When asked for **Output Directory**, leave blank (root).

3) Production deploy:
```bash
vercel --prod
```

## Deploy on Vercel (Git)
```bash
git init
git add .
git commit -m "BLACKJ: modern UI + accurate TC modes + count systems"
```

Then:
- Push to GitHub
- In Vercel, **New Project → Import Git Repository → Deploy**
