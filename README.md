# Meel

**Meel** is an intuitive meal-and-grocery assistant for busy people who care about health. It runs inside ChatGPT—no new app. Agentic AI learns your diet and budget, builds a visual weekly plan with recipe images and a priced list, then fills your cart at the store. You press buy.

**[▶ Watch demo](https://streamable.com/t4neyf)**

---

## The problem we solve

Deciding what to eat and planning meals is **time-consuming**: you have to juggle what you like, what’s good for your diet, what you can afford, and what you have time to cook. Doing that week after week burns mental energy and often leads to last-minute, expensive or unhealthy choices—time you could be spending vibe-coding the next unicorn instead.

**Meel** is your personal chef assistant: it handles meal prep, nutrition, and automates groceries. You set your **personal preferences and diet** (allergies, cuisines, cooking time) and a **budget**; Meel gives you a tailored plan and a shopping list with **estimated prices**. When you’re ready, you click buy, collect the delivery, and enjoy the cooking—from the recipes Meel picked for you. All the planning and list-building happens in one conversation.

![Have you ever](https://media.makeameme.org/created/have-you-ever-7c0761a338.jpg)

---

## What the product does

- **Preference collection** — Asks about diet, allergies, household size, budget, cooking time, and cuisine via simple card-based choices inside ChatGPT.
- **Meal plan generation** — Produces a day-by-day plan (e.g. lunch + dinner) with dish names, calories, and prep time.
- **Recipe images** — Generates an image per recipe with [Fal.ai](https://fal.ai) (Flux text-to-image) and shows them in the plan.
- **Shopping list** — Aggregates ingredients across the plan with quantities and estimated prices (e.g. in €).
- **Cart filling** — Sends the list to a browser automation agent that navigates to a grocery site and adds items to the cart; you get a “Buy now” link when it’s done.

All of this runs as a **ChatGPT app**: you talk in natural language and use the embedded widgets (cards, plan, list, actions) without leaving the chat.

---

## Hackathon

This project was built for the **[{Tech: Europe} Paris AI Hackathon](https://luma.com/paris-hack?tk=gbrRSR)** (Paris, 2025).

**Authors:** Yann, Karl, Kostya & Chiara

---

## Sponsor technologies we use

We use the following technologies from the hackathon partners:

| Sponsor | How we use it |
|--------|----------------|
| **OpenAI** | ChatGPT app (conversation + tool calls) and OpenAI API (e.g. controlling the Browser Use agent and translation). |
| **Alpic** | ChatGPT apps TypeScript template and deployment (hosting the MCP server and widgets). |
| **Fal.ai** | Text-to-image model inference: we use Fal’s Flux model to generate one image per recipe and display it in the meal plan. |

---

## Tech stack

- **Runtime:** Node.js 24+, TypeScript
- **Framework:** [Skybridge](https://github.com/alpic-ai/skybridge) (MCP server + React widgets)
- **Frontend:** React 19, Vite
- **Validation:** Zod
- **APIs / services:** Fal.ai (images), Browser Use (cart automation), OpenAI (ChatGPT + API)

---

## Run it locally

### Prerequisites

- **Node.js 24+**
- **pnpm** — `npm install -g pnpm`
- **ngrok** (or another tunnel) — so ChatGPT can reach your local server

### 1. Clone and install

```bash
git clone <your-repo-url>
cd Meel
pnpm install
```

### 2. Environment variables

Copy the example env file and fill in the keys you need:

```bash
cp .env.example .env
```

Edit `.env`. The app only uses **these three** (all are in `.env.example`):

| Variable | Used for | Where to get it |
|----------|----------|-----------------|
| `OPENAI_API_KEY` | Translation when filling cart (e.g. product names → French for Carrefour) | [OpenAI API keys](https://platform.openai.com/api-keys) |
| `BROWSER_USE_API_KEY` | Fill-cart: browser automation to add items to the grocery site | [Browser Use](https://www.browseruse.com) |
| `FAL_KEY` | Recipe images in the meal plan (Flux text-to-image) | [Fal.ai](https://fal.ai) |

- For **meal plans with recipe images only**, you only need `FAL_KEY`; the server runs without the other two (cart filling will fail if used).
- For **cart filling** to work, you need `OPENAI_API_KEY` and `BROWSER_USE_API_KEY` as well.

**Cart filling (Carrefour):** For the “fill cart” feature to work locally, you need to be logged into Carrefour in two places: (1) in your **Browser Use** profile (create a profile at [cloud.browser-use.com](https://cloud.browser-use.com/settings?tab=profiles), then have the agent log in to Carrefour and add an item to the cart so the session is saved), and (2) in a **browser on your local machine** (e.g. log in at [carrefour.fr](https://www.carrefour.fr) in Chrome). Carrefour may send a code by email for verification; use the live agent view in Browser Use to complete login if needed. Use the `profileId` from your Browser Use profile in the code (see `server/src/server.ts`) and your own `BROWSER_USE_API_KEY` in `.env`.

### 3. Start the dev server

From the repo root:

```bash
pnpm dev
```

You should see:

- **DevTools:** http://localhost:3000/
- **MCP endpoint:** http://localhost:3000/mcp

### 4. Expose the server to the internet (for ChatGPT)

ChatGPT needs a public URL. In a new terminal:

```bash
ngrok http 3000
```

Copy the `https://...ngrok-free.app` URL (no path).

### 5. Connect ChatGPT to Meel

1. In ChatGPT: **Settings → Apps → Developer mode → Add app**.
2. Paste your ngrok URL and add `/mcp` at the end, e.g.  
   `https://xxxx.ngrok-free.app/mcp`
3. Save. Use the app in a chat and start asking for a meal plan.

---

## Deploy to production

We deploy with **[Alpic](https://alpic.ai/)**:

1. Use the [Alpic deploy button](https://app.alpic.ai/new/clone?repositoryUrl=...) or connect your repo.
2. Configure the same environment variables in the Alpic dashboard.
3. In ChatGPT, add the app (Settings → Apps → Developer mode → Add app) with your Alpic app URL, e.g.  
   `https://your-app-name.alpic.live/mcp`

---

## Project structure (high level)

```
Meel/
├── server/src/          # MCP server (tools + widgets)
│   ├── index.ts         # Express app, routes
│   ├── server.ts        # Tool/widget definitions, Fal, Browser Use
│   └── middleware.ts    # MCP middleware
├── web/src/             # React frontend
│   ├── widgets/         # four-cards, show-plan
│   └── components/      # Cards, meal plan, ingredients, actions
├── data/                # Optional runtime data (e.g. profiles)
├── .env.example         # Env template
└── package.json
```

---

## Future development

Planned improvements and extensions:

- **Long-running tasks and polling in widgets** — Better support for async jobs (e.g. cart filling, image generation) with progress polling and clearer loading states inside the ChatGPT UI.
- **More retailers than Carrefour** — Add more grocery partners and let users choose their preferred store for cart filling and price estimates.
- **User auth and historical orders** — Sign-in, persist preferences per user, and store past meal plans and orders so users can reorder or repeat previous weeks.
- **Checkout from the ChatGPT UI with Agent Commerce Protocol** — Enable full checkout (payment, delivery slot, etc.) from within the chat using OpenAI’s Agent Commerce Protocol instead of only opening the retailer’s cart.

---

## Resources

- [Skybridge docs](https://docs.skybridge.tech)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Alpic](https://docs.alpic.ai/)
- [Fal.ai](https://fal.ai)
- [Browser Use](https://www.browseruse.com)
