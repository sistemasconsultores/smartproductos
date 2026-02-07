# SmartEnrich — Arquitectura de Implementación en Infraestructura Existente

## Documento Técnico de Deployment

**Tienda:** smart.cr (Smart Costa Rica)  
**Partner ID:** 133857750  
**VPS:** Hostinger KVM 4 — 147.93.43.70  
**Orquestador:** Docker Swarm + Portainer (panel.automasc.com)  
**Fecha:** Febrero 2026

---

## 1. Infraestructura Actual Disponible

### VPS Hostinger (KVM 4)
| Recurso | Valor | Uso Actual |
|---|---|---|
| CPU | 4 cores | 18% |
| RAM | 16 GB | 68% (10.9 GB usados) |
| Disco | 200 GB | 82 GB usados (118 GB libres) |
| OS | Ubuntu 22.04 LTS | — |
| IP | 147.93.43.70 | — |
| Uptime | 68 días | Estable |

### Servicios Docker Existentes (Reutilizables)

| Stack | Estado | Uso para SmartEnrich |
|---|---|---|
| **postgres** | ✅ Running | Base de datos principal (Prisma) |
| **redis** | ✅ Running | Cola de tareas BullMQ + caché |
| **traefik** | ✅ Running (Limited) | Reverse proxy + SSL automático |
| **n8n** | ✅ Running | Alternativa para workflows/cron |
| **pgadmin** | ✅ Running | Administración de la BD |
| **minio** | ✅ Running | Almacenamiento de imágenes temporales |
| **pgvector** | ✅ Running | Búsqueda semántica (futuro) |
| **qdrant** | ✅ Running | Vector search (futuro) |
| **portainer** | ✅ Running | Gestión de contenedores |

**Resultado:** No necesitamos levantar PostgreSQL ni Redis desde cero — ya existen y están corriendo.

---

## 2. Arquitectura de Deployment Actualizada

```
                         Internet
                            │
                            ▼
                    ┌───────────────┐
                    │   Traefik     │  (Ya existente)
                    │  Reverse Proxy│  SSL auto con Let's Encrypt
                    │  *.automasc.com│
                    └───────┬───────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
              ▼             ▼              ▼
    ┌─────────────┐  ┌──────────┐  ┌──────────────┐
    │ SmartEnrich  │  │ n8n      │  │ Otros stacks │
    │ App (Remix)  │  │ (cron    │  │ (chatwoot,   │
    │ Port: 3100   │  │  trigger)│  │  ichat, etc) │
    └──────┬──────┘  └────┬─────┘  └──────────────┘
           │              │
           │    ┌─────────┘
           │    │
           ▼    ▼
    ┌──────────────────────────────────────┐
    │         Docker Network: smartenrich  │
    │                                      │
    │  ┌────────────┐  ┌────────────────┐  │
    │  │ PostgreSQL  │  │ Redis          │  │
    │  │ (existente) │  │ (existente)    │  │
    │  │ DB: enrich  │  │ Queue: bullmq  │  │
    │  └────────────┘  └────────────────┘  │
    │                                      │
    │  ┌────────────┐  ┌────────────────┐  │
    │  │ MinIO       │  │ SmartEnrich    │  │
    │  │ (existente) │  │ Worker         │  │
    │  │ img cache   │  │ (BullMQ)       │  │
    │  └────────────┘  └────────────────┘  │
    └──────────────────────────────────────┘
           │              │            │
           ▼              ▼            ▼
    ┌──────────┐  ┌──────────┐  ┌──────────────┐
    │ Shopify  │  │ Google   │  │ Barcode APIs │
    │ Admin API│  │ Gemini   │  │ Go-UPC, etc  │
    └──────────┘  └──────────┘  └──────────────┘
```

---

## 3. Diseño de Contenedores

SmartEnrich se compone de **2 servicios** en un solo stack de Docker:

### 3.1 `smartenrich-app` — Servidor Web (Remix)
- Sirve la UI embebida en Shopify Admin
- Maneja autenticación OAuth de Shopify
- Recibe webhooks
- Endpoint de API para triggers manuales
- Puerto interno: 3100

### 3.2 `smartenrich-worker` — Worker de Background
- Procesa la cola de BullMQ
- Ejecuta el pipeline de enriquecimiento
- Consulta APIs externas (Gemini, Barcode, etc.)
- Se conecta a la misma DB y Redis
- No expone puertos

**Ambos comparten el mismo código** (misma imagen Docker), pero se ejecutan con comandos diferentes.

---

## 4. Docker Compose / Stack para Portainer

```yaml
# docker-compose.smartenrich.yml
# Deploy como Stack en Portainer

version: "3.8"

services:
  # ═══════════════════════════════════════
  # Servicio Web (Remix App - Shopify Embedded)
  # ═══════════════════════════════════════
  app:
    image: smartenrich:latest
    build:
      context: .
      dockerfile: Dockerfile
    command: ["npm", "run", "start"]
    environment:
      # ─── Shopify ───
      SHOPIFY_API_KEY: "${SHOPIFY_API_KEY}"
      SHOPIFY_API_SECRET: "${SHOPIFY_API_SECRET}"
      SHOPIFY_APP_URL: "https://smartenrich.automasc.com"
      SCOPES: "read_products,write_products,read_product_listings,read_inventory"
      
      # ─── Base de datos (PostgreSQL existente) ───
      DATABASE_URL: "postgresql://smartenrich:${DB_PASSWORD}@postgres:5432/smartenrich"
      
      # ─── Redis (existente) ───
      REDIS_URL: "redis://redis:6379/2"  # Usar DB 2 para no interferir con otros
      
      # ─── Google Gemini ───
      GEMINI_API_KEY: "${GEMINI_API_KEY}"
      GEMINI_MODEL: "gemini-2.5-flash"
      
      # ─── APIs de Barcode ───
      GO_UPC_API_KEY: "${GO_UPC_API_KEY}"
      BARCODE_LOOKUP_API_KEY: "${BARCODE_LOOKUP_API_KEY}"
      
      # ─── Google Custom Search ───
      GOOGLE_SEARCH_API_KEY: "${GOOGLE_SEARCH_API_KEY}"
      GOOGLE_SEARCH_CX: "${GOOGLE_SEARCH_CX}"
      
      # ─── MinIO (para caché de imágenes) ───
      MINIO_ENDPOINT: "minio"
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: "${MINIO_ACCESS_KEY}"
      MINIO_SECRET_KEY: "${MINIO_SECRET_KEY}"
      MINIO_BUCKET: "smartenrich-images"
      
      # ─── App Config ───
      NODE_ENV: "production"
      PORT: "3100"
      SESSION_SECRET: "${SESSION_SECRET}"
      
    ports:
      - "3100:3100"
    networks:
      - smartenrich
      - traefik-public   # Para que Traefik pueda enrutar
    deploy:
      mode: replicated
      replicas: 1
      labels:
        # ─── Traefik Labels (Reverse Proxy + SSL) ───
        - "traefik.enable=true"
        - "traefik.http.routers.smartenrich.rule=Host(`smartenrich.automasc.com`)"
        - "traefik.http.routers.smartenrich.entrypoints=websecure"
        - "traefik.http.routers.smartenrich.tls.certresolver=letsencrypt"
        - "traefik.http.services.smartenrich.loadbalancer.server.port=3100"
      resources:
        limits:
          cpus: "1.0"
          memory: 1024M
        reservations:
          cpus: "0.25"
          memory: 256M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
    volumes:
      - smartenrich-data:/app/data
    depends_on:
      - worker
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ═══════════════════════════════════════
  # Worker de Background (BullMQ)
  # ═══════════════════════════════════════
  worker:
    image: smartenrich:latest
    build:
      context: .
      dockerfile: Dockerfile
    command: ["npm", "run", "worker"]
    environment:
      # Mismas variables que el app (comparten config)
      DATABASE_URL: "postgresql://smartenrich:${DB_PASSWORD}@postgres:5432/smartenrich"
      REDIS_URL: "redis://redis:6379/2"
      GEMINI_API_KEY: "${GEMINI_API_KEY}"
      GEMINI_MODEL: "gemini-2.5-flash"
      GO_UPC_API_KEY: "${GO_UPC_API_KEY}"
      BARCODE_LOOKUP_API_KEY: "${BARCODE_LOOKUP_API_KEY}"
      GOOGLE_SEARCH_API_KEY: "${GOOGLE_SEARCH_API_KEY}"
      GOOGLE_SEARCH_CX: "${GOOGLE_SEARCH_CX}"
      MINIO_ENDPOINT: "minio"
      MINIO_PORT: "9000"
      MINIO_ACCESS_KEY: "${MINIO_ACCESS_KEY}"
      MINIO_SECRET_KEY: "${MINIO_SECRET_KEY}"
      MINIO_BUCKET: "smartenrich-images"
      NODE_ENV: "production"
      
      # ─── Worker-specific ───
      WORKER_CONCURRENCY: "3"           # Procesar 3 productos en paralelo
      CRON_ENABLED: "true"
      CRON_SCHEDULE: "0 2 * * *"        # 2:00 AM todos los días (hora del servidor)
      MAX_PRODUCTS_PER_RUN: "50"
      
    networks:
      - smartenrich
    deploy:
      mode: replicated
      replicas: 1
      resources:
        limits:
          cpus: "1.5"        # Más CPU para el worker (procesa IA)
          memory: 2048M
        reservations:
          cpus: "0.5"
          memory: 512M
      restart_policy:
        condition: on-failure
        delay: 10s
        max_attempts: 3
    volumes:
      - smartenrich-data:/app/data

  # ═══════════════════════════════════════
  # BullMQ Dashboard (Arena o Bull Board)
  # ═══════════════════════════════════════
  bull-board:
    image: node:20-alpine
    command: ["npx", "@bull-board/docker", "-r", "redis://redis:6379/2"]
    environment:
      PORT: "3101"
      REDIS_HOST: "redis"
      REDIS_PORT: "6379"
      REDIS_DB: "2"
    ports:
      - "3101:3101"
    networks:
      - smartenrich
      - traefik-public
    deploy:
      mode: replicated
      replicas: 1
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.bullboard.rule=Host(`bullboard.automasc.com`)"
        - "traefik.http.routers.bullboard.entrypoints=websecure"
        - "traefik.http.routers.bullboard.tls.certresolver=letsencrypt"
        - "traefik.http.services.bullboard.loadbalancer.server.port=3101"
        # Basic auth para proteger
        - "traefik.http.routers.bullboard.middlewares=bullboard-auth"
        - "traefik.http.middlewares.bullboard-auth.basicauth.users=${BULL_BOARD_AUTH}"
      resources:
        limits:
          cpus: "0.25"
          memory: 256M

# ═══════════════════════════════════════
# Redes
# ═══════════════════════════════════════
networks:
  smartenrich:
    driver: overlay
  traefik-public:
    external: true    # Red de Traefik ya existente
  # Nota: Las redes de postgres y redis se conectan via networks externas
  # o se referencian como servicios externos

# ═══════════════════════════════════════
# Volúmenes
# ═══════════════════════════════════════
volumes:
  smartenrich-data:
    driver: local
```

---

## 5. Dockerfile

```dockerfile
# ═══════════════════════════════════════
# SmartEnrich - Shopify App
# Multi-stage build para producción
# ═══════════════════════════════════════

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --production=false

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generar Prisma client
RUN npx prisma generate

# Build de Remix
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Instalar curl para healthcheck
RUN apk add --no-cache curl

# Copiar solo lo necesario
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public

# Worker script
COPY --from=builder /app/worker ./worker

# Crear usuario non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S smartenrich -u 1001 -G nodejs
USER smartenrich

EXPOSE 3100

# El comando se overridea en docker-compose
# App: npm run start
# Worker: npm run worker
CMD ["npm", "run", "start"]
```

---

## 6. Configuración de Traefik (Actualizar)

Si tu Traefik actual maneja el dominio `automasc.com`, necesitás agregar el subdominio `smartenrich.automasc.com` en tu DNS:

```
# DNS Records (en Hostinger DNS Manager)
A    smartenrich.automasc.com    147.93.43.70
A    bullboard.automasc.com      147.93.43.70
```

Las labels de Traefik en el docker-compose se encargan del resto (routing + SSL automático).

---

## 7. Configuración de PostgreSQL (Base existente)

Crear la base de datos y usuario para SmartEnrich en tu PostgreSQL existente:

```sql
-- Conectar a PostgreSQL existente (vía pgAdmin o psql)
-- URL: postgres stack en Portainer

CREATE USER smartenrich WITH PASSWORD 'tu_password_seguro_aqui';
CREATE DATABASE smartenrich OWNER smartenrich;
GRANT ALL PRIVILEGES ON DATABASE smartenrich TO smartenrich;

-- Verificar
\l  -- Lista bases de datos
\du -- Lista usuarios
```

---

## 8. Configuración de Redis (Instancia existente)

Usar **DB 2** de Redis para no interferir con n8n u otros servicios:

```
# Redis databases en uso (verificar):
# DB 0: Default (probablemente n8n, chatwoot)
# DB 1: (verificar)
# DB 2: SmartEnrich (BullMQ queues)
```

Las queues de BullMQ se crearán automáticamente en Redis DB 2.

---

## 9. Integración con n8n (Alternativa de Cron)

Tu n8n existente puede servir como trigger del cron en vez de `node-cron` interno. Esto da más flexibilidad y visibilidad:

### Workflow de n8n:

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────┐
│ Cron Trigger │────▶│ HTTP Request  │────▶│ Notification     │
│ Diario 2:00AM│     │ POST          │     │ (Email/Slack     │
│              │     │ smartenrich   │     │  con resultados) │
│              │     │ .automasc.com │     │                  │
│              │     │ /api/enrich   │     │                  │
└──────────────┘     └───────────────┘     └──────────────────┘
```

**Endpoint en SmartEnrich:**
```typescript
// app/routes/api.enrich.tsx
import { json } from "@remix-run/node";

export async function action({ request }) {
  // Verificar API key del header
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // Agregar job a la cola de BullMQ
  const enrichmentQueue = new Queue("enrichment", { connection: redis });
  await enrichmentQueue.add("daily-run", {
    shop: "smartcostarica.myshopify.com",
    triggeredBy: "n8n-cron",
    maxProducts: 50,
  });
  
  return json({ 
    status: "queued", 
    message: "Enrichment run queued successfully" 
  });
}
```

**Ventajas de usar n8n como trigger:**
- Dashboard visual del historial de ejecuciones
- Notificaciones por email/Slack/WhatsApp cuando termina
- Fácil de pausar/reprogramar sin tocar código
- Integración con Evolution API (WhatsApp) para notificar
- Retry automático si falla

---

## 10. Uso de MinIO para Caché de Imágenes

Tu MinIO existente sirve para almacenar temporalmente las imágenes encontradas antes de subirlas a Shopify:

```typescript
// services/image-cache.ts
import { Client } from "minio";

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const BUCKET = "smartenrich-images";

// Descargar imagen de internet y guardar en MinIO
async function cacheImage(imageUrl: string, productSku: string): Promise<string> {
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  
  const objectName = `${productSku}/${Date.now()}-${getFilename(imageUrl)}`;
  
  await minioClient.putObject(BUCKET, objectName, buffer, {
    "Content-Type": response.headers.get("content-type") || "image/jpeg",
  });
  
  return objectName;
}

// Obtener imagen cacheada para subir a Shopify
async function getCachedImage(objectName: string): Promise<Buffer> {
  const stream = await minioClient.getObject(BUCKET, objectName);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Limpiar imágenes viejas (> 7 días)
async function cleanupOldImages(): Promise<void> {
  const objects = minioClient.listObjects(BUCKET, "", true);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  
  for await (const obj of objects) {
    if (obj.lastModified.getTime() < cutoff) {
      await minioClient.removeObject(BUCKET, obj.name);
    }
  }
}
```

---

## 11. Estimación de Recursos

### Consumo esperado de SmartEnrich:

| Servicio | CPU | RAM | Disco |
|---|---|---|---|
| smartenrich-app | 0.25-1.0 cores | 256MB-1GB | ~500MB (código) |
| smartenrich-worker | 0.5-1.5 cores | 512MB-2GB | Mínimo |
| bull-board | 0.1-0.25 cores | 128-256MB | Mínimo |
| **Total SmartEnrich** | **~1-2.75 cores** | **~1-3.25 GB** | **~500MB** |

### Disponibilidad en tu VPS:

| Recurso | Total | En uso | SmartEnrich | Restante |
|---|---|---|---|---|
| CPU | 4 cores | 0.72 (18%) | ~1.5 cores | 1.78 cores |
| RAM | 16 GB | 10.9 GB (68%) | ~2 GB | 3.1 GB |
| Disco | 200 GB | 82 GB | ~1 GB | 117 GB |

**Veredicto:** Tu VPS tiene recursos suficientes para correr SmartEnrich sin problemas. Durante el pico de procesamiento (2 AM), el worker usará más CPU pero no debería afectar otros servicios ya que es hora de bajo tráfico.

---

## 12. Configuración de Shopify App (shopify.app.toml)

```toml
# shopify.app.toml
name = "SmartEnrich"
client_id = "TU_CLIENT_ID_DEL_PARTNER_DASHBOARD"
application_url = "https://smartenrich.automasc.com"
embedded = true

[access_scopes]
scopes = "read_products,write_products,read_product_listings,read_inventory"

[auth]
redirect_urls = [
  "https://smartenrich.automasc.com/auth/callback",
  "https://smartenrich.automasc.com/auth/shopify/callback",
  "https://smartenrich.automasc.com/api/auth/callback"
]

[webhooks]
api_version = "2025-01"

  [webhooks.subscriptions]
  # Webhook cuando se crea un producto nuevo → enriquecer automáticamente
  [[webhooks.subscriptions]]
  topics = ["products/create"]
  uri = "/webhooks"

  # Webhook cuando se actualiza un producto → verificar completitud
  [[webhooks.subscriptions]]
  topics = ["products/update"]
  uri = "/webhooks"

[pos]
embedded = false

[build]
automatically_update_urls_on_dev = true
dev_store_url = "smartcostarica.myshopify.com"
```

---

## 13. Variables de Entorno (.env)

```bash
# ═══════════════════════════════════════
# SmartEnrich Environment Variables
# ═══════════════════════════════════════

# ─── Shopify ───
SHOPIFY_API_KEY=tu_api_key_del_partner_dashboard
SHOPIFY_API_SECRET=tu_api_secret
SHOPIFY_APP_URL=https://smartenrich.automasc.com
SCOPES=read_products,write_products,read_product_listings,read_inventory

# ─── Database (PostgreSQL existente en Docker) ───
DATABASE_URL=postgresql://smartenrich:password_seguro@postgres:5432/smartenrich

# ─── Redis (existente en Docker) ───
REDIS_URL=redis://redis:6379/2

# ─── Google Gemini AI ───
GEMINI_API_KEY=tu_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# ─── APIs de Barcode Lookup ───
GO_UPC_API_KEY=tu_go_upc_key
BARCODE_LOOKUP_API_KEY=tu_barcode_lookup_key

# ─── Google Custom Search (para buscar por SKU) ───
GOOGLE_SEARCH_API_KEY=tu_google_search_key
GOOGLE_SEARCH_CX=tu_custom_search_engine_id

# ─── MinIO (existente en Docker) ───
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=tu_minio_access_key
MINIO_SECRET_KEY=tu_minio_secret_key
MINIO_BUCKET=smartenrich-images

# ─── App Security ───
SESSION_SECRET=generar_con_openssl_rand_hex_32
INTERNAL_API_KEY=generar_con_openssl_rand_hex_32

# ─── Worker Config ───
WORKER_CONCURRENCY=3
CRON_ENABLED=true
CRON_SCHEDULE=0 2 * * *
MAX_PRODUCTS_PER_RUN=50

# ─── Bull Board Auth ───
# Generar con: htpasswd -nb admin password | sed -e s/\\$/\\$\\$/g
BULL_BOARD_AUTH=admin:$$apr1$$xyz...
```

---

## 14. Pipeline de CI/CD

### Opción A: Build local + Push a Registry

```bash
# En tu máquina local o en el VPS
cd smart-enrich

# Build de la imagen
docker build -t smartenrich:latest .

# Si usas un registry privado (Docker Hub, GitHub Container Registry)
docker tag smartenrich:latest ghcr.io/tu-org/smartenrich:latest
docker push ghcr.io/tu-org/smartenrich:latest

# En Portainer: actualizar el stack con la nueva imagen
```

### Opción B: Build directo en el VPS

```bash
# SSH al VPS
ssh root@147.93.43.70

# Clonar repo
cd /opt/apps
git clone https://github.com/tu-org/smart-enrich.git
cd smart-enrich

# Build
docker build -t smartenrich:latest .

# Deploy via Portainer (Add Stack → Git Repository)
```

### Opción C: Portainer Git Integration

Portainer puede hacer pull directo de tu repositorio Git y hacer build automático:

1. En Portainer → Stacks → Add Stack
2. Seleccionar "Repository"
3. URL del repo: `https://github.com/tu-org/smart-enrich`
4. Compose path: `docker-compose.yml`
5. Environment variables: pegar las variables del .env
6. Enable automatic updates (opcional)

---

## 15. Pasos de Deployment (Paso a Paso)

### Paso 1: Crear la App en Shopify Partners
```
1. Ir a partners.shopify.com → Apps → Create App
2. Nombre: SmartEnrich
3. App URL: https://smartenrich.automasc.com
4. Redirect URL: https://smartenrich.automasc.com/auth/callback
5. Anotar: Client ID y Client Secret
```

### Paso 2: Obtener API Keys externas
```
1. Google AI Studio → Crear API key para Gemini
   https://aistudio.google.com/apikey
   
2. Go-UPC → Registrar y obtener API key
   https://go-upc.com/plans/api
   
3. Google Custom Search → Crear Search Engine
   https://programmablesearchengine.google.com/
   + Habilitar Image Search
   + Obtener API key en Google Cloud Console
```

### Paso 3: Preparar PostgreSQL
```sql
-- Via pgAdmin (ya lo tenés corriendo)
CREATE USER smartenrich WITH PASSWORD 'generar_password_seguro';
CREATE DATABASE smartenrich OWNER smartenrich;
```

### Paso 4: Preparar MinIO
```bash
# Crear bucket en MinIO
# Via MinIO Console o mc CLI
mc mb minio/smartenrich-images
mc policy set download minio/smartenrich-images
```

### Paso 5: Configurar DNS
```
# En Hostinger DNS Manager o tu proveedor DNS
A    smartenrich    147.93.43.70
A    bullboard      147.93.43.70
```

### Paso 6: Deploy en Portainer
```
1. Portainer → Stacks → Add Stack
2. Nombre: smartenrich
3. Pegar el docker-compose.yml
4. Agregar variables de entorno
5. Deploy
```

### Paso 7: Migrar Base de Datos
```bash
# Dentro del contenedor
docker exec -it smartenrich_app npx prisma migrate deploy
```

### Paso 8: Instalar en la Tienda
```
1. En Shopify Partners → App → Test on store
2. Seleccionar smartcostarica.myshopify.com
3. Autorizar permisos
4. La app aparece en el Admin de Shopify
```

### Paso 9: Configurar n8n (Cron Trigger)
```
1. En n8n → Create Workflow
2. Agregar nodo "Cron" → Schedule: 0 2 * * * (2:00 AM diario)
3. Agregar nodo "HTTP Request":
   - Method: POST
   - URL: https://smartenrich.automasc.com/api/enrich
   - Headers: X-API-Key: tu_internal_api_key
4. Agregar nodo "Send Email" o "WhatsApp" para notificación
5. Activar workflow
```

---

## 16. Monitoreo y Observabilidad

### Logs
```bash
# Ver logs en tiempo real
docker logs -f smartenrich_app
docker logs -f smartenrich_worker

# O en Portainer → Containers → smartenrich_app → Logs
```

### Health Check
```
GET https://smartenrich.automasc.com/health

Response:
{
  "status": "ok",
  "uptime": "2d 5h 30m",
  "lastRun": "2026-02-07T08:00:00Z",
  "productsInQueue": 3,
  "dbConnection": "connected",
  "redisConnection": "connected"
}
```

### Bull Board Dashboard
```
https://bullboard.automasc.com
(Protegido con Basic Auth via Traefik)

Muestra:
- Jobs activos, completados, fallidos
- Tiempo de procesamiento por job
- Retry de jobs fallidos
- Limpieza de jobs viejos
```

---

## 17. Diagrama de Flujo Completo del Enriquecimiento

```
Trigger (n8n cron o manual desde UI)
          │
          ▼
┌─────────────────────┐
│ 1. Fetch Products   │  Shopify Admin API GraphQL
│    from Shopify     │  Paginar todos los productos activos
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. Analyze Each     │  ¿Tiene descripción? ¿Imágenes?
│    Product          │  ¿Tipo? ¿Categoría? ¿Metafields?
│    Completeness     │  Score de completitud 0-100
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 3. Filter Products  │  Solo procesar productos con
│    to Enrich        │  score < 80 o sin descripción
│                     │  Respetar MAX_PRODUCTS_PER_RUN
└──────────┬──────────┘
           │
           ▼ (Para cada producto)
┌─────────────────────┐
│ 4a. Search Barcode  │  Go-UPC → Barcode Lookup → UPCitemdb
│     APIs            │  Usando código de barras de la variante
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4b. Search Web      │  Google Custom Search
│     by SKU/Title    │  "{SKU} {marca} specifications"
│                     │  "{título} ficha técnica"
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4c. Search Images   │  Google Images (si faltan imágenes)
│     (if needed)     │  Filtrar por calidad >= 1024x1024
│                     │  Cachear en MinIO temporalmente
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 5. Send to Gemini   │  Prompt con toda la info recopilada
│    AI Analysis      │  Genera: descripción SEO, metafields,
│                     │  tags, categoría, análisis de imágenes
│                     │  ⚠️ NUNCA incluye precio/costo
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 6. Validate         │  Parsear JSON de Gemini
│    AI Response      │  Verificar confidence score > 0.7
│                     │  Validar que no toque precios
│                     │  Sanitizar HTML de descripción
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 7. Save to DB       │  Modo AUTOMÁTICO:                │
│    (EnrichmentLog)  │  → Aplicar cambios en Shopify    │
│                     │  → Subir imágenes si las hay     │
│                     │                                   │
│                     │  Modo APROBACIÓN:                 │
│                     │  → Guardar propuesta en DB        │
│                     │  → Mostrar en UI para revisión    │
│                     │  → Merchant aprueba/rechaza       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 8. Apply Changes    │  Shopify Admin API Mutations:
│    to Shopify       │  - productUpdate (desc, type, tags)
│                     │  - metafieldsSet (specs técnicas)
│                     │  - productCreateMedia (imágenes)
│                     │  ⚠️ NUNCA price/costPerItem
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 9. Notify           │  Via n8n: Email, Slack, WhatsApp
│    Results          │  "Enriquecidos: 45/50 productos"
│                     │  "Fallidos: 3, Saltados: 2"
└─────────────────────┘
```

---

## 18. Resumen de Costos Mensuales Estimados

| Servicio | Plan | Costo |
|---|---|---|
| VPS Hostinger (KVM 4) | Ya pagado | $0 adicional |
| Google Gemini 2.5 Flash | Free tier (1500 req/día) | $0 |
| Go-UPC API | Basic (1,000 lookups/mes) | ~$10/mes |
| Barcode Lookup | Opcional backup | ~$19/mes (si se necesita) |
| Google Custom Search | 100 gratis/día → suficiente | $0 |
| Dominio/SSL | Via Traefik + Let's Encrypt | $0 |
| **Total estimado** | | **$10-$29/mes** |

Para 50 productos diarios (~1,500/mes), el tier gratuito de Gemini y Google Search es suficiente. Solo Go-UPC tiene costo fijo si querés datos de barcode confiables.

---

## 19. Próximos Pasos

1. **Crear la app en Shopify Partners** (Client ID + Secret)
2. **Obtener API key de Google Gemini** (Google AI Studio)
3. **Scaffolding del proyecto** con `shopify app init`
4. **Configurar PostgreSQL** (crear DB y usuario)
5. **Implementar el pipeline** (fase por fase según el plan)
6. **Testing con productos reales** de smart.cr
7. **Deploy como stack** en Portainer
8. **Configurar cron en n8n**
