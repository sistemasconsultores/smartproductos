import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Layout, BlockStack, Banner, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StatsCards } from "../components/StatsCards";
import { EnrichmentProgress } from "../components/EnrichmentProgress";
import { enqueueBatchEnrichment } from "../services/queue/enrichment.queue.server";

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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "enrich") {
    const jobId = await enqueueBatchEnrichment(session.shop, "MANUAL");
    return json({ success: true, jobId });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function Dashboard() {
  const { stats, latestRun } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleEnrich = () => {
    submit({ intent: "enrich" }, { method: "post" });
  };

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
              <Button
                variant="primary"
                onClick={handleEnrich}
                loading={isSubmitting}
              >
                Ejecutar enriquecimiento manual
              </Button>

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

              {stats.pendingCount > 0 && (
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
