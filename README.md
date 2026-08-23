# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Deploy to Vercel

1. **Push to GitHub** — in the Lovable editor: Plus (+) menu → GitHub → Connect project → Create Repository. Every Lovable change syncs to the repo automatically.
2. **Import into Vercel** — vercel.com → Add New → Project → import the repo. Vercel auto-detects Vite; no config overrides needed (the server build auto-targets Vercel via Nitro).
3. **Add the secret** — Vercel → Project Settings → Environment Variables → `ZEROEX_API_KEY` (see `.env.example`). Without it, 0x quote fetching fails.
4. Deploy. Frontend and server functions ship together on every push to the default branch.

Notes:

- Operator settings (RPC endpoints, executor addresses, stealth relay/payout pool) live in browser localStorage per domain — re-enter them on the Vercel URL.
- The app never holds keys; signing stays in your wallet (MetaMask), so no env vars are needed for execution itself.
