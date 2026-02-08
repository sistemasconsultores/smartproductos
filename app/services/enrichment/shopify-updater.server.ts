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
    .reduce<Array<{ ownerId: string; namespace: string; key: string; value: string; type: string }>>((acc, [key, value]) => {
      // Handle keys with or without namespace prefix (e.g. "custom.modelo" or "modelo")
      const parts = key.split(".");
      const namespace = parts.length > 1 ? parts[0] : "custom";
      const metaKey = parts.length > 1 ? parts[1] : parts[0];

      if (metaKey === "peso") {
        // peso is number_decimal in Shopify - clean the value
        const raw = String(value);
        const cleaned = raw.replace(/,/g, ".").replace(/[^\d.]/g, "").trim();
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed) && isFinite(parsed)) {
          acc.push({ ownerId: productId, namespace, key: metaKey, value: parsed.toString(), type: "number_decimal" });
        } else {
          console.warn(`[updater] Skipping peso metafield - unparseable decimal: "${raw}"`);
        }
        return acc;
      }

      acc.push({
        ownerId: productId,
        namespace,
        key: metaKey,
        value: String(value),
        type: "single_line_text_field",
      });
      return acc;
    }, []);

  if (metafieldInputs.length > 0) {
    const metaResult = await setMetafields(admin, metafieldInputs);
    if (metaResult.success) {
      metafieldsUpdated = true;
    } else if (metafieldInputs.length > 1) {
      // Batch failed - retry individual metafields so one bad one doesn't block all
      console.warn(`[updater] Batch metafields failed, retrying individually: ${metaResult.errors.join("; ")}`);
      let anySuccess = false;
      for (const mf of metafieldInputs) {
        const individual = await setMetafields(admin, [mf]);
        if (individual.success) {
          anySuccess = true;
        } else {
          errors.push(`${mf.namespace}.${mf.key}: ${individual.errors.join("; ")}`);
        }
      }
      if (anySuccess) metafieldsUpdated = true;
    } else {
      errors.push(...metaResult.errors);
    }
  }

  // 3. Add images if provided
  if (imageUrls && imageUrls.length > 0) {
    console.log(`[updater] Attempting to add ${imageUrls.length} images to ${productId}`);
    const altTexts = enrichment.image_analysis?.suggested_alt_texts || [];
    const imageInputs = imageUrls.map((url, i) => ({
      originalSource: url,
      alt:
        altTexts[i] ||
        `${enrichment.product_type || "Producto"} - imagen ${i + 1}`,
    }));

    // Try batch first
    const imageResult = await addProductImages(admin, productId, imageInputs);
    if (imageResult.success) {
      imagesAdded = true;
      console.log(`[updater] Successfully added ${imageInputs.length} images`);
    } else if (imageInputs.length > 1) {
      // Batch failed - retry individual images so one bad URL doesn't block all
      console.warn(`[updater] Batch image upload failed, retrying individually: ${imageResult.errors.join("; ")}`);
      let anySuccess = false;
      for (const img of imageInputs) {
        const individual = await addProductImages(admin, productId, [img]);
        if (individual.success) {
          anySuccess = true;
        } else {
          console.warn(`[updater] Failed to add image ${img.originalSource}: ${individual.errors.join("; ")}`);
        }
      }
      if (anySuccess) imagesAdded = true;
      if (!anySuccess) errors.push("All image uploads failed");
    } else {
      console.warn(`[updater] Image upload failed: ${imageResult.errors.join("; ")}`);
      errors.push(...imageResult.errors);
    }
  }

  return { productUpdated, metafieldsUpdated, imagesAdded, errors };
}
