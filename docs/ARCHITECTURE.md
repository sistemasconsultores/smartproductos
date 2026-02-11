# SmartEnrich — App de Enriquecimiento Automático de Productos con IA

## Documento de Arquitectura y Plan de Implementación

**Tienda:** smart.cr (Smart Costa Rica)  
**Plataforma:** Shopify  
**Partner ID:** 133857750  
**Fecha:** Febrero 2026

---

## 1. Resumen Ejecutivo

SmartEnrich es una aplicación de Shopify diseñada para automatizar el enriquecimiento de productos en la tienda smart.cr. La app realiza una revisión diaria de todos los productos, completando y optimizando automáticamente: descripciones SEO, imágenes, categorías, tipos de producto, metafields (peso, dimensiones, memoria, almacenamiento, marca de procesador, etc.) — todo basado en el título del producto, SKU y código de barras, utilizando búsqueda web y Google Gemini AI. **La app nunca modifica precios ni costos.**

---

## 2. Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                    SHOPIFY ADMIN (Embebida)                  │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Dashboard     │  │  Cola de     │  │  Configuración   │  │
│  │  (Estado de    │  │  Revisión    │  │  (API Keys,      │  │
│  │   productos)   │  │  Manual      │  │   Reglas, Cron)  │  │
│  └───────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└──────────┼─────────────────┼────────────────────┼────────────┘
           │                 │                    │
           ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js + Remix)                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Product Enrichment Pipeline            │   │
│  │                                                       │   │
│  │  1. Fetch Products (Shopify Admin API GraphQL)        │   │
│  │  2. Analyze Completeness (¿qué falta?)                │   │
│  │  3. Search Product Info (Barcode/SKU APIs + Web)      │   │
│  │  4. AI Analysis (Google Gemini)                       │   │
│  │     - Generar descripción SEO                         │   │
│  │     - Validar/sugerir imágenes                        │   │
│  │     - Completar metafields técnicos                   │   │
│  │  5. Update Product (Shopify Admin API)                │   │
│  │  6. Log Results (Prisma/DB)                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Cron/Scheduler│  │ Queue System │  │ Prisma + SQLite  │   │
│  │ (node-cron)  │  │ (Bull/BullMQ)│  │ (o PostgreSQL)   │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
           │                 │                    │
           ▼                 ▼                    ▼
┌──────────────────┐ ┌───────────────┐ ┌──────────────────────┐
│  Shopify Admin   │ │ Google Gemini │ │  APIs Externas        │
│  API (GraphQL)   │ │ API           │ │  - Serper.dev (web)   │
│  - Products      │ │ (2.5 Flash)   │ │  - Serper.dev (images)│
│  - Metafields    │ │               │ │  - SerpAPI (fallback) │
│  - Images        │ │               │ │                       │
│  - Collections   │ │               │ │                       │
└──────────────────┘ └───────────────┘ └──────────────────────┘
```

---

## 3. Stack Tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Framework | Shopify App Template (Remix / React Router) | Recomendado oficialmente por Shopify |
| Lenguaje | TypeScript / JavaScript | Ecosistema Shopify nativo |
| Base de datos | Prisma + SQLite (dev) / PostgreSQL (prod) | Incluido en template, fácil migración |
| IA | Google Gemini 2.5 Flash API | Rápido, económico, multimodal (analiza imágenes) |
| Cola de tareas | BullMQ + Redis | Procesamiento async de productos |
| Cron/Scheduler | node-cron o Shopify Flow | Ejecución diaria programada |
| Barcode API | Go-UPC + Barcode Lookup + UPCitemdb | Cobertura global de códigos de barras |
| Búsqueda web | Serper.dev (primario) + SerpAPI (fallback) | Encontrar info e imágenes de productos |
| UI | Polaris (React) + App Bridge | Consistente con el admin de Shopify |
| Hosting | Fly.io / Railway / Render / Heroku | Recomendados por Shopify |

---

## 4. Modelo de Datos (Prisma Schema)

```prisma
datasource db {
  provider = "sqlite" // Cambiar a "postgresql" en producción
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Tabla de sesiones de Shopify (incluida en el template)
model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String
  userId        BigInt?
  firstName     String?
  lastName      String?
  email         String?
  accountOwner  Boolean   @default(false)
  locale        String?
  collaborator  Boolean?  @default(false)
  emailVerified Boolean?  @default(false)
}

// Configuración de la app por tienda
model AppConfig {
  id                    String   @id @default(cuid())
  shop                  String   @unique
  geminiApiKey          String?  // Clave API de Google Gemini
  barcodeLookupApiKey   String?  // Clave API de Barcode Lookup
  goUpcApiKey           String?  // Clave API de Go-UPC
  serperApiKey          String?  // Serper.dev API key (busqueda web + imagenes)
  serpApiKey             String?  // SerpAPI key (fallback)
  cronEnabled           Boolean  @default(true)
  cronTime              String   @default("02:00") // Hora de ejecución diaria (CST)
  autoApplyChanges      Boolean  @default(false) // true=aplica auto, false=requiere aprobación
  skipWithImages        Boolean  @default(false) // Saltar productos que ya tienen imágenes
  skipWithDescription   Boolean  @default(false) // Saltar productos con descripción
  maxProductsPerRun     Int      @default(50)    // Límite por ejecución
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

// Log de enriquecimiento por producto
model EnrichmentLog {
  id              String   @id @default(cuid())
  shop            String
  productId       String   // Shopify product GID
  productTitle    String
  sku             String?
  barcode         String?
  status          String   // "pending" | "enriched" | "approved" | "failed" | "skipped"
  
  // Campos que se proponen modificar
  proposedTitle       String?   @db.Text
  proposedDescription String?   @db.Text  // HTML SEO-optimizado
  proposedType        String?
  proposedVendor      String?
  proposedTags        String?   // JSON array
  proposedCategory    String?   // Shopify product category
  proposedWeight      Float?
  proposedWeightUnit  String?   // "kg" | "g" | "lb" | "oz"
  
  // Metafields propuestos (JSON)
  proposedMetafields  String?   @db.Text  // JSON con metafields
  
  // Imágenes encontradas
  proposedImages      String?   @db.Text  // JSON array de URLs
  imageAnalysis       String?   @db.Text  // Resultado del análisis de Gemini
  
  // Fuentes de datos
  barcodeData         String?   @db.Text  // JSON raw de barcode API
  webSearchData       String?   @db.Text  // JSON raw de búsqueda web
  geminiResponse      String?   @db.Text  // Respuesta completa de Gemini
  
  // Tracking
  appliedAt           DateTime?
  appliedBy           String?   // "auto" | "manual" | user email
  errorMessage        String?   @db.Text
  
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([shop, status])
  @@index([shop, productId])
  @@index([createdAt])
}

// Historial de ejecuciones del cron
model EnrichmentRun {
  id                String   @id @default(cuid())
  shop              String
  startedAt         DateTime @default(now())
  completedAt       DateTime?
  status            String   // "running" | "completed" | "failed"
  totalProducts     Int      @default(0)
  enrichedCount     Int      @default(0)
  skippedCount      Int      @default(0)
  failedCount       Int      @default(0)
  errorMessage      String?  @db.Text
  
  @@index([shop, startedAt])
}
```

---

## 5. Pipeline de Enriquecimiento (Detalle del Flujo)

### Paso 1: Obtener Productos de Shopify

```graphql
# Query GraphQL para obtener productos con toda su info
query GetProducts($cursor: String) {
  products(first: 50, after: $cursor) {
    edges {
      cursor
      node {
        id
        title
        descriptionHtml
        productType
        vendor
        tags
        status
        category {
          id
          name
        }
        images(first: 10) {
          edges {
            node {
              id
              url
              altText
              width
              height
            }
          }
        }
        variants(first: 10) {
          edges {
            node {
              id
              title
              sku
              barcode
              weight
              weightUnit
              price
              inventoryQuantity
              metafields(first: 20) {
                edges {
                  node {
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        }
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Paso 2: Análisis de Completitud

```typescript
interface ProductCompleteness {
  hasDescription: boolean;
  descriptionLength: number;
  hasImages: boolean;
  imageCount: number;
  imagesHaveAltText: boolean;
  imagesMinResolution: boolean; // >= 1024x1024 recomendado
  hasProductType: boolean;
  hasCategory: boolean;
  hasVendor: boolean;
  hasTags: boolean;
  hasWeight: boolean;
  hasSKU: boolean;
  hasBarcode: boolean;
  hasMetafields: {
    memory: boolean;
    storage: boolean;
    processorBrand: boolean;
    processorType: boolean;
    screenSize: boolean;
    color: boolean;
    dimensions: boolean;
    connectivity: boolean;
    batteryLife: boolean;
    warranty: boolean;
  };
  completenessScore: number; // 0-100
  fieldsToEnrich: string[];
}

function analyzeCompleteness(product: ShopifyProduct): ProductCompleteness {
  // Evalúa cada campo y calcula score
  // Retorna lista de campos que necesitan enriquecimiento
}
```

### Paso 3: Búsqueda de Información del Producto

```typescript
// 3a. Búsqueda por código de barras
async function searchByBarcode(barcode: string): Promise<ProductData> {
  // Intenta Go-UPC primero
  let data = await goUpcLookup(barcode);
  if (!data) {
    // Fallback a Barcode Lookup
    data = await barcodeLookupSearch(barcode);
  }
  if (!data) {
    // Fallback a UPCitemdb
    data = await upcItemDbSearch(barcode);
  }
  return data;
}

// 3b. Búsqueda por SKU en la web
async function searchBySKU(sku: string, title: string): Promise<WebSearchResult> {
  // Serper.dev con SKU + marca del título
  const query = `${sku} ${extractBrand(title)} specifications`;
  const results = await serperSearch(query);
  return results;
}

// 3c. Búsqueda de imágenes del producto
async function searchProductImages(
  title: string, 
  sku: string, 
  barcode: string
): Promise<ImageResult[]> {
  // Buscar imágenes oficiales del producto
  const query = `${title} ${sku} product photo official`;
  const images = await serperImageSearch(query);
  
  // Filtrar por calidad mínima (1024x1024)
  return images.filter(img => img.width >= 1024 && img.height >= 1024);
}
```

### Paso 4: Análisis con Google Gemini

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

async function enrichWithGemini(
  product: ShopifyProduct, 
  barcodeData: ProductData,
  webSearchData: WebSearchResult
): Promise<EnrichmentResult> {
  
  const prompt = `
Eres un experto en SEO para e-commerce de tecnología en Costa Rica.
Tu tienda es Smart Costa Rica (smart.cr).

PRODUCTO ACTUAL:
- Título: ${product.title}
- SKU: ${product.variants[0]?.sku || 'N/A'}
- Código de barras: ${product.variants[0]?.barcode || 'N/A'}
- Descripción actual: ${product.descriptionHtml || 'Sin descripción'}
- Tipo de producto: ${product.productType || 'Sin tipo'}
- Proveedor: ${product.vendor || 'Sin proveedor'}
- Tags: ${product.tags?.join(', ') || 'Sin tags'}

INFORMACIÓN ENCONTRADA EN INTERNET:
${JSON.stringify(barcodeData, null, 2)}

DATOS DE BÚSQUEDA WEB:
${JSON.stringify(webSearchData, null, 2)}

TAREAS:
1. **Descripción SEO** (HTML): Genera una descripción de producto optimizada para SEO 
   en español (Costa Rica). Debe incluir:
   - Párrafo introductorio atractivo (2-3 líneas)
   - Lista de características principales con iconos/emojis
   - Especificaciones técnicas en tabla HTML
   - Párrafo de cierre con call-to-action
   - Keywords naturales integradas
   - Longitud ideal: 150-300 palabras
   - Formato: HTML válido para Shopify

2. **Tipo de producto**: Categoría correcta (ej: "Impresora", "Laptop", 
   "Monitor", "Cargador", "Repuesto", "Estuche", etc.)

3. **Tags SEO**: Array de 5-15 tags relevantes en español

4. **Categoría Shopify**: Taxonomía correcta de Shopify 
   (ej: "Electronics > Computers & Tablets > Laptops")

5. **Metafields técnicos**: Completa SOLO los que apliquen al producto:
   - custom.memoria_ram (ej: "8GB", "16GB")
   - custom.almacenamiento (ej: "256GB SSD", "1TB HDD")
   - custom.procesador_marca (ej: "Intel", "AMD", "Apple")
   - custom.procesador_tipo (ej: "Core i5 210H", "Ryzen 5 5600")
   - custom.pantalla (ej: "15.6 pulgadas FHD", "24 pulgadas 4K")
   - custom.color (ej: "Negro", "Blanco", "Plata")
   - custom.conectividad (ej: "WiFi 6, Bluetooth 5.0, USB-C")
   - custom.peso (número en kg)
   - custom.dimensiones (ej: "35.6 x 23.4 x 1.8 cm")
   - custom.bateria (ej: "10 horas", "5000 mAh")
   - custom.garantia (ej: "1 año del fabricante")
   - custom.sistema_operativo (ej: "Windows 11 Home", "ChromeOS")
   - custom.resolucion (ej: "1920x1080", "3840x2160")

6. **Peso del producto**: Peso en kg (para envío)

7. **Análisis de imágenes**: Si el producto tiene imágenes, evalúa:
   - ¿Son imágenes reales del producto correcto?
   - ¿Cumplen requisito mínimo de 1024x1024px?
   - ¿Tienen fondo blanco o neutro?
   - ¿Se necesitan más ángulos?
   - Recomendaciones de mejora

REGLAS IMPORTANTES:
- NO modifiques precio ni costo bajo ninguna circunstancia
- Si no estás seguro de una especificación, déjala como null
- Verifica que la información coincida con el SKU y código de barras
- Las descripciones deben ser en español de Costa Rica
- Usa moneda local (₡ colones) si es necesario referenciar precios
- Incluye alt text optimizado para cada imagen sugerida

Responde en JSON con esta estructura exacta:
{
  "description_html": "...",
  "product_type": "...",
  "tags": ["tag1", "tag2", ...],
  "category": "...",
  "vendor": "...",
  "weight": 0.0,
  "weight_unit": "kg",
  "metafields": {
    "custom.memoria_ram": "..." | null,
    "custom.almacenamiento": "..." | null,
    "custom.procesador_marca": "..." | null,
    ...
  },
  "image_analysis": {
    "current_images_valid": true/false,
    "issues": ["..."],
    "recommendations": ["..."],
    "suggested_alt_texts": ["..."]
  },
  "seo_meta": {
    "meta_title": "...",  // Max 60 chars
    "meta_description": "..."  // Max 160 chars
  },
  "confidence_score": 0.0-1.0,
  "notes": "..."
}
`;

  const result = await model.generateContent(prompt);
  const response = result.response.text();
  
  // Parsear JSON de la respuesta
  return JSON.parse(cleanJsonResponse(response));
}
```

### Paso 5: Aplicar Cambios en Shopify

```graphql
# Mutation para actualizar producto
mutation UpdateProduct($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id
      title
      descriptionHtml
      productType
      vendor
      tags
    }
    userErrors {
      field
      message
    }
  }
}

# Mutation para metafields
mutation UpdateMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      value
    }
    userErrors {
      field
      message
    }
  }
}
```

**IMPORTANTE:** El pipeline NUNCA incluye `price` ni `costPerItem` en las mutations.

---

## 6. Definición de Metafields para Productos de Tecnología

Estos metafields deben crearse en Shopify antes de usarlos:

```typescript
const TECH_METAFIELDS = [
  { namespace: "custom", key: "memoria_ram", type: "single_line_text_field", name: "Memoria RAM" },
  { namespace: "custom", key: "almacenamiento", type: "single_line_text_field", name: "Almacenamiento" },
  { namespace: "custom", key: "procesador_marca", type: "single_line_text_field", name: "Marca del Procesador" },
  { namespace: "custom", key: "procesador_tipo", type: "single_line_text_field", name: "Tipo de Procesador" },
  { namespace: "custom", key: "pantalla", type: "single_line_text_field", name: "Pantalla" },
  { namespace: "custom", key: "color", type: "single_line_text_field", name: "Color" },
  { namespace: "custom", key: "conectividad", type: "single_line_text_field", name: "Conectividad" },
  { namespace: "custom", key: "peso", type: "number_decimal", name: "Peso (kg)" },
  { namespace: "custom", key: "dimensiones", type: "single_line_text_field", name: "Dimensiones" },
  { namespace: "custom", key: "bateria", type: "single_line_text_field", name: "Batería" },
  { namespace: "custom", key: "garantia", type: "single_line_text_field", name: "Garantía" },
  { namespace: "custom", key: "sistema_operativo", type: "single_line_text_field", name: "Sistema Operativo" },
  { namespace: "custom", key: "resolucion", type: "single_line_text_field", name: "Resolución" },
  { namespace: "custom", key: "modelo", type: "single_line_text_field", name: "Modelo" },
  { namespace: "custom", key: "numero_parte", type: "single_line_text_field", name: "Número de Parte" },
];
```

---

## 7. Interfaz de Usuario (Shopify Admin Embebida)

### 7.1 Dashboard Principal

La página principal muestra:
- **Estadísticas**: Total de productos, enriquecidos, pendientes, fallidos
- **Último run**: Fecha, duración, resultados
- **Gráfico de completitud**: % de productos completos vs incompletos
- **Botón "Ejecutar Ahora"**: Para runs manuales
- **Lista de productos pendientes**: Con opción de aprobar/rechazar cambios

### 7.2 Vista de Producto Individual

Muestra side-by-side:
- **Izquierda**: Datos actuales del producto
- **Derecha**: Datos propuestos por IA (highlighted en verde lo nuevo)
- **Botones**: "Aprobar Todo", "Aprobar Parcial", "Rechazar", "Re-analizar"

### 7.3 Configuración

- API Keys (Gemini, Barcode Lookup, etc.)
- Horario del cron
- Modo: automático vs aprobación manual
- Reglas de exclusión (saltar productos con imágenes, etc.)
- Límite de productos por ejecución
- Selección de campos a enriquecer

---

## 8. Estructura de Archivos del Proyecto

```
smart-enrich/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx          # Dashboard principal
│   │   ├── app.products.tsx         # Lista de productos enriquecidos
│   │   ├── app.products.$id.tsx     # Detalle de enriquecimiento
│   │   ├── app.settings.tsx         # Configuración
│   │   ├── app.run.tsx              # Ejecutar enriquecimiento manual
│   │   ├── app.history.tsx          # Historial de ejecuciones
│   │   ├── api.enrich.tsx           # API endpoint para trigger manual
│   │   ├── api.approve.tsx          # API para aprobar cambios
│   │   ├── api.cron.tsx             # Endpoint para cron externo
│   │   └── webhooks.tsx             # Webhooks de Shopify
│   │
│   ├── services/
│   │   ├── shopify.server.ts        # Configuración Shopify App
│   │   ├── enrichment/
│   │   │   ├── pipeline.ts          # Pipeline principal de enriquecimiento
│   │   │   ├── analyzer.ts          # Análisis de completitud
│   │   │   ├── barcode-lookup.ts    # Servicio de búsqueda por barcode
│   │   │   ├── web-search.ts        # Servicio de búsqueda web
│   │   │   ├── image-search.ts      # Servicio de búsqueda de imágenes
│   │   │   ├── gemini.ts            # Integración con Google Gemini
│   │   │   ├── shopify-updater.ts   # Aplicar cambios en Shopify
│   │   │   └── scheduler.ts         # Cron scheduler
│   │   │
│   │   ├── queries/
│   │   │   ├── products.ts          # Queries GraphQL de productos
│   │   │   └── metafields.ts        # Queries de metafields
│   │   │
│   │   └── utils/
│   │       ├── seo.ts               # Utilidades de SEO
│   │       ├── image-validator.ts   # Validación de imágenes
│   │       └── json-parser.ts       # Parser seguro de JSON de Gemini
│   │
│   ├── components/
│   │   ├── ProductComparisonCard.tsx  # Card de comparación antes/después
│   │   ├── EnrichmentProgress.tsx     # Barra de progreso
│   │   ├── StatsCards.tsx             # Tarjetas de estadísticas
│   │   └── SettingsForm.tsx           # Formulario de configuración
│   │
│   └── shopify.server.ts             # Config principal de Shopify
│
├── prisma/
│   └── schema.prisma                 # Schema de base de datos
│
├── shopify.app.toml                  # Configuración de la app
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 9. Scopes de Shopify Requeridos

```toml
# shopify.app.toml
scopes = "read_products,write_products,read_product_listings,read_inventory,write_inventory"
```

| Scope | Uso |
|---|---|
| `read_products` | Leer todos los productos, variantes, imágenes, metafields |
| `write_products` | Actualizar descripción, tipo, tags, imágenes, metafields |
| `read_product_listings` | Leer listados de productos publicados |
| `read_inventory` | Leer inventario (para contexto) |
| `write_inventory` | Actualizar peso en variantes si es necesario |

---

## 10. APIs Externas — Costos y Límites

### Google Gemini 2.5 Flash
- **Costo**: ~$0.075 / 1M tokens de entrada, ~$0.30 / 1M tokens de salida
- **Free tier**: 15 RPM, 1M tokens/minuto, 1500 req/día
- **Estimado**: ~$0.001-$0.005 por producto (muy económico)
- **Recomendación**: Para 50 productos/día, el tier gratuito es suficiente

### Barcode Lookup API
- **Plans**: Desde $19/mes (500 requests) hasta $129/mes (10,000 requests)
- **Datos**: Nombre, categoría, descripción, imágenes, precios de tienda

### Go-UPC API
- **Plans**: Desde $10/mes (1,000 lookups) hasta $99/mes (50,000 lookups)
- **Datos**: Nombre, marca, categoría, descripción, imágenes

### Serper.dev
- **Costo**: 2,500 gratis, luego $50 por 50,000 búsquedas
- **Uso**: Búsqueda web y de imágenes por SKU/título (primario)

### Alternativa gratuita: UPCitemdb
- **Free tier**: 100 requests/día
- **Datos**: Nombre, marca, descripción, imágenes, URLs de tiendas

---

## 11. Mejores Prácticas de Imágenes para E-commerce

(Integradas en el análisis de Gemini)

| Criterio | Requisito Mínimo | Recomendado |
|---|---|---|
| Resolución | 800x800 px | 2048x2048 px |
| Formato | JPG, PNG | WebP (Shopify lo convierte auto) |
| Fondo | Limpio | Blanco puro (#FFFFFF) |
| Cantidad | 1 imagen | 3-5 imágenes (frente, lados, zoom) |
| Relación de aspecto | 1:1 (cuadrada) | 1:1 o 4:3 |
| Tamaño archivo | < 20MB | 200KB - 2MB optimizado |
| Alt text | Presente | Descriptivo + keywords SEO |
| Nombre archivo | Descriptivo | marca-modelo-angulo.jpg |

---

## 12. Plan de Implementación (Fases)

### Fase 1: Setup Base (Semana 1-2)
- [ ] Crear app con Shopify CLI (`shopify app init`)
- [ ] Configurar Prisma schema
- [ ] Implementar autenticación y UI base con Polaris
- [ ] Crear página de configuración (API keys)
- [ ] Conectar con Shopify Admin API (read products)

### Fase 2: Pipeline de Enriquecimiento (Semana 3-4)
- [ ] Implementar análisis de completitud
- [ ] Integrar APIs de barcode lookup (Go-UPC + Barcode Lookup)
- [ ] Integrar Serper.dev para búsqueda web + imágenes
- [ ] Integrar Google Gemini para generación de descripciones
- [ ] Implementar lógica de actualización de productos (sin tocar precios)

### Fase 3: Imágenes e IA (Semana 5-6)
- [ ] Implementar búsqueda de imágenes por producto
- [ ] Análisis de imágenes existentes con Gemini (calidad, relevancia)
- [ ] Subida automática de imágenes a Shopify
- [ ] Generación de alt text SEO

### Fase 4: Automatización y UI (Semana 7-8)
- [ ] Implementar cron scheduler (ejecución diaria)
- [ ] Dashboard con estadísticas y gráficos
- [ ] Vista de comparación antes/después
- [ ] Sistema de aprobación manual
- [ ] Historial de ejecuciones

### Fase 5: Testing y Deploy (Semana 9-10)
- [ ] Testing con productos reales de smart.cr
- [ ] Ajuste de prompts de Gemini para mejores resultados
- [ ] Deploy a producción (Fly.io o Railway)
- [ ] Monitoreo y ajustes

---

## 13. Consideraciones de Seguridad

- API keys almacenadas encriptadas en la base de datos
- Rate limiting en endpoints del cron
- Validación de webhooks de Shopify
- Logs de auditoría para todas las modificaciones
- Rollback capability: se guardan datos originales antes de cada cambio
- NUNCA se exponen precios ni costos en los prompts de IA
- Validación de respuestas de Gemini antes de aplicar

---

## 14. Comandos para Iniciar el Proyecto

```bash
# 1. Crear la app
shopify app init --template remix

# 2. Instalar dependencias adicionales
npm install @google/generative-ai node-cron bullmq ioredis axios cheerio

# 3. Configurar la base de datos
npx prisma migrate dev --name init

# 4. Iniciar desarrollo
shopify app dev

# 5. Conectar a la tienda smart.cr para testing
# (Shopify CLI te guiará en la conexión)
```

---

## 15. Ejemplo de Resultado Esperado

### Producto ANTES:
```
Título: Lenovo Neo 50q Gen 5 - Intel Core 5 210H / 4.8 GHz - DDR5 SDRAM
Descripción: "- 512 GB Hard Drive Capacity - Integrated graphics"
Tipo: Computadores
Categoría: (vacío)
Tags: (vacío)
Peso: 0
Imágenes: 2 (solo frente y un ángulo)
Metafields: (ninguno)
```

### Producto DESPUÉS (propuesto por SmartEnrich):
```
Título: Lenovo Neo 50q Gen 5 - Intel Core 5 210H / 4.8 GHz - DDR5 SDRAM
Descripción: [HTML SEO optimizado con párrafos, especificaciones, call-to-action]
Tipo: Desktop / Computadora de Escritorio
Categoría: Electronics > Computers > Desktop Computers
Tags: ["lenovo", "neo 50q", "intel core 5", "desktop", "computadora escritorio", 
       "ddr5", "512gb", "oficina", "negocio", "compacto"]
Peso: 1.3 kg
Imágenes: 2 existentes + 3 sugeridas de fuentes oficiales
Alt texts: ["Lenovo Neo 50q Gen 5 desktop compacto vista frontal", ...]
Metafields:
  - custom.memoria_ram: "DDR5 SDRAM"
  - custom.almacenamiento: "512 GB SSD"
  - custom.procesador_marca: "Intel"
  - custom.procesador_tipo: "Core 5 210H"
  - custom.conectividad: "Integrated graphics"
  - custom.sistema_operativo: (buscado por Gemini según modelo)
SEO Meta:
  - meta_title: "Lenovo Neo 50q Gen 5 Intel Core 5 | Comprar en Smart Costa Rica"
  - meta_description: "Computadora de escritorio Lenovo Neo 50q Gen 5 con Intel Core 5 210H, 
     DDR5, 512GB SSD. Envío gratis en Costa Rica. Compra segura en smart.cr"
```

---

## 16. Notas Finales

Esta arquitectura está diseñada para ser escalable. Comenzamos con SQLite para desarrollo
y podemos migrar a PostgreSQL para producción. El uso de BullMQ permite procesar
productos en background sin bloquear la UI. Google Gemini 2.5 Flash es ideal por su
velocidad y bajo costo, y su capacidad multimodal permite analizar imágenes existentes.

La app está pensada como una herramienta interna para smart.cr, pero con la arquitectura
correcta podría publicarse en el Shopify App Store en el futuro como un producto SaaS
para otras tiendas de tecnología.
