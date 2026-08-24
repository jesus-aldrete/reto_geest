# syntax=docker/dockerfile:1

# ---- build ------------------------------------------------------------------
# better-sqlite3 es un módulo nativo: la etapa de build trae el toolchain para
# compilarlo si no hay binario precompilado para la plataforma destino.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Se descartan las dependencias de desarrollo conservando el binario nativo ya compilado.
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/geest.db

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
# Las migraciones se aplican al arrancar, así que viajan con la imagen.
COPY db ./db

# Directorio del volumen persistente donde vive el fichero SQLite.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
