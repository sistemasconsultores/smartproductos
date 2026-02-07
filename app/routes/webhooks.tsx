import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enqueueEnrichment } from "../services/queue/enrichment.queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[webhook] Received ${topic} from ${shop}`);

  switch (topic) {
    case "PRODUCTS_CREATE": {
      const productId =
        (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id ||
        null;

      if (productId) {
        await enqueueEnrichment({
          shop,
          triggeredBy: "WEBHOOK",
          productId,
        });
        console.log(
          `[webhook] Enqueued enrichment for new product: ${productId}`,
        );
      }
      break;
    }

    case "PRODUCTS_UPDATE": {
      // Only re-enrich if update was NOT from SmartEnrich
      // Check via a simple flag in the tags or a short delay
      const productId =
        (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id ||
        null;

      if (productId) {
        console.log(`[webhook] Product updated: ${productId} (monitoring)`);
        // Don't auto-enqueue on updates to avoid loops
        // The daily cron will pick up products that need enrichment
      }
      break;
    }

    default:
      console.log(`[webhook] Unhandled topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
