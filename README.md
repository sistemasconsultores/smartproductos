# SmartEnrich (SmartProductos)

Shopify Custom App embebida que enriquece automaticamente productos de la tienda **smart.cr** (Smart Costa Rica) usando inteligencia artificial.

## Que Hace

- Analiza productos activos de Shopify (score de completitud 0-100)
- Busca informacion por barcode (Go-UPC, UPCitemdb) y por SKU/titulo (SerpAPI, Serper.dev, Google Custom Search)
- Genera descripciones SEO en espanol costarricense con Google Gemini 2.5 Flash
- Completa metafields tecnicos (color, dimensiones, modelo, numero de parte, peso, etc.)
- Asigna categorias, tipos de producto y tags automaticamente
- Auto-aplica cambios si confidence >= 0.5 (configurable)
- **NUNCA modifica precios ni costos**

## Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Framework | Shopify App Template Remix 2.15 + React Router v7 |
| Lenguaje | TypeScript (strict) |
| UI | Shopify Polaris 13.9 + App Bridge |
| Base de datos | PostgreSQL + Prisma 5.22 |
| Cola de tareas | BullMQ 5.25 + Redis |
| IA | Google Gemini 2.5 Flash |
| Busqueda web | SerpAPI / Serper.dev / Google Custom Search (cadena de fallback) |
| Barcode | Go-UPC + UPCitemdb |
| Deployment | Docker Swarm + Portainer |
| Reverse Proxy | Traefik + Let's Encrypt SSL |

## Arquitectura

```
Internet --> Traefik (SSL) --> smartenrich.automasc.com
                                  |
                       +----------+----------+
                       |                     |
                 smartenrich_app       smartenrich_worker
                 (Remix + Polaris)     (BullMQ + Pipeline)
                       |                     |
                       +----------+----------+
                                  |
                       +----------+----------+
                       |          |          |
                    PostgreSQL  Redis    APIs Externas
                    (smartenrich) (DB 3)  (Gemini, Search, Barcode)
```

**2 servicios Docker** comparten la misma imagen:
- **app**: Servidor Remix (UI embebida en Shopify Admin, APIs REST, webhooks)
- **worker**: Proceso BullMQ (pipeline de enriquecimiento, cron diario 2:00 AM)

## Pipeline de Enriquecimiento (6 Pasos)

1. **Fetch**: Productos activos via Shopify GraphQL (paginacion cursor-based)
2. **Dedup**: Filtrar productos ya procesados (APPLIED/PENDING en DB)
3. **Analyze**: Score de completitud 0-100 (descripcion, imagenes, metafields, SEO)
4. **Search**: Barcode APIs + Web Search (SerpAPI --> Serper --> Google)
5. **AI**: Gemini 2.5 Flash genera descripcion SEO, metafields, tags, categoria
6. **Apply**: Auto-aplica si confidence >= 0.5, o guarda como PENDING

## Setup de Desarrollo

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus API keys

# Migrar base de datos
npx prisma migrate dev

# Desarrollo local
shopify app dev

# Worker en paralelo (otra terminal)
npm run worker
```

## Build y Deploy

```bash
# En el VPS (/opt/smartenrich):
git pull origin claude/analyze-project-ncZEk

# Build Docker
docker build -t smartenrich:latest .

# Deploy servicios
docker service update --image smartenrich:latest smartenrich_app
docker service update --image smartenrich:latest smartenrich_worker

# Limpiar jobs viejos de Redis (opcional)
docker exec $(docker ps -q -f name=redis_redis) redis-cli -n 3 FLUSHDB

# Ver logs
docker service logs smartenrich_worker --tail 100 -f
docker service logs smartenrich_app --tail 100 -f
```

## Estructura del Proyecto

```
smartproductos/
|-- CLAUDE.md                         # Instrucciones del proyecto
|-- README.md                         # Este archivo
|-- docs/                             # Documentacion detallada
|-- config/metafields.json            # 15 metafields de tecnologia
|-- docker-compose.yml                # Stack Docker Swarm (2 servicios)
|-- Dockerfile                        # Multi-stage build (node:20-alpine)
|-- .env.example                      # Template de variables de entorno
|-- prisma/schema.prisma              # Schema de BD (PostgreSQL)
|-- shopify.app.toml                  # Config Shopify App
|-- worker/index.ts                   # Entry point del worker BullMQ
|-- app/
    |-- shopify.server.ts             # Config Shopify SDK + OAuth
    |-- db.server.ts                  # Prisma client singleton
    |-- routes/
    |   |-- app._index.tsx            # Dashboard (stats + bulk approve)
    |   |-- app.products._index.tsx   # Lista productos (paginacion + filtros)
    |   |-- app.products.$id.tsx      # Detalle/comparacion antes-despues
    |   |-- app.settings.tsx          # Configuracion
    |   |-- app.history.tsx           # Historial de ejecuciones
    |   |-- api.enrich.tsx            # Trigger manual/externo (POST)
    |   |-- api.enrich.$id.tsx        # Enriquecer 1 producto
    |   |-- api.approve.tsx           # Aprobar/rechazar enriquecimiento
    |   |-- api.health.tsx            # Health check
    |   |-- webhooks.tsx              # Shopify webhooks
    |-- services/
    |   |-- enrichment/
    |   |   |-- pipeline.server.ts    # Orquestador principal (6 pasos)
    |   |   |-- analyzer.server.ts    # Score completitud 0-100
    |   |   |-- barcode-lookup.server.ts  # Go-UPC + UPCitemdb
    |   |   |-- web-search.server.ts  # SerpAPI + Serper.dev + Google
    |   |   |-- image-search.server.ts    # Busqueda de imagenes
    |   |   |-- gemini.server.ts      # Google Gemini API + validacion
    |   |   |-- shopify-updater.server.ts # Aplicar cambios en Shopify
    |   |   |-- image-cache.server.ts # MinIO cache
    |   |-- queue/
    |   |   |-- enrichment.queue.server.ts   # BullMQ queue + cron
    |   |   |-- enrichment.worker.server.ts  # Worker job processor
    |   |   |-- worker-admin.server.ts       # Admin API (fetch nativo)
    |   |-- shopify/
    |   |   |-- queries.server.ts     # GraphQL queries (solo activos)
    |   |   |-- mutations.server.ts   # GraphQL mutations (sin precios)
    |   |-- redis.server.ts           # Redis client + cache helpers
    |-- components/
        |-- ProductComparisonCard.tsx
        |-- EnrichmentProgress.tsx
        |-- StatsCards.tsx
        |-- CompletenessChart.tsx
        |-- SettingsForm.tsx
```

## Variables de Entorno

| Variable | Descripcion | Requerida |
|---|---|---|
| `SHOPIFY_API_KEY` | Client ID de Shopify Partners | Si |
| `SHOPIFY_API_SECRET` | Client Secret | Si |
| `SHOPIFY_APP_URL` | URL de la app | Si |
| `DATABASE_URL` | PostgreSQL connection string | Si |
| `REDIS_URL` | Redis (DB 3) | Si |
| `GEMINI_API_KEY` | Google Gemini API key | Si |
| `SERPAPI_KEY` | SerpAPI (busqueda primaria) | Opcional |
| `SERPER_API_KEY` | Serper.dev (busqueda secundaria) | Opcional |
| `GOOGLE_SEARCH_API_KEY` | Google Custom Search | Opcional |
| `GOOGLE_SEARCH_CX` | Custom Search Engine ID | Opcional |
| `GO_UPC_API_KEY` | Go-UPC barcode lookup | Opcional |
| `MINIO_*` | MinIO storage config | Opcional |

## Reglas Criticas

1. **NUNCA modificar precios/costos** - Strippeado en mutations.server.ts
2. **Solo productos ACTIVOS** - Draft/archived se excluyen
3. **Deduplicacion** - Productos ya APPLIED/PENDING no se reprocesan
4. **Contenido en espanol costarricense** - Definido en prompt de Gemini
5. **Confidence >= 0.5 para auto-apply** - Configurable desde Settings

## Infraestructura (VPS Existente)

- **IP**: 147.93.43.70
- **OS**: Ubuntu 22.04, 4 CPU, 16 GB RAM, 200 GB disco
- **Docker Swarm + Portainer**: panel.automasc.com
- **PostgreSQL**: BD `smartenrich` (existente en Docker)
- **Redis**: DB index 3 (existente en Docker)
- **Traefik**: SSL automatico para smartenrich.automasc.com (red CFNet)
- **MinIO**: Bucket `smartenrich-images` (existente en Docker)

## Contacto

- **Tienda**: smartcostarica.myshopify.com (smart.cr)
- **Contacto**: econtreras@consultor.cr
- **Shopify Partner ID**: 133857750
- **Shopify App ID**: 320621740033

## Licencia

Privado - Smart Costa Rica / Sistemas Consultores
