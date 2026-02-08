import type { ShopifyProduct } from "../shopify/queries.server";
import type { SearchResult } from "./web-search.server";

export interface GeminiEnrichmentResponse {
  confidence_score: number;
  description_html: string;
  product_type: string;
  category_suggestion: string;
  tags: string[];
  seo_title: string;
  seo_description: string;
  metafields: Record<string, string | null>;
  image_analysis: {
    current_quality: "buena" | "regular" | "mala";
    needs_more_images: boolean;
    suggested_alt_texts: string[];
  };
}

const SYSTEM_PROMPT = `Eres un experto en SEO y e-commerce especializado en productos de tecnologia para el mercado de Costa Rica. Tu trabajo es enriquecer fichas de productos para la tienda smart.cr.

REGLAS ESTRICTAS:
1. NUNCA incluyas informacion de precios, costos, descuentos o valores monetarios
2. Escribe todo en espanol de Costa Rica
3. Las descripciones deben ser HTML valido con parrafos, listas, y negritas
4. Solo incluye metafields que puedas confirmar con los datos proporcionados
5. Si no tenes certeza sobre un dato especifico, dejalo como null
6. IMPORTANTE sobre confidence_score:
   - Si el titulo del producto identifica claramente la marca y modelo (ej: "Nexxt Patch Cord Cat6"), asigna >= 0.7
   - Si ademas tenes datos de busqueda web, asigna >= 0.8
   - Solo asigna < 0.5 si el producto es completamente generico sin marca ni modelo identificable
   - Para productos de tecnologia con marca conocida, la confianza minima debe ser 0.6

FORMATO DE RESPUESTA:
Responde UNICAMENTE con un objeto JSON valido, sin markdown, sin comentarios.`;

function buildUserPrompt(
  product: ShopifyProduct,
  searchResults: SearchResult[],
): string {
  const firstVariant = product.variants.edges[0]?.node;
  const currentMetafields = product.metafields.edges
    .filter((e) => e.node.namespace === "custom")
    .map((e) => `  ${e.node.key}: ${e.node.value}`)
    .join("\n");

  const searchSection =
    searchResults.length > 0
      ? searchResults
          .map((r) => `- ${r.title}: ${r.snippet}`)
          .join("\n")
      : "No se encontro informacion adicional";

  return `Necesito que enriquezcas la siguiente ficha de producto para la tienda smart.cr (tecnologia en Costa Rica).

## DATOS ACTUALES DEL PRODUCTO:
- Titulo: ${product.title}
- Descripcion actual: ${product.descriptionHtml || "VACIA"}
- Tipo: ${product.productType || "SIN TIPO"}
- Vendor/Marca: ${product.vendor}
- Tags actuales: ${product.tags.length > 0 ? product.tags.join(", ") : "NINGUNO"}
- SKU: ${firstVariant?.sku || "SIN SKU"}
- Imagenes actuales: ${product.images.edges.length} imagenes
- Categoria Shopify: ${product.category?.fullName || "SIN CATEGORIA"}

## DATOS ENCONTRADOS POR BUSQUEDA WEB:
${searchSection}

## METAFIELDS ACTUALES:
${currentMetafields || "NINGUNO"}

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
- NUNCA incluyas precio, costo, o valores monetarios`;
}

export async function callGemini(
  product: ShopifyProduct,
  searchResults: SearchResult[],
): Promise<{ response: GeminiEnrichmentResponse; raw: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const userPrompt = buildUserPrompt(product, searchResults);
  const fullPrompt = SYSTEM_PROMPT + "\n\n" + userPrompt;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE",
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE",
      },
    ],
  };

  let lastError: Error | null = null;
  const retryDelays = [2000, 4000, 8000, 16000];

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        },
      );

      if (response.status === 429) {
        const delay = retryDelays[attempt];
        if (delay) {
          console.warn(
            `[gemini] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`,
          );
          await sleep(delay);
          continue;
        }
        throw new Error("Gemini rate limit exceeded after retries");
      }

      if (response.status >= 500) {
        const delay = retryDelays[attempt];
        if (delay) {
          console.warn(
            `[gemini] Server error ${response.status}, retrying in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`Gemini server error: ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const json = await response.json();
      const rawText =
        json.candidates?.[0]?.content?.parts?.[0]?.text || "";

      let parsed: GeminiEnrichmentResponse;
      try {
        parsed = JSON.parse(rawText) as GeminiEnrichmentResponse;
      } catch {
        // Attempt to repair truncated JSON by closing open strings/objects
        const repaired = repairTruncatedJson(rawText);
        if (repaired) {
          console.warn("[gemini] Repaired truncated JSON response");
          parsed = repaired as unknown as GeminiEnrichmentResponse;
        } else {
          throw new Error(`Gemini returned invalid JSON (${rawText.length} chars): ${rawText.slice(-100)}`);
        }
      }
      return { response: parsed, raw: rawText };
    } catch (error) {
      lastError = error as Error;

      if (
        (error as Error).message?.includes("invalid JSON")
      ) {
        throw error;
      }

      const delay = retryDelays[attempt];
      if (delay && attempt < retryDelays.length) {
        console.warn(
          `[gemini] Error, retrying in ${delay}ms:`,
          (error as Error).message,
        );
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError || new Error("Gemini call failed after retries");
}

const VALID_METAFIELD_KEYS = new Set([
  "custom.memoria_ram",
  "custom.almacenamiento",
  "custom.procesador_marca",
  "custom.procesador_tipo",
  "custom.pantalla",
  "custom.color",
  "custom.conectividad",
  "custom.peso",
  "custom.dimensiones",
  "custom.bateria",
  "custom.garantia",
  "custom.sistema_operativo",
  "custom.resolucion",
  "custom.modelo",
  "custom.numero_parte",
]);

const FORBIDDEN_TERMS = [
  "\\bprecio(s)?\\b",
  "\\bcosto(s)?\\b",
  "\\$\\s*\\d",       // Dollar sign followed by digit (monetary values)
  "\\bcolones\\b",
  "\\bdolares\\b",
  "₡",
  "\\busd\\b",
  "\\bcost\\b",       // Word boundary prevents matching "Costa Rica"
  "\\bprice(s)?\\b",
];

const FORBIDDEN_REGEX = new RegExp(FORBIDDEN_TERMS.join("|"), "i");

export function validateGeminiResponse(
  response: GeminiEnrichmentResponse,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Confidence score range
  if (
    typeof response.confidence_score !== "number" ||
    response.confidence_score < 0 ||
    response.confidence_score > 1
  ) {
    errors.push("confidence_score must be a number between 0 and 1");
  }

  // 2. Description non-empty and no scripts
  if (!response.description_html?.trim()) {
    errors.push("description_html is empty");
  } else if (/<script/i.test(response.description_html)) {
    errors.push("description_html contains script tags");
  }

  // 3. Tags array
  if (!Array.isArray(response.tags) || response.tags.length < 1) {
    errors.push("tags must be a non-empty array");
  }

  // 4. No price/cost info anywhere
  const allText = JSON.stringify(response);
  if (FORBIDDEN_REGEX.test(allText)) {
    errors.push("CRITICAL: Response contains price/cost information");
  }

  // 5. Valid metafield keys
  if (response.metafields) {
    for (const key of Object.keys(response.metafields)) {
      if (!VALID_METAFIELD_KEYS.has(key)) {
        errors.push(`Invalid metafield key: ${key}`);
      }
    }
  }

  // 6. SEO limits - truncate instead of rejecting
  if (response.seo_title && response.seo_title.length > 70) {
    response.seo_title = response.seo_title.slice(0, 70);
  }
  if (response.seo_description && response.seo_description.length > 160) {
    response.seo_description = response.seo_description.slice(0, 160);
  }

  // 7. HTML sanitization check
  if (
    response.description_html &&
    /<(style|onclick|onerror)/i.test(response.description_html)
  ) {
    errors.push("description_html contains unsafe content");
  }

  return { valid: errors.length === 0, errors };
}

function repairTruncatedJson(text: string): Record<string, unknown> | null {
  // Try progressively removing trailing content to find valid JSON
  let attempt = text.trimEnd();

  // Close any unterminated strings
  const quoteCount = (attempt.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    attempt += '"';
  }

  // Close open arrays and objects
  const openBrackets: string[] = [];
  let inString = false;
  for (let i = 0; i < attempt.length; i++) {
    const ch = attempt[i];
    if (ch === '"' && (i === 0 || attempt[i - 1] !== '\\')) {
      inString = !inString;
    }
    if (inString) continue;
    if (ch === '{') openBrackets.push('}');
    else if (ch === '[') openBrackets.push(']');
    else if (ch === '}' || ch === ']') openBrackets.pop();
  }

  // Remove trailing comma before closing
  attempt = attempt.replace(/,\s*$/, '');
  // Close all open brackets
  attempt += openBrackets.reverse().join('');

  try {
    return JSON.parse(attempt) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
