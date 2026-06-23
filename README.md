# ⚡ DerivBot — Matches/Differs Martingale

Your own trading bot connected directly to your Deriv account. No middlemen, no deposits to third parties — your money stays in your Deriv wallet.

## Features
- Live WebSocket connection to Deriv API
- Matches & Differs on all 5 Volatility Indices
- 2.1× Martingale with configurable base stake and max steps
- Hard take profit & stop loss per session
- Real-time digit frequency tracker (last 200 ticks)
- Live trade log with win/loss history and win rate
- Activity log with timestamps

## Setup (5 minutes)

### 1. Get your Deriv API token
1. Go to https://app.deriv.com/account/api-token
2. Create a new token with **Read** + **Trade** scopes
3. Copy the token

> Start with a **Demo account** token — same steps, but your demo balance.

### 2. Run locally
```bash
npm install
npm run dev
```
Open http://localhost:5173 — paste your token and connect.

### 3. Deploy to Vercel (free hosting)
```bash
npm install -g vercel
vercel
```
That's it. Your bot is live at a public URL you can open on your phone.

## Risk settings guide

| Setting | Conservative | Moderate | Aggressive |
|---|---|---|---|
| Base stake | $0.35 | $1.00 | $2.00 |
| Max steps | 4 | 5 | 6 |
| Take profit | $5 | $10 | $20 |
| Stop loss | $15 | $30 | $60 |

**Never set stop loss higher than 30% of your account balance.**

## How Martingale works at 2.1×

```
Step 1: $0.35
Step 2: $0.74   (loss → multiply by 2.1)
Step 3: $1.55
Step 4: $3.25
Step 5: $6.82
Step 6: $14.32  ← max exposure with 6 steps = $27.03
```

A win at any step recovers all previous losses + small profit, then resets to step 1.

## Important disclaimer

Volatility indices on Deriv are synthetic markets with a built-in house edge. Martingale does not eliminate this edge — it concentrates risk into rare but large losses. Trade only what you can afford to lose. This bot is a tool, not a guarantee.
