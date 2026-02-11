# SmartEnrich — Guia de Deployment en Produccion

## Documento Tecnico de Deployment (Actualizado)

**Tienda:** smart.cr (Smart Costa Rica)
**Partner ID:** 133857750
**App ID:** 320621740033
**VPS:** Hostinger KVM 4 — 147.93.43.70
**Orquestador:** Docker Swarm + Portainer (panel.automasc.com)
**Dominio app:** smartenrich.automasc.com
**Fecha:** Febrero 2026

---

## 1. Infraestructura Actual

### VPS Hostinger (KVM 4)

| Recurso | Valor | Uso Actual |
|---|---|---|
| CPU | 4 cores | ~25% con SmartEnrich |
| RAM | 16 GB | ~70% (10.9 GB base + 2-3 GB SmartEnrich) |
| Disco | 200 GB | 82 GB usados + ~1 GB SmartEnrich |
| OS | Ubuntu 22.04 LTS | — |
| IP | 147.93.43.70 | — |

### Servicios Docker Existentes Reutilizados

| Servicio | Red Docker | Uso en SmartEnrich |
|---|---|---|
| **postgres** | CFNet | BD `smartenrich` (Prisma ORM) |
| **redis** (redis_redis) | CFNet | BullMQ queue (DB index 3) + cache |
| **traefik** | CFNet | Reverse proxy + SSL (smartenrich.automasc.com) |
| **minio** | CFNet | Cache de imagenes (bucket smartenrich-images) |
| **portainer** | — | Gestion de stacks y servicios |
| **pgadmin** | — | Administracion de BD |
| **n8n** | CFNet | Opcional: trigger externo y notificaciones |

---

## 2. Servicios de SmartEnrich

SmartEnrich se compone de **2 servicios** en un solo stack:

### smartenrich_app (Servidor Web Remix)
- Sirve la UI embebida en Shopify Admin
- Maneja autenticacion OAuth (token exchange)
- Recibe webhooks de Shopify
- Endpoints API (trigger manual, health check, approve/reject)
- Puerto: 3100
- Recursos: 1 CPU, 1024 MB RAM

### smartenrich_worker (Worker BullMQ)
- Procesa la cola de enriquecimiento
- Ejecuta el pipeline de 6 pasos
- Cron diario integrado (BullMQ repeatable jobs, default 2:00 AM)
- Usa fetch nativo de Node.js 20 para Shopify API (worker-admin.server.ts)
- No expone puertos
- Recursos: 1.5 CPU, 2048 MB RAM

**Ambos comparten la misma imagen Docker** (`smartenrich:latest`), diferenciados por el comando:
- app: `npm run docker-start`
- worker: `npm run worker`

---

## 3. Archivos de Configuracion

### docker-compose.yml (actual)

```yaml
version: "3.8"

services:
  app:
    image: smartenrich:latest
    command: ["npm", "run", "docker-start"]
    env_file: .env
    ports:
      - "3100:3100"
    networks:
      - CFNet
    deploy:
      mode: replicated
      replicas: 1
      labels:
        - "traefik.enable=true"
        - "traefik.docker.network=CFNet"
        - "traefik.http.routers.smartenrich.rule=Host(`smartenrich.automasc.com`)"
        - "traefik.http.routers.smartenrich.entrypoints=websecure"
        - "traefik.http.routers.smartenrich.tls.certresolver=letsencryptresolver"
        - "traefik.http.services.smartenrich.loadbalancer.server.port=3100"
      resources:
        limits:
          cpus: "1.0"
          memory: 1024M
    volumes:
      - smartenrich-data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: smartenrich:latest
    command: ["npm", "run", "worker"]
    env_file: .env
    networks:
      - CFNet
    deploy:
      mode: replicated
      replicas: 1
      resources:
        limits:
          cpus: "1.5"
          memory: 2048M

networks:
  CFNet:
    external: true

volumes:
  smartenrich-data:
    driver: local
```

### Dockerfile (multi-stage build)

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --production=false

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl openssl
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/app ./app
COPY --from=builder /app/config ./config
RUN addgroup -g 1001 -S nodejs && adduser -S smartenrich -u 1001 -G nodejs
USER smartenrich
EXPOSE 3100
CMD ["npm", "run", "docker-start"]
```

Nota: El worker copia `app/` completo porque `tsx worker/index.ts` importa modulos de `app/services/` en runtime.

---

## 4. Variables de Entorno (.env en VPS)

Ubicacion: `/opt/smartenrich/.env`

```bash
# --- Shopify ---
SHOPIFY_API_KEY=843e50d69ee4605a8927ffd8a387f09c
SHOPIFY_API_SECRET=shpss_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SHOPIFY_APP_URL=https://smartenrich.automasc.com
SCOPES=read_products,write_products,read_product_listings,read_inventory

# --- Database ---
DATABASE_URL=postgresql://smartenrich:PASSWORD@postgres_postgres:5432/smartenrich

# --- Redis (DB index 3, no interferir con otros servicios) ---
REDIS_URL=redis://redis_redis:6379/3

# --- Google Gemini AI ---
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
GEMINI_MODEL=gemini-2.5-flash-lite

# --- Busqueda Web (Serper.dev primario, SerpAPI fallback) ---
SERPER_API_KEY=                # Primario: https://serper.dev (2500 gratis, luego $50/50000)
SERPAPI_KEY=                   # Fallback: https://serpapi.com ($50/mes 5000 busquedas)

# --- MinIO ---
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=smartenrich-images

# --- App ---
NODE_ENV=production
PORT=3100
SESSION_SECRET=generar_con_openssl_rand_hex_32
INTERNAL_API_KEY=generar_con_openssl_rand_hex_32

# --- Worker ---
WORKER_CONCURRENCY=3
CRON_ENABLED=true
CRON_SCHEDULE=0 2 * * *
MAX_PRODUCTS_PER_RUN=50
```

**IMPORTANTE sobre hostnames de Docker Swarm:**
- PostgreSQL: `postgres_postgres` (stack_service)
- Redis: `redis_redis`
- MinIO: `minio` o `minio_minio`
- Verificar con `docker service ls` los nombres exactos

---

## 5. Procedimiento de Deploy (Paso a Paso)

### Deploy Inicial (primera vez)

```bash
# 1. SSH al VPS
ssh root@147.93.43.70

# 2. Clonar repositorio
cd /opt
git clone https://github.com/sistemasconsultores/smartproductos.git smartenrich
cd smartenrich
git checkout claude/analyze-project-ncZEk

# 3. Crear .env
cp .env.example .env
nano .env  # Configurar todas las variables

# 4. Crear BD en PostgreSQL
docker exec -it $(docker ps -q -f name=postgres_postgres) psql -U postgres
# En psql:
CREATE USER smartenrich WITH PASSWORD 'tu_password';
CREATE DATABASE smartenrich OWNER smartenrich;
GRANT ALL PRIVILEGES ON DATABASE smartenrich TO smartenrich;
\q

# 5. Build de la imagen
docker build -t smartenrich:latest .

# 6. Deploy como stack en Portainer
# Opcion A: Via Portainer UI (panel.automasc.com) -> Stacks -> Add Stack
# Opcion B: Via CLI:
docker stack deploy -c docker-compose.yml smartenrich

# 7. Ejecutar migrations
docker exec $(docker ps -q -f name=smartenrich_app) npx prisma migrate deploy

# 8. Verificar que esta corriendo
docker service ls | grep smartenrich
docker service logs smartenrich_app --tail 20
docker service logs smartenrich_worker --tail 20

# 9. Instalar app en la tienda
# Ir a Shopify Partners -> Apps -> SmartEnrich -> Test on store
# Seleccionar smartcostarica.myshopify.com y autorizar
```

### Actualizaciones (deploys subsiguientes)

```bash
# 1. Pull cambios
cd /opt/smartenrich
git pull origin claude/analyze-project-ncZEk

# 2. Rebuild
docker build -t smartenrich:latest .

# 3. Actualizar servicios
docker service update --image smartenrich:latest smartenrich_app
docker service update --image smartenrich:latest smartenrich_worker

# 4. (Opcional) Limpiar jobs viejos de Redis
docker exec $(docker ps -q -f name=redis_redis) redis-cli -n 3 FLUSHDB

# 5. (Si hay cambios en schema) Migrar BD
docker exec $(docker ps -q -f name=smartenrich_app) npx prisma migrate deploy

# 6. Verificar logs
docker service logs smartenrich_worker --tail 50 -f
```

---

## 6. DNS

Record A en el proveedor DNS (Hostinger o Cloudflare):

```
A    smartenrich.automasc.com    147.93.43.70
```

Traefik se encarga del SSL automatico via Let's Encrypt usando las labels del docker-compose.

---

## 7. Monitoreo y Operacion

### Ver logs en tiempo real
```bash
docker service logs smartenrich_worker --tail 100 -f   # Worker/pipeline
docker service logs smartenrich_app --tail 100 -f       # App/UI
```

### Health check
```
GET https://smartenrich.automasc.com/api/health
```

### Trigger manual de enriquecimiento
Desde la UI embebida en Shopify Admin, boton "Ejecutar Ahora" en el Dashboard.
O via API:
```bash
curl -X POST https://smartenrich.automasc.com/api/enrich \
  -H "X-API-Key: $INTERNAL_API_KEY"
```

### Limpiar Redis (jobs viejos)
```bash
docker exec $(docker ps -q -f name=redis_redis) redis-cli -n 3 FLUSHDB
```

### Consultar estado de la BD
```bash
docker exec $(docker ps -q -f name=smartenrich_app) npx prisma studio
# O via pgAdmin en panel.automasc.com
```

### Queries utiles de BD
```sql
-- Contar logs por status
SELECT status, COUNT(*) FROM "EnrichmentLog" GROUP BY status;

-- Ultimas ejecuciones
SELECT id, status, "triggeredBy", "totalProducts", "enrichedCount",
       "failedCount", "skippedCount", "startedAt"
FROM "EnrichmentRun" ORDER BY "startedAt" DESC LIMIT 10;

-- Limpiar logs duplicados (resetear para re-procesar)
DELETE FROM "EnrichmentLog" WHERE status IN ('PENDING', 'FAILED');
```

### Reiniciar servicios
```bash
docker service update --force smartenrich_worker
docker service update --force smartenrich_app
```

---

## 8. Resolucion de Problemas Comunes

### Error: abstractFetch
**Causa**: El worker no tiene el adapter de Node.js para el SDK de Shopify.
**Solucion**: `worker/index.ts` debe tener `import "@shopify/shopify-app-remix/adapters/node"` como primer import.

### Error: Serper 401/403
**Causa**: API key invalida o creditos agotados.
**Verificar**:
1. https://serper.dev/api-keys - verificar que la key es correcta
2. https://serper.dev/dashboard - verificar creditos disponibles
3. Los logs del worker muestran el body exacto del error

### Productos no se procesan (0 new to process)
**Causa**: Ya existen logs APPLIED o PENDING para esos productos.
**Solucion**: Limpiar logs en BD:
```sql
DELETE FROM "EnrichmentLog" WHERE status = 'PENDING';
```
O cambiar status a FAILED para que se re-procesen.

### Worker no arranca
**Verificar**:
1. `docker service ls` - replica count debe ser 1/1
2. `docker service ps smartenrich_worker` - ver si hay errores de scheduling
3. Verificar que Redis y PostgreSQL estan accesibles en la red CFNet

### Auto-apply no funciona
**Verificar**:
1. El worker fuerza `autoApply = true` (hardcoded en enrichment.worker.server.ts)
2. El threshold es `minConfidenceScore` (default 0.5)
3. Gemini puede retornar confidence como string: se parsea con `Number()`
4. Revisar logs: `[pipeline] Product "..." - autoApply: true, confidence: X`

---

## 9. Costos Mensuales Estimados

| Servicio | Plan | Costo |
|---|---|---|
| VPS Hostinger (KVM 4) | Ya pagado | $0 adicional |
| Google Gemini 2.5 Flash | Paid tier (~$2/mes uso actual) | ~$2-5/mes |
| Serper.dev | 2,500 gratis, luego $50/50,000 | $0-50/mes |
| SerpAPI (fallback) | 100 gratis/mes, luego $50/5,000 | $0-50/mes |
| **Total** | | **$2-55/mes** |

Para ~100 productos activos procesados 1x/dia, los tiers gratuitos son suficientes.

---

## 10. Arquitectura de Red Docker

```
Red CFNet (overlay, externa)
|
+-- traefik           (reverse proxy, SSL)
+-- postgres_postgres (PostgreSQL)
+-- redis_redis       (Redis)
+-- minio             (MinIO storage)
+-- smartenrich_app   (Remix server, port 3100)
+-- smartenrich_worker (BullMQ worker, no port)
+-- n8n               (workflow automation)
+-- pgadmin           (DB admin)
+-- otros stacks...
```

Todos los servicios de SmartEnrich usan la red `CFNet` (external) para comunicarse con los servicios existentes.
