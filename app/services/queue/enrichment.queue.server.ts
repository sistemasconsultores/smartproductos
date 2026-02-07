import { Queue } from "bullmq";
import { getRedis } from "../redis.server";

export interface EnrichmentJobData {
  shop: string;
  triggeredBy: "CRON" | "MANUAL" | "WEBHOOK";
  maxProducts?: number;
  productId?: string; // For single product enrichment
}

let enrichmentQueue: Queue<EnrichmentJobData> | null = null;

export function getEnrichmentQueue(): Queue<EnrichmentJobData> {
  if (!enrichmentQueue) {
    enrichmentQueue = new Queue<EnrichmentJobData>("enrichment", {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      },
    });
  }
  return enrichmentQueue;
}

export async function enqueueEnrichment(
  data: EnrichmentJobData,
): Promise<string> {
  const queue = getEnrichmentQueue();
  const job = await queue.add("enrich", data, {
    priority: data.productId ? 1 : 5, // Single product = higher priority
  });
  return job.id || "unknown";
}

export async function enqueueBatchEnrichment(
  shop: string,
  triggeredBy: EnrichmentJobData["triggeredBy"],
  maxProducts?: number,
): Promise<string> {
  return enqueueEnrichment({ shop, triggeredBy, maxProducts });
}

export async function setupCronJob(
  shop: string,
  cronSchedule: string,
): Promise<void> {
  const queue = getEnrichmentQueue();

  // Remove existing cron jobs for this shop
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === `cron:${shop}`) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Add new cron job
  await queue.add(
    `cron:${shop}`,
    {
      shop,
      triggeredBy: "CRON",
    },
    {
      repeat: {
        pattern: cronSchedule,
      },
    },
  );

  console.log(
    `[queue] Cron job registered for ${shop}: ${cronSchedule}`,
  );
}

export async function removeCronJob(shop: string): Promise<void> {
  const queue = getEnrichmentQueue();
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === `cron:${shop}`) {
      await queue.removeRepeatableByKey(job.key);
    }
  }
}
