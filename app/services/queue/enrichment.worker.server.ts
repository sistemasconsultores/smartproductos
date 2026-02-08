import { Worker, Job } from "bullmq";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { getRedis } from "../redis.server";
import prisma from "../../db.server";
import type { EnrichmentJobData } from "./enrichment.queue.server";

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

      // Get app config for this shop (use sensible defaults if none)
      const config = await prisma.appConfig.findUnique({
        where: { shop },
      });

      // Always auto-apply: override config to ensure products get applied automatically
      const autoApply = true;
      const minConfidence = config?.minConfidenceScore ?? 0.5;
      const maxProductsConfig = config?.maxProductsPerRun ?? 50;

      // Get offline session for Shopify API access (online sessions expire quickly)
      const session = await prisma.session.findFirst({
        where: { shop, isOnline: false },
      });

      if (!session?.accessToken) {
        // Log what sessions exist for debugging
        const allSessions = await prisma.session.findMany({
          where: { shop },
          select: { id: true, isOnline: true, scope: true, expires: true },
        });
        console.error(
          `[worker] No offline session for ${shop}. All sessions:`,
          JSON.stringify(allSessions),
        );
        throw new Error(`No valid offline session for shop: ${shop}`);
      }

      console.log(
        `[worker] Found session ${session.id}, isOnline: ${session.isOnline}, scope: ${session.scope?.slice(0, 50)}`,
      );

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
        maxProducts: maxProducts ?? maxProductsConfig,
        autoApply,
        minConfidence,
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
      lockDuration: 600000, // 10 minutes - processing 50 products takes several minutes
      stalledInterval: 300000, // Check stalled every 5 minutes (must be < lockDuration)
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
      error?.message ?? String(error),
    );
  });

  worker.on("error", (error) => {
    console.error("[worker] Worker error:", error);
  });

  return worker;
}
