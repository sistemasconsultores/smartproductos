import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueBatchEnrichment } from "../services/queue/enrichment.queue.server";

// POST /api/enrich - Trigger batch enrichment
export const action = async ({ request }: ActionFunctionArgs) => {
  // Support both Shopify auth and API key auth
  const apiKey = request.headers.get("x-api-key");
  const internalKey = process.env.INTERNAL_API_KEY;

  let shop: string;

  if (apiKey && internalKey && apiKey === internalKey) {
    // External trigger (e.g., from webhook or external system)
    const body = await request.json();
    shop = body.shop || "smartcostarica.myshopify.com";
  } else {
    // Shopify embedded app auth
    const { session } = await authenticate.admin(request);
    shop = session.shop;
  }

  const url = new URL(request.url);
  const maxProducts = Number(url.searchParams.get("max") || 50);

  const jobId = await enqueueBatchEnrichment(shop, "MANUAL", maxProducts);

  return json({
    success: true,
    jobId,
    message: `Enrichment queued for ${shop} (max ${maxProducts} products)`,
  });
};

// GET /api/enrich - Check enrichment status
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const latestRun = await prisma.enrichmentRun.findFirst({
    where: { shop: session.shop },
    orderBy: { startedAt: "desc" },
    include: {
      logs: {
        select: {
          id: true,
          shopifyProductTitle: true,
          status: true,
          scoreBefore: true,
          scoreAfter: true,
          confidenceScore: true,
        },
        take: 20,
        orderBy: { processedAt: "desc" },
      },
    },
  });

  return json({ run: latestRun });
};
