# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
# No VITE_API_URL build arg — URL is injected at runtime via window._env.
# The fallback in client.ts (http://localhost:8000/api/v1) is only used in
# local npm-run-dev mode; the Docker prod container always has API_URL set.
RUN npm run build

# ── Stage 2: serve (prod) — runtime API_URL via env.js substitution ────────────
FROM nginx:alpine AS prod
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
# SPA routing: all paths fall back to index.html
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]

# ── Stage 3: dev (Vite HMR) ────────────────────────────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
