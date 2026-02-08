// SmartEnrich Worker Entry Point
// Ejecutar como proceso separado: npm run worker
// Procesa jobs de BullMQ + cron diario integrado

// MUST import the Node adapter before anything that touches @shopify packages
// This sets up the abstractFetch implementation for the Shopify GraphQL client
import "@shopify/shopify-app-remix/adapters/node";

import { PrismaClient } from "@prisma/client";
import { createEnrichmentWorker } from "../app/services/queue/enrichment.worker.server";
import { setupCronJob } from "../app/services/queue/enrichment.queue.server";

const prisma = new PrismaClient();

const concurrency = Number(process.env.WORKER_CONCURRENCY || 3);
const cronEnabled = process.env.CRON_ENABLED !== "false";
const defaultCronSchedule = process.env.CRON_SCHEDULE || "0 2 * * *";

async function main() {
  console.log("=== SmartEnrich Worker ===");
  console.log(`Redis: ${process.env.REDIS_URL || "redis://localhost:6379/2"}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Cron enabled: ${cronEnabled}`);
  console.log(`Default cron: ${defaultCronSchedule}`);

  // Start the BullMQ worker
  const worker = createEnrichmentWorker(concurrency);
  console.log("[worker] BullMQ worker started");

  // Setup cron jobs from database configs
  if (cronEnabled) {
    await setupCronJobs();
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[worker] Shutting down gracefully...");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log("[worker] Ready and waiting for jobs...");
}

async function setupCronJobs() {
  try {
    // Get all shops with cron enabled
    const configs = await prisma.appConfig.findMany({
      where: { cronEnabled: true },
      select: { shop: true, cronSchedule: true },
    });

    if (configs.length === 0) {
      // No configs yet - use default schedule for the main shop
      const defaultShop = "smartcostarica.myshopify.com";
      console.log(
        `[cron] No configs found, setting default cron for ${defaultShop}`,
      );
      await setupCronJob(defaultShop, defaultCronSchedule);
    } else {
      for (const config of configs) {
        await setupCronJob(config.shop, config.cronSchedule);
      }
    }

    console.log(`[cron] ${Math.max(configs.length, 1)} cron job(s) registered`);
  } catch (error) {
    console.error("[cron] Failed to setup cron jobs:", error);
    // Non-fatal: worker can still process manual jobs
  }
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
