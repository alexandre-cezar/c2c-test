# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
# Use npm install (no lockfile committed in this scaffold)
RUN npm install

COPY . .
RUN npm run build

# ---- Runtime stage (non-root nginx) ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Custom server config (listens on 8080, SPA fallback, healthz)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static assets from the build
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
