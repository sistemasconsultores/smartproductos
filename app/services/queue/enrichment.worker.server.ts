import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { getRedis } from "../redis.server";
import type { EnrichmentJobData } from "./enrichment.queue.server";

const prisma = new PrismaClient();

export function createEnrichmentWorker(
  concurrency: number = 3,
): Worker<EnrichmentJobData> {
  const worker = new Worker<EnrichmentJobData>(
    "enrichment",
    async (job: Job<EnrichmentJobData>) => {
      const { shop, triggeredBy, maxProducts, productId } = job.data;

      console.log(
        `[worker] Processing job ${job.id} for ${shop} (trigger: ${triggeredBy})`,
      );

      // Get app config for this shop
      const config = await prisma.appConfig.findUnique({
        where: { shop },
      });

      if (!config) {
        throw new Error(`No config found for shop: ${shop}`);
      }

      // Get session for Shopify API access
      const session = await prisma.session.findFirst({
        where: { shop },
        orderBy: { expires: "desc" },
      });

      if (!session?.accessToken) {
        throw new Error(`No valid session for shop: ${shop}`);
      }

      // Dynamic import to avoid bundling issues in worker context
      const { createAdminApiContext } = await import(
        "./worker-admin.server"
      );
      // Cast to expected type - worker admin context provides the same graphql interface
      const admin = createAdminApiContext(shop, session.accessToken) as unknown as AdminApiContext;

      const { runEnrichmentPipeline } = await import(
        "../enrichment/pipeline.server"
      );

      const result = await runEnrichmentPipeline(admin, {
        shop,
        triggeredBy: triggeredBy as "CRON" | "MANUAL" | "WEBHOOK",
        maxProducts: maxProducts ?? config.maxProductsPerRun,
        autoApply: config.autoApply,
        minConfidence: config.minConfidenceScore,
        productId: productId ?? undefined,
      });

      console.log(
        `[worker] Job ${job.id} complete: ${result.enrichedCount} enriched, ${result.failedCount} failed, ${result.skippedCount} skipped`,
      );

      return result;
    },
    {
      connection: getRedis(),
      concurrency,
      limiter: {
        max: 10,
        duration: 60000, // Max 10 jobs per minute (Gemini rate limiting)
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[worker] Job ${job?.id} failed:`,
      error.message,
    );
  });

  worker.on("error", (error) => {
    console.error("[worker] Worker error:", error);
  });

  return worker;
}
