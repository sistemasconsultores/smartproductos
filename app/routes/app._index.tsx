import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { Page, Layout, BlockStack, Banner, Button, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StatsCards } from "../components/StatsCards";
import { EnrichmentProgress } from "../components/EnrichmentProgress";
import { enqueueBatchEnrichment } from "../services/queue/enrichment.queue.server";
import { applyEnrichment } from "../services/enrichment/shopify-updater.server";
import { fetchSingleProduct } from "../services/shopify/queries.server";
import type { GeminiEnrichmentResponse } from "../services/enrichment/gemini.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get stats
  const [totalLogs, statusCounts, latestRun] = await Promise.all([
    prisma.enrichmentLog.count({ where: { shop } }),
    prisma.enrichmentLog.groupBy({
      by: ["status"],
      where: { shop },
      _count: true,
    }),
    prisma.enrichmentRun.findFirst({
      where: { shop },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const countByStatus = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count]),
  );

  return json({
    stats: {
      totalProducts: totalLogs,
      enrichedCount: (countByStatus["APPLIED"] || 0) + (countByStatus["APPROVED"] || 0),
      pendingCount: countByStatus["PENDING"] || 0,
      failedCount: countByStatus["FAILED"] || 0,
    },
    latestRun,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "enrich") {
    const jobId = await enqueueBatchEnrichment(session.shop, "MANUAL");
    return json({ success: true, jobId });
  }

  if (intent === "bulk-approve") {
    const pendingLogs = await prisma.enrichmentLog.findMany({
      where: { shop: session.shop, status: "PENDING" },
    });

    let applied = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const log of pendingLogs) {
      const enrichment = log.proposedChanges as unknown as GeminiEnrichmentResponse;
      if (!enrichment) {
        failed++;
        continue;
      }

      // Fetch current product tags from Shopify to merge (not replace)
      const product = await fetchSingleProduct(admin, log.shopifyProductId);
      const existingTags = product?.tags ?? [];

      const result = await applyEnrichment(admin, log.shopifyProductId, enrichment, existingTags);

      if (result.errors.length === 0) {
        await prisma.enrichmentLog.update({
          where: { id: log.id },
          data: {
            status: "APPLIED",
            appliedChanges: enrichment as unknown as Prisma.InputJsonValue,
            approvedAt: new Date(),
            appliedAt: new Date(),
          },
        });
        applied++;
      } else {
        await prisma.enrichmentLog.update({
          where: { id: log.id },
          data: {
            status: "FAILED",
            errorMessage: result.errors.join("; "),
          },
        });
        failed++;
        errors.push(`${log.shopifyProductTitle}: ${result.errors.join("; ")}`);
      }
    }

    return json({ success: true, bulkResult: { applied, failed, total: pendingLogs.length, errors } });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function Dashboard() {
  const { stats, latestRun } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleEnrich = () => {
    submit({ intent: "enrich" }, { method: "post" });
  };

  const handleBulkApprove = () => {
    submit({ intent: "bulk-approve" }, { method: "post" });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bulkResult = (actionData as any)?.bulkResult;

  return (
    <Page title="SmartEnrich Dashboard">
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <StatsCards
              totalProducts={stats.totalProducts}
              enrichedCount={stats.enrichedCount}
              pendingCount={stats.pendingCount}
              failedCount={stats.failedCount}
            />
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="400">
              <InlineStack gap="300">
                <Button
                  variant="primary"
                  onClick={handleEnrich}
                  loading={isSubmitting}
                >
                  Ejecutar enriquecimiento manual
                </Button>

                {stats.pendingCount > 0 && (
                  <Button
                    variant="primary"
                    tone="success"
                    onClick={handleBulkApprove}
                    loading={isSubmitting}
                  >
                    {`Aprobar todos (${stats.pendingCount} pendientes)`}
                  </Button>
                )}
              </InlineStack>

              {bulkResult && (
                <Banner
                  tone={bulkResult.failed === 0 ? "success" : "warning"}
                >
                  Aprobación masiva: {bulkResult.applied} aplicados, {bulkResult.failed} fallidos de {bulkResult.total} total.
                </Banner>
              )}

              {latestRun && (
                <EnrichmentProgress
                  status={latestRun.status}
                  totalProducts={latestRun.totalProducts}
                  enrichedCount={latestRun.enrichedCount}
                  failedCount={latestRun.failedCount}
                  skippedCount={latestRun.skippedCount}
                  startedAt={latestRun.startedAt}
                  completedAt={latestRun.completedAt}
                />
              )}

              {stats.pendingCount > 0 && !bulkResult && (
                <Banner tone="warning">
                  Hay {stats.pendingCount} producto(s) pendientes de
                  aprobación.
                </Banner>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
