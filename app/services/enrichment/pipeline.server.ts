import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import {
  fetchAllActiveProducts,
  fetchSingleProduct,
} from "../shopify/queries.server";
import type { ShopifyProduct } from "../shopify/queries.server";
import { analyzeCompleteness, shouldEnrich } from "./analyzer.server";
import { searchBySkuOrTitle } from "./web-search.server";
import { searchProductImages } from "./image-search.server";
import {
  callGemini,
  validateGeminiResponse,
} from "./gemini.server";
import type { GeminiEnrichmentResponse } from "./gemini.server";
import { applyEnrichment } from "./shopify-updater.server";
import type { TriggerType } from "@prisma/client";

export interface PipelineOptions {
  shop: string;
  triggeredBy: TriggerType;
  maxProducts?: number;
  autoApply?: boolean;
  minConfidence?: number;
  productId?: string; // Single product mode
}

export interface PipelineResult {
  runId: string;
  totalProducts: number;
  enrichedCount: number;
  failedCount: number;
  skippedCount: number;
}

export async function runEnrichmentPipeline(
  admin: AdminApiContext,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const {
    shop,
    triggeredBy,
    maxProducts = 50,
    autoApply = true,
    minConfidence = 0.5,
    productId,
  } = options;

  // Create run record
  const run = await prisma.enrichmentRun.create({
    data: {
      shop,
      triggeredBy,
      status: "RUNNING",
    },
  });

  let enrichedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let products: ShopifyProduct[] = [];

  try {
    // Step 1: Fetch products
    if (productId) {
      const product = await fetchSingleProduct(admin, productId);
      if (product) products = [product];
    } else {
      products = await fetchAllActiveProducts(admin, maxProducts);
    }

    // Step 1b: Filter out already-enriched products (APPLIED or PENDING)
    const existingLogs = await prisma.enrichmentLog.findMany({
      where: {
        shop,
        shopifyProductId: { in: products.map((p) => p.id) },
        status: { in: ["APPLIED", "PENDING"] },
      },
      select: { shopifyProductId: true },
    });
    const alreadyProcessed = new Set(
      existingLogs.map((l) => l.shopifyProductId),
    );
    const newProducts = products.filter(
      (p) => !alreadyProcessed.has(p.id),
    );

    console.log(
      `[pipeline] Fetched ${products.length} active products, ${alreadyProcessed.size} already enriched, ${newProducts.length} new to process`,
    );

    products = newProducts;

    await prisma.enrichmentRun.update({
      where: { id: run.id },
      data: { totalProducts: products.length },
    });

    if (products.length === 0) {
      console.log("[pipeline] No new products to enrich, run complete");
    }

    // Process each product
    for (const product of products) {
      try {
        const result = await processProduct(
          admin,
          product,
          run.id,
          shop,
          autoApply,
          minConfidence,
        );

        if (result === "enriched") enrichedCount++;
        else if (result === "skipped") skippedCount++;
        else if (result === "failed") failedCount++;
      } catch (error) {
        failedCount++;
        console.error(
          `[pipeline] Error processing ${product.id}:`,
          error,
        );

        await prisma.enrichmentLog.create({
          data: {
            runId: run.id,
            shop,
            shopifyProductId: product.id,
            shopifyProductTitle: product.title,
            scoreBefore: 0,
            status: "FAILED",
            originalData: {} as Prisma.InputJsonValue,
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    // Complete run
    await prisma.enrichmentRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        enrichedCount,
        failedCount,
        skippedCount,
      },
    });
  } catch (error) {
    await prisma.enrichmentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        enrichedCount,
        failedCount,
        skippedCount,
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
      },
    });

    throw error;
  }

  return {
    runId: run.id,
    totalProducts: products.length,
    enrichedCount,
    failedCount,
    skippedCount,
  };
}

async function processProduct(
  admin: AdminApiContext,
  product: ShopifyProduct,
  runId: string,
  shop: string,
  autoApply: boolean,
  minConfidence: number,
): Promise<"enriched" | "skipped" | "failed"> {
  // Skip non-active products (draft, archived)
  if (product.status !== "ACTIVE") {
    console.log(
      `[pipeline] Skipping non-active product ${product.id} (status: ${product.status})`,
    );
    return "skipped";
  }

  // Per-product dedup check: verify this product hasn't been enriched by a concurrent run
  const existingLog = await prisma.enrichmentLog.findFirst({
    where: {
      shop,
      shopifyProductId: product.id,
      status: { in: ["APPLIED", "PENDING"] },
    },
    select: { id: true },
  });
  if (existingLog) {
    console.log(
      `[pipeline] Skipping already-enriched product ${product.id} (dedup check)`,
    );
    return "skipped";
  }

  // Step 2: Analyze completeness
  const analysis = analyzeCompleteness(product);

  if (!shouldEnrich(analysis)) {
    await prisma.enrichmentLog.create({
      data: {
        runId,
        shop,
        shopifyProductId: product.id,
        shopifyProductTitle: product.title,
        scoreBefore: analysis.completenessScore,
        status: "SKIPPED",
        originalData: productSnapshot(product),
      },
    });
    return "skipped";
  }

  // Step 3: Search external data (barcode lookup removed - barcodes are provider references, not UPCs)
  const firstVariant = product.variants.edges[0]?.node;
  const sku = firstVariant?.sku || null;

  const searchResults = await searchBySkuOrTitle(
    sku,
    product.title,
    product.vendor,
  );

  // Search for images if needed
  let newImageUrls: string[] = [];
  if (analysis.imageCount < 3) {
    const imageResults = await searchProductImages(
      product.title,
      product.vendor,
      sku,
    );
    newImageUrls = imageResults.slice(0, 5).map((img) => img.url);
  }

  // Step 4: AI Process
  const { response: enrichment, raw: aiRaw } = await callGemini(
    product,
    searchResults,
  );

  // Parse confidence as number (Gemini may return string)
  const confidenceNum = Number(enrichment.confidence_score) || 0;

  // Step 5: Validate
  const validation = validateGeminiResponse(enrichment);
  if (!validation.valid) {
    console.log(
      `[pipeline] Validation FAILED for "${product.title}": ${validation.errors.join("; ")}`,
    );
    await prisma.enrichmentLog.create({
      data: {
        runId,
        shop,
        shopifyProductId: product.id,
        shopifyProductTitle: product.title,
        scoreBefore: analysis.completenessScore,
        status: "FAILED",
        originalData: productSnapshot(product),
        proposedChanges: enrichment as unknown as Prisma.InputJsonValue,
        aiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        aiResponseRaw: aiRaw,
        confidenceScore: confidenceNum,
        barcodeData: null,
        searchData: searchResults as unknown as Prisma.InputJsonValue,
        errorMessage: `Validation failed: ${validation.errors.join("; ")}`,
      },
    });
    return "failed";
  }

  // Step 6: Apply or save for approval
  const shouldAutoApply = autoApply && confidenceNum >= minConfidence;

  console.log(
    `[pipeline] Product "${product.title}" - autoApply: ${autoApply}, confidence: ${confidenceNum} (raw: ${enrichment.confidence_score}), threshold: ${minConfidence}, decision: ${shouldAutoApply ? "AUTO-APPLY" : "PENDING"}`,
  );

  if (shouldAutoApply) {
    const result = await applyEnrichment(
      admin,
      product.id,
      enrichment,
      newImageUrls.length > 0 ? newImageUrls : undefined,
    );

    if (result.errors.length > 0) {
      console.error(
        `[pipeline] Auto-apply FAILED for "${product.title}":`,
        result.errors,
      );
    } else {
      console.log(
        `[pipeline] Auto-apply SUCCESS for "${product.title}" (product: ${result.productUpdated}, metafields: ${result.metafieldsUpdated}, images: ${result.imagesAdded})`,
      );
    }

    await prisma.enrichmentLog.create({
      data: {
        runId,
        shop,
        shopifyProductId: product.id,
        shopifyProductTitle: product.title,
        scoreBefore: analysis.completenessScore,
        status: result.errors.length === 0 ? "APPLIED" : "FAILED",
        originalData: productSnapshot(product),
        proposedChanges: enrichment as unknown as Prisma.InputJsonValue,
        appliedChanges: enrichment as unknown as Prisma.InputJsonValue,
        confidenceScore: confidenceNum,
        aiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        aiResponseRaw: aiRaw,
        barcodeData: null,
        searchData: searchResults as unknown as Prisma.InputJsonValue,
        appliedAt: result.errors.length === 0 ? new Date() : undefined,
        errorMessage:
          result.errors.length > 0
            ? result.errors.join("; ")
            : undefined,
      },
    });

    return result.errors.length === 0 ? "enriched" : "failed";
  }

  // Save as pending for manual approval
  await prisma.enrichmentLog.create({
    data: {
      runId,
      shop,
      shopifyProductId: product.id,
      shopifyProductTitle: product.title,
      scoreBefore: analysis.completenessScore,
      status: "PENDING",
      originalData: productSnapshot(product),
      proposedChanges: enrichment as unknown as Prisma.InputJsonValue,
      confidenceScore: confidenceNum,
      aiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      aiResponseRaw: aiRaw,
      barcodeData: null,
      searchData: searchResults as unknown as Prisma.InputJsonValue,
    },
  });

  return "skipped"; // Not auto-applied, saved as PENDING
}

function productSnapshot(
  product: ShopifyProduct,
): Prisma.InputJsonValue {
  return {
    id: product.id,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    productType: product.productType,
    vendor: product.vendor,
    tags: product.tags,
    category: product.category?.fullName ?? null,
    seo: product.seo,
    imageCount: product.images.edges.length,
    metafields: Object.fromEntries(
      product.metafields.edges
        .filter((e) => e.node.namespace === "custom")
        .map((e) => [e.node.key, e.node.value]),
    ),
  };
}
