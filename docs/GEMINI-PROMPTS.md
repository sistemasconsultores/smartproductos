# Estrategia de Prompts - Google Gemini 2.5 Flash

## Modelo
- Nombre: gemini-2.5-flash
- Endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
- Auth: Query param key={API_KEY}
- Free tier: 15 RPM, 1500 RPD

## System Prompt

```
Eres un experto en SEO y e-commerce especializado en productos de tecnologia para el mercado de Costa Rica. Tu trabajo es enriquecer fichas de productos para una tienda online.

REGLAS ESTRICTAS:
1. NUNCA incluyas informacion de precios, costos, descuentos o valores monetarios
2. Escribe todo en espanol de Costa Rica
3. Las descripciones deben ser HTML valido con parrafos, listas, y negritas
4. Solo incluye metafields que puedas confirmar con los datos proporcionados
5. Si no tenes certeza sobre un dato, no lo inventes - dejalo vacio
6. El confidence_score debe reflejar honestamente que tan seguro estas

FORMATO DE RESPUESTA:
Responde UNICAMENTE con un objeto JSON valido, sin markdown, sin comentarios.
```

## User Prompt Template

```
Necesito que enriquezcas la siguiente ficha de producto para la tienda smart.cr (tecnologia en Costa Rica).

## DATOS ACTUALES DEL PRODUCTO:
- Titulo: {title}
- Descripcion actual: {descriptionHtml_or_VACIA}
- Tipo: {productType_or_SIN_TIPO}
- Vendor/Marca: {vendor}
- Tags actuales: {tags_or_NINGUNO}
- SKU: {sku_or_SIN_SKU}
- Barcode: {barcode_or_SIN_BARCODE}
- Imagenes actuales: {imageCount} imagenes
- Categoria Shopify: {category_or_SIN_CATEGORIA}

## DATOS ENCONTRADOS POR BARCODE:
{barcode_data_or_No_se_encontro_informacion_por_barcode}

## DATOS ENCONTRADOS POR BUSQUEDA WEB:
{search_data_or_No_se_encontro_informacion_adicional}

## METAFIELDS ACTUALES:
{current_metafields_or_NINGUNO}

## QUE NECESITO QUE GENERES:

Responde con este JSON exacto:
{
  "confidence_score": 0.0-1.0,
  "description_html": "<p>Descripcion SEO en HTML...</p>",
  "product_type": "Tipo de producto",
  "category_suggestion": "Electronics > Computers > Laptops",
  "tags": ["tag1", "tag2", "..."],
  "seo_title": "Titulo SEO (max 70 chars)",
  "seo_description": "Meta description SEO (max 160 chars)",
  "metafields": {
    "custom.memoria_ram": "valor o null",
    "custom.almacenamiento": "valor o null",
    "custom.procesador_marca": "valor o null",
    "custom.procesador_tipo": "valor o null",
    "custom.pantalla": "valor o null",
    "custom.color": "valor o null",
    "custom.conectividad": "valor o null",
    "custom.peso": "valor o null",
    "custom.dimensiones": "valor o null",
    "custom.bateria": "valor o null",
    "custom.garantia": "valor o null",
    "custom.sistema_operativo": "valor o null",
    "custom.resolucion": "valor o null",
    "custom.modelo": "valor o null",
    "custom.numero_parte": "valor o null"
  },
  "image_analysis": {
    "current_quality": "buena|regular|mala",
    "needs_more_images": true|false,
    "suggested_alt_texts": ["alt text 1", "alt text 2"]
  }
}

NOTAS:
- Solo incluye metafields que puedas confirmar con datos reales
- Descripcion: 150-300 palabras, HTML con <p>, <ul>, <li>, <strong>
- 5-15 tags relevantes en espanol
- category_suggestion usa taxonomia standard de Shopify
- NUNCA incluyas precio, costo, o valores monetarios
```

## Interface TypeScript de Respuesta

```typescript
interface GeminiEnrichmentResponse {
  confidence_score: number;         // 0.0 - 1.0
  description_html: string;         // HTML valido
  product_type: string;
  category_suggestion: string;      // Taxonomia Shopify
  tags: string[];                   // 5-15 tags
  seo_title: string;                // Max 70 chars
  seo_description: string;          // Max 160 chars
  metafields: Record<string, string | null>;
  image_analysis: {
    current_quality: "buena" | "regular" | "mala";
    needs_more_images: boolean;
    suggested_alt_texts: string[];
  };
}
```

## Configuracion del API Call

```typescript
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: systemPrompt + "\n\n" + userPrompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 4096,
        responseMimeType: "application/json"
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    })
  }
);
```

## Validacion Post-Gemini

1. JSON valido
2. confidence_score entre 0.0 y 1.0
3. description_html no vacio, sin scripts
4. tags es array de strings
5. Ningun campo contiene "precio", "costo", "$", "colones", "dolares"
6. metafields solo contiene keys validas (ver config/metafields.json)
7. HTML sanitizado (sin script, style, onclick, etc.)

## Manejo de Errores

- 429 Rate Limit: Retry con backoff (2s, 4s, 8s, 16s)
- 500 Server Error: Retry hasta 3 veces
- JSON invalido: Intentar extraer JSON, sino marcar como fallido
- Confidence < 0.7: Guardar como PENDING para revision manual
- Respuesta con precios: RECHAZAR completamente, log error critico
