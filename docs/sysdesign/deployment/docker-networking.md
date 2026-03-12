# Docker Networking — Knotwork + OpenClaw

## Problem

When both Knotwork and OpenClaw run as separate Docker Compose projects, they
are each placed on their own isolated bridge network by default
(`knotwork_default`, `openclaw_default`). Containers on different networks
cannot reach each other by hostname.

This means the Knotwork Bridge plugin inside OpenClaw cannot call
`http://host.docker.internal:8000` to reach the Knotwork backend — that
hostname only resolves correctly when making calls *to* the Docker host machine,
not when the target service is itself inside Docker. The result is a silent
`fetch failed` on every plugin handshake attempt.

## Solution — shared `knotwork-network`

Both compose projects declare the same named bridge network. Knotwork **owns**
the network (creates it); OpenClaw joins it as an **external** reference.

```
┌─────────────────────────────────────────────────────┐
│                  knotwork-network                   │
│                                                     │
│  knotwork-backend-dev-1  ←──────────────────────┐  │
│    aliases: backend-dev                          │  │
│             knotwork-backend                     │  │
│                                                  │  │
│  knotwork-postgres-1                             │  │
│  knotwork-redis-1                                │  │
│  knotwork-frontend-dev-1                         │  │
│                                                  │  │
│  openclaw-openclaw-gateway-1  ───────────────────┘  │
│    (Knotwork Bridge plugin runs here)               │
└─────────────────────────────────────────────────────┘
```

### Knotwork `docker-compose.yml`

A top-level `networks` block creates the network with a fixed name:

```yaml
networks:
  knotwork-network:
    name: knotwork-network   # explicit name, not the auto-generated default
```

Each service is assigned to this network. The backend services carry **two
aliases** so the plugin can use either name interchangeably:

```yaml
services:
  backend-dev:
    networks:
      knotwork-network:
        aliases:
          - backend-dev       # the compose service name
          - knotwork-backend  # stable alias independent of profile
```

Both `backend` (prod) and `backend-dev` (dev) expose the alias `knotwork-backend`,
so the plugin URL `http://knotwork-backend:8000` works regardless of which
profile is active.

### OpenClaw `docker-compose.yml`

The network is declared as `external: true` — OpenClaw does not create it, it
only joins:

```yaml
networks:
  knotwork-network:
    name: knotwork-network
    external: true

services:
  openclaw-gateway:
    networks:
      - knotwork-network
  openclaw-cli:
    networks:
      - knotwork-network
```

## Startup order

Knotwork **must be started first** so the network exists before OpenClaw tries
to join it:

```bash
# 1. Start Knotwork (creates knotwork-network)
cd ~/Work/crea8r/knotwork
docker compose --profile dev up -d

# 2. Start OpenClaw (joins knotwork-network)
cd ~/Work/openclaw
docker compose up -d
```

If OpenClaw starts before Knotwork, `docker compose up` will fail with:
> `network knotwork-network declared as external, but could not be found`

## Plugin configuration

With the shared network in place, set the Knotwork Bridge plugin's
`knotworkBaseUrl` to the backend's service alias, **not** `host.docker.internal`
or `localhost`:

| Scenario | `knotworkBaseUrl` |
|---|---|
| Both in Docker (this setup) | `http://knotwork-backend:8000` |
| Knotwork in Docker, OpenClaw on host | `http://localhost:8000` |
| Both on host (dev without Docker) | `http://localhost:8000` |

In OpenClaw settings, set the plugin config and then trigger a fresh handshake:

```
openclaw gateway call knotwork.handshake {
  "knotworkBaseUrl": "http://knotwork-backend:8000",
  "handshakeToken": "<token from Knotwork Settings > Agents>"
}
```

Confirm it worked:

```
openclaw gateway call knotwork.status
# expect: lastHandshakeOk: true, integrationSecret: "...xxxx"
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `fetch failed` on handshake | Wrong `knotworkBaseUrl` or network not shared | Verify URL; check `docker network inspect knotwork-network` shows both containers |
| `network knotwork-network … not found` on OpenClaw start | Knotwork not running | Start Knotwork first |
| Plugin status shows `integrationSecret: null` | Handshake never succeeded | Run `knotwork.handshake` RPC manually |
| Tasks stuck as `pending` | Plugin `busy` flag or no `integrationSecret` | Restart OpenClaw or run `knotwork.handshake` |

## Verifying the network

```bash
# Both containers should appear
docker network inspect knotwork-network \
  --format '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{"\n"}}{{end}}'

# Smoke-test reachability from inside the OpenClaw container
docker exec openclaw-openclaw-gateway-1 \
  curl -s http://knotwork-backend:8000/health
```
