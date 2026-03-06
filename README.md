<p align="center">
  <img src="web/public/favicon.svg" alt="Megh" width="80" />
</p>

<h1 align="center">Megh</h1>

<p align="center">
  <strong>On-demand Claude Code sandboxes in the cloud.</strong><br/>
  Self-hosted platform that gives every user an isolated, browser-based terminal with Claude CLI pre-installed.
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#deployment">Deployment</a> &middot;
  <a href="#api-reference">API</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

## What is Megh?

Megh is a self-hosted platform that spins up isolated Docker containers with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) pre-installed. Users get a full browser-based terminal session where they can use Claude CLI to build, debug, and ship code — without installing anything locally.

Think of it as your own private cloud IDE powered by Claude, with built-in user management, billing, and session lifecycle management.

**Live instance:** [megh.live](https://megh.live)

## Features

- **Instant sandboxes** — Launch isolated Docker containers with Claude CLI in seconds
- **Browser terminal** — Full xterm.js terminal over WebSocket, no SSH required
- **Session lifecycle** — Automatic TTL, grace periods, and cleanup of idle containers
- **User authentication** — JWT-based auth with registration, login, and automatic token refresh
- **Usage billing** — Per-hour session billing with balance tracking and monthly limits
- **File transfer** — Upload files to and download workspaces from containers as tar archives
- **Port previews** — Access web apps running inside containers via `/preview/{session}/{port}/`
- **Admin dashboard** — Manage users, sessions, pricing, and monitor system health
- **Resource limits** — Per-container CPU/memory caps, per-user concurrency limits, global capacity controls
- **OAuth & API key support** — Authenticate Claude via Anthropic OAuth token or API key
- **Security hardened** — Containers run with dropped capabilities, no-new-privileges, and isolated networking

## Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │                   Nginx                      │
                  │            Reverse proxy (:80)               │
                  └──────┬──────────┬──────────────┬────────────┘
                         │          │              │
                    /api/*     / (frontend)    /ws (terminal)
                         │          │              │
                  ┌──────┴──┐  ┌────┴────┐   ┌────┴────┐
                  │   API   │  │   Web   │   │   API   │
                  │ Express │  │ Next.js │   │   WS    │
                  │  :3000  │  │  :3001  │   │ Handler │
                  └──┬───┬──┘  └─────────┘   └─────────┘
                     │   │
              ┌──────┘   └──────┐
              │                 │
        ┌─────┴─────┐   ┌──────┴──────┐
        │ PostgreSQL │   │    Redis    │
        │   :5432    │   │   :6379     │
        └───────────┘    └─────────────┘
                     │
           ┌─────────┴─────────┐
           │  Docker Containers │
           │ (megh-agent:latest)│
           │ Claude CLI + tools │
           └────────────────────┘
```

| Service | Port | Description |
|---------|------|-------------|
| **web** | 3001 | Next.js 15 frontend — dashboard, terminal, billing UI |
| **api** | 3000 | Express server — REST API, WebSocket terminal, session lifecycle |
| **proxy** | 8787 | Usage metering proxy for API-key-based Claude requests |
| **postgres** | 5432 | User accounts, sessions, billing, usage events |
| **redis** | 6379 | Session TTL tracking, port allocation, caching |
| **nginx** | 80 | Reverse proxy, WebSocket upgrade, port preview routing |

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2
- An [Anthropic API key](https://console.anthropic.com/) **or** Claude Code OAuth token
- 4 GB+ RAM available for Docker

### 1. Clone the repository

```bash
git clone https://github.com/callmescine/megh.git
cd megh
```

### 2. Configure

```bash
cp config.example.yaml config.yaml
```

Open `config.yaml` and set these required values:

```yaml
llm:
  api_key: "sk-ant-..."            # Your Anthropic API key

auth:
  jwt_secret: "your-random-secret" # Random string for JWT signing

database:
  password: "a-secure-password"    # PostgreSQL password
```

> **OAuth alternative:** If you have a Claude Code OAuth token, set the `MEGH_OAUTH_TOKEN` environment variable instead of `llm.api_key`. OAuth containers talk directly to Anthropic without the usage proxy.

### 3. Build and launch

**Option A — Setup script (recommended):**

```bash
chmod +x setup.sh
./setup.sh
```

**Option B — Manual:**

```bash
# Build the agent container image
docker build -t megh-agent:latest ./containers/

# Create the isolated container network
docker network create megh_containers 2>/dev/null || true

# Start all services
docker compose up -d
```

### 4. Access the platform

Once services are healthy:

| URL | Description |
|-----|-------------|
| http://localhost | Web UI (via nginx) |
| http://localhost:3000/api/docs | API documentation |

Register an account, and you're ready to launch your first session. New accounts start with **$2.00 trial credits**.

## How It Works

### Session Lifecycle

1. **Create** — User requests a session. API checks balance, enforces concurrency limits, and spins up an isolated Docker container with resource caps.
2. **Active** — User interacts via browser terminal (xterm.js over WebSocket). Files can be uploaded/downloaded. Dev server ports are exposed as preview URLs.
3. **Billing** — Session time is tracked and billed at the configured rate (default $0.50/hour). Balance is deducted when the session ends.
4. **Expiring** — When TTL expires, the container is stopped and the session enters a grace period.
5. **Grace** — User has 15 minutes (configurable) to download their workspace.
6. **Destroyed** — Container and all data are permanently removed.

### Security

- Containers run with `CAP_DROP ALL` and `no-new-privileges`
- Only minimal capabilities added back (`CHOWN`, `SETUID`, `SETGID`, `DAC_OVERRIDE`, `FOWNER`)
- Containers run on an isolated Docker network (`megh_containers`)
- File uploads validated for path traversal, symlink escape, size limits, and file count
- The operator's API key never enters the container — the proxy injects it on the way out
- JWT auth with bcrypt password hashing, CSRF protection, and httpOnly refresh tokens
- Advisory locks prevent race conditions in concurrent session creation

## Configuration

All configuration lives in `config.yaml`. See [`config.example.yaml`](config.example.yaml) for the full reference with comments.

### Key settings

| Setting | Default | Description |
|---------|---------|-------------|
| `llm.api_key` | — | Anthropic API key |
| `containers.image` | `megh-agent:latest` | Docker image for agent containers |
| `containers.memory` | `2g` | Memory limit per container |
| `containers.cpu` | `1` | CPU cores per container |
| `containers.max_concurrent` | `3` | Max sessions per user |
| `containers.max_global_sessions` | `20` | Max sessions platform-wide |
| `containers.ttl_default` | `120` | Session TTL in minutes |
| `containers.grace_period` | `15` | Grace period before destruction (minutes) |
| `containers.min_balance` | `0.50` | Minimum USD balance to start a session |
| `billing.trial_credits` | `2.00` | Credits for new accounts |

### Environment variables

Set these in your shell or a `.env` file alongside `docker-compose.yml`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PASSWORD` | No | PostgreSQL password (default: `changeme`) |
| `MEGH_JWT_SECRET` | Yes | JWT signing secret |
| `MEGH_LLM_API_KEY` | Yes* | Anthropic API key |
| `MEGH_OAUTH_TOKEN` | Yes* | Claude Code OAuth token (alternative to API key) |
| `MEGH_STRIPE_SECRET_KEY` | No | Stripe secret key for payments |
| `MEGH_STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |

*One of `MEGH_LLM_API_KEY` or `MEGH_OAUTH_TOKEN` is required.

## Project Structure

```
megh/
├── server/                  # Express API server
│   └── src/
│       ├── auth/            # JWT authentication & middleware
│       ├── billing/         # Usage tracking, balance, pricing
│       ├── sessions/        # Session lifecycle & container management
│       ├── terminal/        # WebSocket terminal handler
│       ├── uploads/         # File upload/download (tar streaming)
│       ├── admin/           # Admin API routes
│       ├── jobs/            # Scheduled tasks (reaper, sync, invoicing)
│       └── db/              # PostgreSQL & Redis connections
├── web/                     # Next.js 15 frontend
│   ├── app/                 # App router pages
│   ├── components/          # React components (terminal, cards, UI)
│   └── lib/                 # API client, auth hooks, WebSocket manager
├── proxy/                   # Usage metering proxy
│   └── src/
│       └── usage-proxy.ts   # Intercepts Claude API calls for billing
├── containers/              # Agent container image
│   ├── Dockerfile           # Ubuntu 24.04 + Node.js 22 + Claude CLI
│   ├── entrypoint.sh        # Container init (OAuth validation, config)
│   └── templates/           # Alternative container images
├── nginx/                   # Reverse proxy config
│   ├── nginx.conf           # Main config with WebSocket & preview routing
│   └── preview.conf         # Session port preview routing
├── config.example.yaml      # Configuration template
├── docker-compose.yml       # Production compose file
├── docker-compose.dev.yml   # Development overrides
└── setup.sh                 # One-command setup script
```

## Deployment

### Self-hosted on any machine

Megh runs anywhere Docker runs — a laptop, home server, VPS, or cloud instance.

#### With Cloudflare Tunnel (no port forwarding needed)

```bash
# Install cloudflared
brew install cloudflared   # macOS
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Create and configure a tunnel
cloudflared tunnel create megh
cloudflared tunnel route dns megh your-domain.com

# Create ~/.cloudflared/config.yml:
# tunnel: <tunnel-id>
# credentials-file: ~/.cloudflared/<tunnel-id>.json
# ingress:
#   - hostname: your-domain.com
#     service: http://localhost:80
#   - service: http_status:404

# Run the tunnel
cloudflared tunnel run megh
```

#### With a VPS + SSL

Point your domain to your server IP, then:

```bash
sudo certbot certonly --standalone -d your-domain.com
# Update nginx/nginx.conf to listen on 443 with your certs
```

### Development mode

```bash
npm install
npm run dev    # Starts API, proxy, and Next.js concurrently with hot reload
```

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login, returns JWT |
| `POST` | `/api/auth/refresh` | Refresh JWT token |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/me` | Current user profile + balance |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions` | Launch a new session |
| `GET` | `/api/sessions` | List user's sessions (paginated) |
| `GET` | `/api/sessions/:id` | Session details |
| `DELETE` | `/api/sessions/:id` | End a session |
| `POST` | `/api/sessions/:id/upload` | Upload file to container |
| `GET` | `/api/sessions/:id/download` | Download workspace as tar.gz |

### Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/billing/balance` | Balance + monthly usage |
| `GET` | `/api/billing/usage` | Paginated usage history |
| `GET` | `/api/billing/usage/:sessionId` | Per-session usage breakdown |
| `POST` | `/api/billing/topup` | Create Stripe checkout session |
| `GET` | `/api/billing/invoices` | List invoices |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws?ticket={ticket}` | Terminal connection (get ticket via `POST /api/auth/ws-ticket`) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | API + DB + Redis health check |
| `GET` | `/api/health/live` | Simple liveness probe |

Full OpenAPI docs available at `/api/docs` when the server is running.

## Background Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Session Reaper | Every 5 min | Ends expired sessions, destroys grace-period sessions |
| Usage Sync | Hourly | Flushes Redis balance cache to PostgreSQL |
| Invoice Generator | 1st of month | Creates Stripe invoices for postpaid users |

## Container Templates

The default agent image (`containers/Dockerfile`) includes Ubuntu 24.04, Node.js 22, Python 3, Git, and Claude CLI. Alternative Dockerfiles in `containers/templates/`:

- **`Dockerfile.minimal`** — Alpine + Claude CLI only (smallest image)
- **`Dockerfile.node`** — Node.js focused with pnpm and yarn
- **`Dockerfile.python`** — Python focused with pip and venv

Build an alternative: `docker build -t megh-agent:latest -f containers/templates/Dockerfile.node ./containers/`

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

```bash
# Fork and clone the repo
git clone https://github.com/your-username/megh.git
cd megh

# Create a feature branch
git checkout -b feature/amazing-feature

# Make your changes, then
git commit -m "Add amazing feature"
git push origin feature/amazing-feature
# Open a pull request on GitHub
```

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built & maintained by <a href="https://www.linkedin.com/in/nitin-mamidala-891a69299/">Nitin Mamidala</a>
</p>
