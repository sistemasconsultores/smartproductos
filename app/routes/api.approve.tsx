import type { ActionFunctionArgs } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { applyEnrichment } from "../services/enrichment/shopify-updater.server";
import type { GeminiEnrichmentResponse } from "../services/enrichment/gemini.server";

// POST /api/approve - Approve or reject enrichment proposals
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  const { logId, action: approvalAction } = body as {
    logId: string;
    action: "approve" | "reject";
  };

  if (!logId || !approvalAction) {
    return json(
      { error: "logId and action (approve|reject) required" },
      { status: 400 },
    );
  }

  const log = await prisma.enrichmentLog.findUnique({
    where: { id: logId },
  });

  if (!log) {
    return json({ error: "Log not found" }, { status: 404 });
  }

  if (log.shop !== session.shop) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  if (log.status !== "PENDING") {
    return json(
      { error: `Cannot ${approvalAction} a log with status: ${log.status}` },
      { status: 400 },
    );
  }

  if (approvalAction === "reject") {
    await prisma.enrichmentLog.update({
      where: { id: logId },
      data: { status: "REJECTED" },
    });
    return json({ success: true, status: "REJECTED" });
  }

  // Apply the proposed changes
  const enrichment = log.proposedChanges as unknown as GeminiEnrichmentResponse;
  if (!enrichment) {
    return json({ error: "No proposed changes found" }, { status: 400 });
  }

  const result = await applyEnrichment(
    admin,
    log.shopifyProductId,
    enrichment,
  );

  if (result.errors.length > 0) {
    await prisma.enrichmentLog.update({
      where: { id: logId },
      data: {
        status: "FAILED",
        errorMessage: result.errors.join("; "),
      },
    });
    return json({
      success: false,
      errors: result.errors,
    });
  }

  await prisma.enrichmentLog.update({
    where: { id: logId },
    data: {
      status: "APPLIED",
      appliedChanges: enrichment as unknown as Prisma.InputJsonValue,
      approvedAt: new Date(),
      appliedAt: new Date(),
    },
  });

  return json({ success: true, status: "APPLIED" });
};
