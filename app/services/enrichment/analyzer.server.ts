import type { ShopifyProduct } from "../shopify/queries.server";
import metafieldsConfig from "../../../config/metafields.json";

export interface ProductCompleteness {
  hasDescription: boolean;
  descriptionLength: number;
  hasImages: boolean;
  imageCount: number;
  imagesHaveAltText: boolean;
  hasProductType: boolean;
  hasCategory: boolean;
  hasVendor: boolean;
  hasTags: boolean;
  hasSKU: boolean;
  hasBarcode: boolean;
  hasSeoTitle: boolean;
  hasSeoDescription: boolean;
  metafieldsFilled: number;
  metafieldsTotal: number;
  completenessScore: number;
  fieldsToEnrich: string[];
}

const WEIGHTS = {
  description: 20,
  images: 15,
  productType: 5,
  category: 5,
  vendor: 3,
  tags: 7,
  sku: 5, // Increased from 3 (absorbed barcode's 2 points)
  seoTitle: 8,
  seoDescription: 7,
  metafields: 25,
};

export function analyzeCompleteness(
  product: ShopifyProduct,
): ProductCompleteness {
  const fieldsToEnrich: string[] = [];
  let score = 0;

  // Description (20 pts)
  const descriptionText = stripHtml(product.descriptionHtml || "");
  const hasDescription = descriptionText.length > 50;
  const descriptionLength = descriptionText.length;
  if (hasDescription) {
    const descScore =
      descriptionLength >= 300
        ? WEIGHTS.description
        : Math.round((descriptionLength / 300) * WEIGHTS.description);
    score += descScore;
  } else {
    fieldsToEnrich.push("description");
  }

  // Images (15 pts)
  const imageEdges = product.images.edges;
  const imageCount = imageEdges.length;
  const hasImages = imageCount > 0;
  const imagesHaveAltText =
    hasImages && imageEdges.every((e) => !!e.node.altText);

  if (hasImages) {
    const imageScore = Math.min(imageCount, 5) * 2; // up to 10 pts for quantity
    const altScore = imagesHaveAltText ? 5 : 0;
    score += Math.min(imageScore + altScore, WEIGHTS.images);
  } else {
    fieldsToEnrich.push("images");
  }
  if (!imagesHaveAltText && hasImages) {
    fieldsToEnrich.push("imageAltText");
  }

  // Product type (5 pts)
  const hasProductType = !!product.productType?.trim();
  if (hasProductType) {
    score += WEIGHTS.productType;
  } else {
    fieldsToEnrich.push("productType");
  }

  // Category (5 pts)
  const hasCategory = !!product.category?.fullName;
  if (hasCategory) {
    score += WEIGHTS.category;
  } else {
    fieldsToEnrich.push("category");
  }

  // Vendor (3 pts)
  const hasVendor = !!product.vendor?.trim();
  if (hasVendor) {
    score += WEIGHTS.vendor;
  } else {
    fieldsToEnrich.push("vendor");
  }

  // Tags (7 pts)
  const hasTags = product.tags.length >= 3;
  if (hasTags) {
    score += WEIGHTS.tags;
  } else {
    fieldsToEnrich.push("tags");
  }

  // SKU (3 pts)
  const firstVariant = product.variants.edges[0]?.node;
  const hasSKU = !!firstVariant?.sku?.trim();
  if (hasSKU) {
    score += WEIGHTS.sku;
  }

  // Barcode field not scored (used for provider references, not UPC)
  const hasBarcode = !!firstVariant?.barcode?.trim();

  // SEO Title (8 pts)
  const hasSeoTitle = !!product.seo?.title?.trim();
  if (hasSeoTitle) {
    score += WEIGHTS.seoTitle;
  } else {
    fieldsToEnrich.push("seoTitle");
  }

  // SEO Description (7 pts)
  const hasSeoDescription = !!product.seo?.description?.trim();
  if (hasSeoDescription) {
    score += WEIGHTS.seoDescription;
  } else {
    fieldsToEnrich.push("seoDescription");
  }

  // Metafields (25 pts)
  const existingMetafields = new Set(
    product.metafields.edges
      .filter((e) => e.node.namespace === "custom")
      .map((e) => e.node.key),
  );

  const metafieldsTotal = metafieldsConfig.metafields.length;
  let metafieldsFilled = 0;

  for (const mf of metafieldsConfig.metafields) {
    if (existingMetafields.has(mf.key)) {
      metafieldsFilled++;
    }
  }

  if (metafieldsTotal > 0) {
    score += Math.round(
      (metafieldsFilled / metafieldsTotal) * WEIGHTS.metafields,
    );
  }

  if (metafieldsFilled < metafieldsTotal) {
    fieldsToEnrich.push("metafields");
  }

  const completenessScore = Math.min(100, Math.max(0, score));

  return {
    hasDescription,
    descriptionLength,
    hasImages,
    imageCount,
    imagesHaveAltText,
    hasProductType,
    hasCategory,
    hasVendor,
    hasTags,
    hasSKU,
    hasBarcode,
    hasSeoTitle,
    hasSeoDescription,
    metafieldsFilled,
    metafieldsTotal,
    completenessScore,
    fieldsToEnrich,
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function shouldEnrich(
  analysis: ProductCompleteness,
  threshold: number = 80,
): boolean {
  return analysis.completenessScore < threshold;
}
