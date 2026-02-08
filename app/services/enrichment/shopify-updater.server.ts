import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { GeminiEnrichmentResponse } from "./gemini.server";
import {
  updateProduct,
  setMetafields,
  addProductImages,
} from "../shopify/mutations.server";
import sanitizeHtml from "sanitize-html";

const ALLOWED_HTML_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "span",
  "div",
  "table",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
];

export interface UpdateResult {
  productUpdated: boolean;
  metafieldsUpdated: boolean;
  imagesAdded: boolean;
  errors: string[];
}

export async function applyEnrichment(
  admin: AdminApiContext,
  productId: string,
  enrichment: GeminiEnrichmentResponse,
  existingTags: string[],
  imageUrls?: string[],
): Promise<UpdateResult> {
  const errors: string[] = [];
  let productUpdated = false;
  let metafieldsUpdated = false;
  let imagesAdded = false;

  // 1. Update product fields (description, type, tags, SEO)
  // NEVER modify vendor/proveedor - only Shopify admin should change it
  const cleanHtml = sanitizeHtml(enrichment.description_html, {
    allowedTags: ALLOWED_HTML_TAGS,
    allowedAttributes: {
      span: ["class"],
      div: ["class"],
    },
  });

  // Merge existing tags with AI-suggested tags (preserve all existing, add new ones)
  const existingLower = new Set(existingTags.map((t) => t.toLowerCase()));
  const newTags = (enrichment.tags || []).filter(
    (t) => !existingLower.has(t.toLowerCase()),
  );
  const mergedTags = [...existingTags, ...newTags];

  console.log(
    `[updater] Tags: ${existingTags.length} existing + ${newTags.length} new = ${mergedTags.length} total`,
  );

  const productResult = await updateProduct(admin, {
    id: productId,
    descriptionHtml: cleanHtml,
    productType: enrichment.product_type || undefined,
    tags: mergedTags,
    seo: {
      title: enrichment.seo_title || undefined,
      description: enrichment.seo_description || undefined,
    },
  });

  if (productResult.success) {
    productUpdated = true;
  } else {
    errors.push(...productResult.errors);
  }

  // 2. Set metafields
  const metafieldInputs = Object.entries(enrichment.metafields || {})
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      const [namespace, metaKey] = key.split(".");
      const isDecimal = metaKey === "peso";
      return {
        ownerId: productId,
        namespace: namespace || "custom",
        key: metaKey || key,
        value: String(value),
        type: isDecimal ? "number_decimal" : "single_line_text_field",
      };
    });

  if (metafieldInputs.length > 0) {
    const metaResult = await setMetafields(admin, metafieldInputs);
    if (metaResult.success) {
      metafieldsUpdated = true;
    } else {
      errors.push(...metaResult.errors);
    }
  }

  // 3. Add images if provided
  if (imageUrls && imageUrls.length > 0) {
    const altTexts = enrichment.image_analysis?.suggested_alt_texts || [];
    const imageInputs = imageUrls.map((url, i) => ({
      originalSource: url,
      alt:
        altTexts[i] ||
        `${enrichment.product_type || "Producto"} - imagen ${i + 1}`,
    }));

    const imageResult = await addProductImages(
      admin,
      productId,
      imageInputs,
    );
    if (imageResult.success) {
      imagesAdded = true;
    } else {
      errors.push(...imageResult.errors);
    }
  }

  return { productUpdated, metafieldsUpdated, imagesAdded, errors };
}
