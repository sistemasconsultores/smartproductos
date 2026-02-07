# CLAUDE.md - SmartEnrich (SmartProductos)

## Contexto del Proyecto

SmartEnrich es una Shopify Custom App embebida que enriquece automaticamente los datos de productos de la tienda smart.cr (Smart Costa Rica - smartcostarica.myshopify.com) usando inteligencia artificial. La app analiza productos incompletos diariamente y completa descripciones SEO, especificaciones tecnicas, categorias, tags e imagenes.

- Shopify Partner ID: 133857750
- Shopify App ID: 320621740033
- Client ID: 843e58d69ee44d65a8927ffd8a387f09c
- Webhooks API Version: 2026-01
- Tienda: smartcostarica.myshopify.com
- Dominio: smart.cr
- Contacto: econtreras@consultor.cr
- Vertical: E-commerce de tecnologia en Costa Rica

## Stack Tecnologico

- Framework: Shopify App Template Remix (React Router v7 + TypeScript)
- Base de datos: PostgreSQL (existente en Docker) + Prisma ORM
- Cola de tareas: BullMQ + Redis (existente en Docker)
- IA: Google Gemini 2.5 Flash API
- APIs externas: Go-UPC, UPCitemdb, Google Custom Search
- UI: Shopify Polaris React + App Bridge
- Deployment: Docker Swarm via Portainer en VPS Hostinger (Ubuntu 22.04, 4 CPU, 16GB RAM)
- Reverse Proxy: Traefik (existente) con SSL automatico Let's Encrypt
- Scheduler: n8n (existente en Docker) como cron trigger externo
- Storage: MinIO (existente en Docker) para cache temporal de imagenes

## Documentacion Detallada

Lee estos documentos ANTES de empezar a codear:
- docs/ARCHITECTURE.md - Arquitectura, pipeline, esquema BD, diagramas
- docs/DEPLOYMENT.md - Docker, compose, Dockerfile, pasos de deploy
- docs/GEMINI-PROMPTS.md - Prompts para Gemini, formato respuesta, validacion
- docs/SHOPIFY-API.md - Queries GraphQL, mutations, metafields, webhooks
- docs/API-INTEGRATIONS.md - Go-UPC, UPCitemdb, Google Custom Search

## Estructura del Proyecto

```
smartproductos/
|-- CLAUDE.md
|-- README.md
|-- docs/ (5 archivos de documentacion)
|-- config/metafields.json (15 metafields de tecnologia)
|-- docker-compose.yml
|-- Dockerfile
|-- .env.example
|-- prisma/schema.prisma
|-- shopify.app.toml
|-- app/
|   |-- routes/
|   |   |-- app._index.tsx (Dashboard)
|   |   |-- app.products.tsx (Lista productos)
|   |   |-- app.products.$id.tsx (Detalle/comparacion)
|   |   |-- app.settings.tsx (Configuracion)
|   |   |-- app.history.tsx (Historial)
|   |   |-- api.enrich.tsx (Trigger manual/n8n)
|   |   |-- api.enrich.$id.tsx (Enriquecer 1 producto)
|   |   |-- api.approve.tsx (Aprobar/rechazar)
|   |   |-- api.health.tsx (Health check)
|   |   |-- webhooks.tsx (Shopify webhooks)
|   |-- services/
|   |   |-- enrichment/
|   |   |   |-- pipeline.server.ts (Orquestador principal)
|   |   |   |-- analyzer.server.ts (Score completitud 0-100)
|   |   |   |-- barcode-lookup.server.ts (Go-UPC, UPCitemdb)
|   |   |   |-- web-search.server.ts (Google Custom Search)
|   |   |   |-- image-search.server.ts (Busqueda imagenes)
|   |   |   |-- gemini.server.ts (Google Gemini API)
|   |   |   |-- shopify-updater.server.ts (Mutations GraphQL)
|   |   |   |-- image-cache.server.ts (MinIO cache)
|   |   |-- queue/
|   |   |   |-- enrichment.queue.server.ts (Colas BullMQ)
|   |   |   |-- enrichment.worker.server.ts (Worker jobs)
|   |   |-- shopify/
|   |       |-- queries.server.ts (GraphQL queries)
|   |       |-- mutations.server.ts (GraphQL mutations)
|   |-- components/
|       |-- ProductComparisonCard.tsx
|       |-- EnrichmentProgress.tsx
|       |-- StatsCards.tsx
|       |-- CompletenessChart.tsx
|       |-- SettingsForm.tsx
|-- worker/index.ts (Entry point worker)
```

## REGLA CRITICA: NUNCA MODIFICAR PRECIOS NI COSTOS

SmartEnrich JAMAS debe:
- Leer, incluir, o enviar price, compare_at_price, o cost al prompt de Gemini
- Generar mutations GraphQL que incluyan campos de precio
- Mostrar precios en logs o comparaciones antes/despues
- Incluir informacion de costos en ningun payload a APIs externas

## Idioma
- Descripciones, tags, metafields en espanol costarricense
- Prompt de Gemini especifica "espanol de Costa Rica"
- UI puede estar en espanol

## Pipeline de Enriquecimiento (6 Pasos)

1. Fetch: Productos activos via GraphQL (paginacion cursor-based)
2. Analyze: Score completitud 0-100
3. Search: Barcode (Go-UPC, UPCitemdb) + SKU/titulo (Google Custom Search)
4. AI Process: Gemini 2.5 Flash genera descripcion SEO, metafields, tags, categoria
5. Validate: JSON (confidence > 0.7, sin precios, HTML limpio)
6. Apply: Actualizar Shopify o guardar para aprobacion

## Infraestructura (VPS existente - NO crear nueva)

- IP: 147.93.43.70
- Ubuntu 22.04, 4 CPU, 16 GB RAM, 200 GB disco
- Docker Swarm + Portainer (panel.automasc.com)

Servicios existentes reutilizados:
- postgres: BD principal (crear DB smartenrich)
- redis: BullMQ queue (DB index 2)
- traefik: Reverse proxy + SSL para smartenrich.automasc.com
- n8n: Cron trigger diario + notificaciones
- minio: Cache imagenes (bucket smartenrich-images)

## Convenciones de Codigo

- TypeScript estricto, nunca any
- Servicios con acceso a DB/APIs: sufijo .server.ts
- Prisma para todas las operaciones de BD
- try/catch en servicios, logs estructurados
- admin.graphql() del template Shopify Remix
- Componentes Polaris para toda la UI
- No secrets hardcoded, todo via process.env

## Orden de Implementacion

1. Scaffolding: shopify app init --template remix
2. Prisma schema y migrations
3. Servicios: analyzer -> barcode-lookup -> gemini -> pipeline
4. UI: Dashboard -> Settings -> Product comparison
5. Worker BullMQ
6. Docker build y deploy en Portainer
7. n8n workflow cron

PRIORIDAD: Pipeline funcional end-to-end antes de pulir UI.
