import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import {
  fetchProductsForEnrichment,
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
    // Step 1: Fetch un-enriched products (paginating past already-enriched ones)
    if (productId) {
      const product = await fetchSingleProduct(admin, productId);
      if (product) products = [product];
    } else {
      products = await fetchUnenrichedProducts(admin, shop, maxProducts);
    }

    await prisma.enrichmentRun.update({
      where: { id: run.id },
      data: { totalProducts: products.length },
    });

    if (products.length === 0) {
      console.log("[pipeline] No new products to enrich, run complete");
    } else {
      console.log(
        `[pipeline] First product to enrich: "${products[0].title}" (${products[0].id})`,
      );
    }

    // Process each product (update run counts after each one for real-time progress)
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
            originalData: productSnapshot(product),
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        });
      }

      // Update run counts in DB after each product so dashboard shows real-time progress
      await prisma.enrichmentRun.update({
        where: { id: run.id },
        data: { enrichedCount, failedCount, skippedCount },
      });
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

/**
 * Paginates through Shopify products (newest first) and skips already-enriched ones.
 * Continues paginating until we find `maxProducts` un-enriched products or run out of pages.
 * This prevents the pipeline from re-processing products and wasting API tokens.
 */
async function fetchUnenrichedProducts(
  admin: AdminApiContext,
  shop: string,
  maxProducts: number,
): Promise<ShopifyProduct[]> {
  const unenriched: ShopifyProduct[] = [];
  let cursor: string | undefined;
  let hasNextPage = true;
  let pagesScanned = 0;
  let totalFetched = 0;
  let totalSkippedEnriched = 0;

  while (hasNextPage && unenriched.length < maxProducts) {
    const { products, pageInfo } = await fetchProductsForEnrichment(
      admin,
      cursor,
      "status:active",
    );
    pagesScanned++;

    if (products.length === 0) break;

    const active = products.filter((p) => p.status === "ACTIVE");
    totalFetched += active.length;

    // Batch dedup: check which products in this page are already enriched
    const ids = active.map((p) => p.id);
    const existingLogs = await prisma.enrichmentLog.findMany({
      where: {
        shop,
        shopifyProductId: { in: ids },
        status: { in: ["APPLIED", "PENDING"] },
      },
      select: { shopifyProductId: true },
    });
    const alreadyDone = new Set(
      existingLogs.map((l) => l.shopifyProductId),
    );

    const newInPage = active.filter((p) => !alreadyDone.has(p.id));
    totalSkippedEnriched += alreadyDone.size;

    console.log(
      `[pipeline] Page ${pagesScanned}: ${active.length} active, ${alreadyDone.size} already enriched, ${newInPage.length} new`,
    );

    for (const product of newInPage) {
      unenriched.push(product);
      if (unenriched.length >= maxProducts) break;
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor ?? undefined;
  }

  console.log(
    `[pipeline] Scan complete: ${pagesScanned} page(s), ${totalFetched} products scanned, ${totalSkippedEnriched} already enriched, ${unenriched.length} to process`,
  );

  return unenriched;
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

  // Step 3: Search external data (title as primary, SKU/barcode as provider code auxiliaries)
  const firstVariant = product.variants.edges[0]?.node;
  const sku = firstVariant?.sku || null;
  const barcode = firstVariant?.barcode || null;

  const searchResults = await searchBySkuOrTitle(
    sku,
    product.title,
    product.vendor,
    barcode,
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
    console.log(
      `[pipeline] Image search for "${product.title}": ${imageResults.length} found, ${newImageUrls.length} selected (current images: ${analysis.imageCount})`,
    );
  } else {
    console.log(
      `[pipeline] Skipping image search for "${product.title}" (already has ${analysis.imageCount} images)`,
    );
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
      product.tags,
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

    // Store image URLs for reference (reusing deprecated barcodeData field)
    const imageData = newImageUrls.length > 0 ? newImageUrls : null;

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
        barcodeData: imageData as unknown as Prisma.InputJsonValue,
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

  // Save as pending for manual approval (store image URLs for later use)
  const imageData = newImageUrls.length > 0 ? newImageUrls : null;

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
      barcodeData: imageData as unknown as Prisma.InputJsonValue,
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
