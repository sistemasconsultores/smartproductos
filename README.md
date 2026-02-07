# SmartEnrich (SmartProductos)

Shopify Custom App para enriquecer automaticamente productos de la tienda **smart.cr** usando IA.

## Que hace

- Analiza productos incompletos de Shopify diariamente
- Busca informacion por barcode (Go-UPC, UPCitemdb) y por SKU/titulo (Google Search)
- Genera descripciones SEO en espanol costarricense con Google Gemini 2.5 Flash
- Completa metafields tecnicos (RAM, almacenamiento, procesador, pantalla, etc.)
- Asigna categorias y tags automaticamente
- Analiza y mejora imagenes de productos
- NUNCA modifica precios ni costos

## Stack

- Shopify App Template Remix + TypeScript
- PostgreSQL + Prisma ORM
- BullMQ + Redis
- Google Gemini 2.5 Flash
- Docker Swarm + Portainer

## Documentacion

- [CLAUDE.md](./CLAUDE.md) - Instrucciones completas para desarrollo
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Arquitectura del sistema
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) - Guia de deployment
- [docs/GEMINI-PROMPTS.md](./docs/GEMINI-PROMPTS.md) - Prompts de IA
- [docs/SHOPIFY-API.md](./docs/SHOPIFY-API.md) - API de Shopify
- [docs/API-INTEGRATIONS.md](./docs/API-INTEGRATIONS.md) - APIs externas

## Setup

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus API keys

# Migrar base de datos
npx prisma migrate dev

# Desarrollo
shopify app dev

# Build Docker
docker build -t smartenrich:latest .
```

## Licencia

Privado - Smart Costa Rica / Sistemas Consultores
