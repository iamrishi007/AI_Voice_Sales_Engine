# AI Sales Agent — 100% Accuracy Challenge

A conversational sales agent that fetches a catalog (GET), negotiates with strict discount rules, and creates a
booking (POST) only after explicit confirmation — with duplicate-booking protection.

```
React + Vite + Tailwind  ──►  Node/Express  ──►  PostgreSQL (pg)
        :5173                      :5000        └────►  Python FastAPI + Gemini (language only)  :8000
```

## The one design rule

**The LLM never decides anything that matters.** It only (a) extracts *hints* from the customer's message and
(b) optionally re-words the reply. Everything else is deterministic code in `backend/src/engine`:

| Concern | Where | How |
|---|---|---|
| Product validation | `engine/matcher.js` | Fuzzy alias match; hard guards reject foreign brands/products |
| Quantity | `engine/salesEngine.js` | `ceil(requirement / max_capacity_per_unit)` |
| Pricing & discounts | `engine/pricing.js` | Tier ladder: 0% → `SAVE10` (10%) → `CLOSENOW15` (15%, max) |
| Booking authorisation | `salesEngine.step()` | `action: 'BOOK'` only after awaiting confirmation + clear "yes" |
| Second validation | `services/bookingService.js` | Re-validates sku/plan/qty/promo/`final_price` — wrong call → 422 |
| Stale prices | `chatService.executeBooking` | Catalog re-fetched before POST |
| Duplicates | mutex + atomic claim + unique idempotency key | Postgres unique on `idempotency_key` |
| LLM reply polish | `services/aiClient.js` | Rewritten text discarded if any number/code differs |

## Packages to install

### System (once)

| Tool | Why |
|---|---|
| **Node.js 18+** | Backend + frontend |
| **Python 3.10+** | AI language service |
| **PostgreSQL 14+** | Persistent store (or a cloud URL from Neon / Supabase / Railway) |

Windows (winget examples):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install PostgreSQL.PostgreSQL
```

Create the database (local Postgres):

```powershell
# after Postgres is installed and running
psql -U postgres -c "CREATE DATABASE ai_sales_agent;"
```

### Backend (Node)

```powershell
cd backend
npm install
# installs: express, cors, dotenv, pg
```

### Frontend (Node)

```powershell
cd frontend
npm install
# installs: react, react-dom, vite, tailwindcss, postcss, autoprefixer
```

### AI service (Python)

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
# installs: fastapi, uvicorn[standard], pydantic, google-genai, python-dotenv
```

## `.env` variables

### `backend/.env`

| Variable | Example | Required |
|---|---|---|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:5432/ai_sales_agent` | Yes (or use PG* vars) |
| `DATABASE_SSL` | `true` for Neon/Supabase; `false` for local | No (default false) |
| `REQUIRE_POSTGRES` | `true` to refuse in-memory fallback | No |
| `PORT` | `5000` | No |
| `AI_SERVICE_URL` | `http://127.0.0.1:8000` | No |
| `AI_TIMEOUT_MS` | `8000` | No |
| `BOOKING_LATENCY_MS` | `1500` | No |
| `CORS_ORIGIN` | `http://localhost:5173` | No |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | Discrete alternative to `DATABASE_URL` | Only if URL empty |

Copy from example:

```powershell
cd backend
copy .env.example .env
# then edit DATABASE_URL with your link
```

### `ai-service/.env`

| Variable | Example | Required |
|---|---|---|
| `GEMINI_API_KEY` | your Google AI Studio key | Optional (engine still works without it) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | No |

```powershell
cd ai-service
copy .env.example .env
# put GEMINI_API_KEY=...
```

Frontend needs no `.env` (Vite proxies `/api` → `http://localhost:5000`).

## Run it (3 terminals)

```powershell
# Terminal 1 — AI service
cd ai-service
.\.venv\Scripts\activate
uvicorn main:app --port 8000

# Terminal 2 — Backend
cd backend
npm start
# http://localhost:5000

# Terminal 3 — Frontend
cd frontend
npm run dev
# http://localhost:5173
```

Schema + seed catalog are applied automatically on backend startup.

Tests (no Postgres / Gemini needed):

```powershell
cd backend
npm test
```

## API

| Method & path | Purpose |
|---|---|
| `GET /api/catalog` | `{ SKU: { name, max_capacity_per_unit, plans } }` |
| `POST /api/chat` | `{ conversationId?, message, clientMessageId? }` |
| `GET /api/chat` / `GET /api/chat/:id` | Conversation list / full conversation |
| `POST /api/bookings` | Create booking (+ optional `Idempotency-Key`) |
| `GET /api/bookings`, `GET /api/bookings/:id` | List / fetch |
| `GET /api/logs?conversationId=` | API execution log |
| `GET /api/health` | Liveness + active DB (`postgres` or `memory`) |

AI service: `POST /nlu`, `POST /polish`, `GET /health`.

## Try the four scenarios in the chat

1. "I need arrow mesh wifi on the PRO plan for a 5-room house" → 3 units, $1,497.00. "Do you have the Netgear Orbi router?" → not in catalog.
2. Quote at 0% → "too expensive" → `SAVE10` → "still too pricey" → `CLOSENOW15` → more pushes stay at 15%.
3. Change rooms or plan, then say "ok book it" → agent restates new total and waits for a fresh "yes".
4. Send "Yes, book it!" twice quickly → exactly one booking.
