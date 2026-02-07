import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enqueueEnrichment } from "../services/queue/enrichment.queue.server";

// POST /api/enrich/:id - Enrich a single product
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const productId = params.id;

  if (!productId) {
    return json({ error: "Product ID required" }, { status: 400 });
  }

  // Ensure it's a full GID
  const gid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  const jobId = await enqueueEnrichment({
    shop: session.shop,
    triggeredBy: "MANUAL",
    productId: gid,
  });

  return json({
    success: true,
    jobId,
    message: `Enrichment queued for product ${gid}`,
  });
};
