import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  DataTable,
  Icon,
  Box,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ProductIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface SupplierData {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  lastProductCount: number | null;
  lastMargin: number | null;
  lastScrapeDuration: number | null;
  lastScrapeAt: string | null;
  lastScrapeStatus: string;
  lastErrorMessage: string | null;
  scraperRuns: Array<{
    id: string;
    status: string;
    productsScraped: number;
    productsCreated: number;
    productsUpdated: number;
    productsFailed: number;
    durationSeconds: number | null;
    averageMargin: number | null;
    syncStatus: string | null;
    syncProductsTotal: number;
    syncProductsDone: number;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
}

interface LoaderData {
  suppliers: SupplierData[];
  summary: {
    totalSuppliers: number;
    activeSuppliers: number;
    failedSuppliers: number;
    runningSuppliers: number;
    totalProducts: number;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const suppliers = await prisma.supplier.findMany({
    where: { shop },
    orderBy: { name: "asc" },
    include: {
      scraperRuns: {
        orderBy: { startedAt: "desc" },
        take: 10,
      },
    },
  });

  const totalProducts = suppliers.reduce(
    (sum, s) => sum + (s.lastProductCount || 0),
    0,
  );
  const activeSuppliers = suppliers.filter((s) => s.isActive).length;
  const failedSuppliers = suppliers.filter(
    (s) => s.lastScrapeStatus === "FAILED",
  ).length;
  const runningSuppliers = suppliers.filter(
    (s) => s.lastScrapeStatus === "RUNNING",
  ).length;

  return json({
    suppliers,
    summary: {
      totalSuppliers: suppliers.length,
      activeSuppliers,
      failedSuppliers,
      runningSuppliers,
      totalProducts,
    },
  });
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  return new Date(dateStr).toLocaleString("es-CR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "-";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatMargin(margin: number | null): string {
  if (margin === null || margin === undefined) return "-";
  return `${margin.toFixed(1)}%`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "RUNNING":
      return <Badge tone="info">Scrapeando</Badge>;
    case "COMPLETED":
      return <Badge tone="success">Completado</Badge>;
    case "FAILED":
      return <Badge tone="critical">Error</Badge>;
    case "IDLE":
      return <Badge>Inactivo</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function SyncBadge({ status }: { status: string | null }) {
  if (!status) return null;
  switch (status) {
    case "syncing":
      return <Badge tone="info">Sincronizando</Badge>;
    case "completed":
      return <Badge tone="success">Sincronizado</Badge>;
    case "failed":
      return <Badge tone="critical">Sync fallido</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export default function SuppliersPage() {
  const { suppliers, summary } = useLoaderData<LoaderData>();

  const failedSuppliers = suppliers.filter(
    (s) => s.lastScrapeStatus === "FAILED",
  );
  const runningSuppliers = suppliers.filter(
    (s) => s.lastScrapeStatus === "RUNNING",
  );

  // Alertas de errores recientes en cualquier run
  const recentErrors: Array<{ supplier: string; message: string; at: string }> =
    [];
  for (const supplier of suppliers) {
    // Error en el supplier directamente
    if (supplier.lastScrapeStatus === "FAILED" && supplier.lastErrorMessage) {
      recentErrors.push({
        supplier: supplier.name,
        message: supplier.lastErrorMessage,
        at: formatDate(supplier.lastScrapeAt),
      });
    }
    // Errores en runs recientes
    for (const run of supplier.scraperRuns) {
      if (
        run.status === "FAILED" &&
        run.errorMessage &&
        // Solo ultimas 48h
        new Date(run.startedAt).getTime() > Date.now() - 48 * 60 * 60 * 1000
      ) {
        recentErrors.push({
          supplier: supplier.name,
          message: run.errorMessage,
          at: formatDate(run.startedAt),
        });
      }
      if (run.syncStatus === "failed" && run.errorMessage) {
        recentErrors.push({
          supplier: supplier.name,
          message: `Sync: ${run.errorMessage}`,
          at: formatDate(run.completedAt),
        });
      }
    }
  }

  // Tabla de historial de runs recientes (todos los suppliers)
  const allRecentRuns = suppliers
    .flatMap((s) =>
      s.scraperRuns.map((r) => ({
        ...r,
        supplierName: s.name,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .slice(0, 20);

  const historyRows = allRecentRuns.map((run) => [
    run.supplierName,
    run.status,
    run.productsScraped.toLocaleString(),
    `${run.productsCreated}/${run.productsUpdated}/${run.productsFailed}`,
    formatDuration(run.durationSeconds),
    run.syncStatus || "-",
    formatDate(run.startedAt),
    run.errorMessage || "-",
  ]);

  return (
    <Page title="Proveedores - Dashboard de Scraping">
      <BlockStack gap="500">
        {/* Alertas de errores */}
        {recentErrors.length > 0 && (
          <Layout>
            <Layout.Section>
              <Banner
                title={`${recentErrors.length} alerta(s) de error en scraping`}
                tone="critical"
              >
                <BlockStack gap="200">
                  {recentErrors.map((err, i) => (
                    <Text key={i} as="p" variant="bodySm">
                      <Text as="span" fontWeight="bold">
                        {err.supplier}
                      </Text>{" "}
                      ({err.at}): {err.message}
                    </Text>
                  ))}
                </BlockStack>
              </Banner>
            </Layout.Section>
          </Layout>
        )}

        {/* Scraping en progreso */}
        {runningSuppliers.length > 0 && (
          <Layout>
            <Layout.Section>
              <Banner
                title={`${runningSuppliers.length} proveedor(es) scrapeando ahora`}
                tone="info"
              >
                <InlineStack gap="300">
                  {runningSuppliers.map((s) => (
                    <Badge key={s.id} tone="info">
                      {s.name}
                    </Badge>
                  ))}
                </InlineStack>
              </Banner>
            </Layout.Section>
          </Layout>
        )}

        {/* Resumen global */}
        <Layout>
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Icon source={ProductIcon} />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Proveedores activos
                    </Text>
                  </div>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {summary.activeSuppliers} / {summary.totalSuppliers}
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Icon source={CheckCircleIcon} />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Total productos scrapeados
                    </Text>
                  </div>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {summary.totalProducts.toLocaleString()}
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Icon source={RefreshIcon} />
                    <Text as="p" variant="bodySm" tone="subdued">
                      En progreso
                    </Text>
                  </div>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {summary.runningSuppliers}
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Icon source={AlertTriangleIcon} />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Con errores
                    </Text>
                  </div>
                  <Text
                    as="p"
                    variant="headingLg"
                    fontWeight="bold"
                    tone={summary.failedSuppliers > 0 ? "critical" : undefined}
                  >
                    {summary.failedSuppliers}
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>
        </Layout>

        {/* Cards por proveedor */}
        <Layout>
          <Layout.Section>
            <Text as="h2" variant="headingMd">
              Estado por proveedor
            </Text>
          </Layout.Section>
        </Layout>

        {suppliers.length === 0 ? (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300" inlineAlign="center">
                  <Text as="p" variant="bodySm" tone="subdued">
                    No hay proveedores registrados. Los proveedores aparecen
                    automaticamente cuando el scraper reporta su estado via POST
                    /api/scraper-status.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        ) : (
          <Layout>
            <Layout.Section>
              <InlineGrid
                columns={{ xs: 1, sm: 1, md: 2 }}
                gap="400"
              >
                {suppliers.map((supplier) => (
                  <SupplierCard key={supplier.id} supplier={supplier} />
                ))}
              </InlineGrid>
            </Layout.Section>
          </Layout>
        )}

        {/* Historial de runs recientes */}
        {allRecentRuns.length > 0 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Historial de ejecuciones recientes
                  </Text>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "numeric",
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Proveedor",
                      "Estado",
                      "Productos",
                      "Creados/Actual./Fallidos",
                      "Duracion",
                      "Sync",
                      "Fecha",
                      "Error",
                    ]}
                    rows={historyRows}
                    truncate
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}
      </BlockStack>
    </Page>
  );
}

function SupplierCard({ supplier }: { supplier: SupplierData }) {
  const latestRun =
    supplier.scraperRuns.length > 0 ? supplier.scraperRuns[0] : null;

  // Calcular tasa de exito de los ultimos runs
  const completedRuns = supplier.scraperRuns.filter(
    (r) => r.status === "COMPLETED",
  ).length;
  const totalRuns = supplier.scraperRuns.length;
  const successRate = totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;

  return (
    <Card>
      <BlockStack gap="300">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd" fontWeight="bold">
              {supplier.name}
            </Text>
            {!supplier.isActive && <Badge tone="warning">Inactivo</Badge>}
          </InlineStack>
          <StatusBadge status={supplier.lastScrapeStatus} />
        </InlineStack>

        <Divider />

        {/* Stats grid */}
        <InlineGrid columns={3} gap="400">
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              Productos
            </Text>
            <Text as="p" variant="headingSm" fontWeight="bold">
              {supplier.lastProductCount?.toLocaleString() || "-"}
            </Text>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              Margen prom.
            </Text>
            <Text as="p" variant="headingSm" fontWeight="bold">
              {formatMargin(supplier.lastMargin)}
            </Text>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              Duracion
            </Text>
            <Text as="p" variant="headingSm" fontWeight="bold">
              {formatDuration(supplier.lastScrapeDuration)}
            </Text>
          </BlockStack>
        </InlineGrid>

        {/* Ultimo scrape */}
        <InlineStack gap="200" blockAlign="center">
          <Icon source={ClockIcon} tone="subdued" />
          <Text as="p" variant="bodySm" tone="subdued">
            Ultimo scrape: {formatDate(supplier.lastScrapeAt)}
          </Text>
        </InlineStack>

        {/* Sync info del ultimo run */}
        {latestRun && latestRun.syncStatus && (
          <InlineStack gap="200" blockAlign="center">
            <SyncBadge status={latestRun.syncStatus} />
            {latestRun.syncProductsTotal > 0 && (
              <Text as="p" variant="bodySm" tone="subdued">
                {latestRun.syncProductsDone}/{latestRun.syncProductsTotal}{" "}
                sincronizados
              </Text>
            )}
            {(latestRun.productsCreated > 0 ||
              latestRun.productsUpdated > 0) && (
              <Text as="p" variant="bodySm">
                ({latestRun.productsCreated} nuevos,{" "}
                {latestRun.productsUpdated} actualizados)
              </Text>
            )}
          </InlineStack>
        )}

        {/* Tasa de exito */}
        {totalRuns > 1 && (
          <BlockStack gap="100">
            <InlineStack align="space-between">
              <Text as="p" variant="bodySm" tone="subdued">
                Tasa de exito (ultimas {totalRuns} ejecuciones)
              </Text>
              <Text as="p" variant="bodySm" fontWeight="bold">
                {successRate.toFixed(0)}%
              </Text>
            </InlineStack>
            <ProgressBar
              progress={successRate}
              size="small"
              tone={successRate >= 80 ? "success" : successRate >= 50 ? "highlight" : "critical"}
            />
          </BlockStack>
        )}

        {/* Error message */}
        {supplier.lastScrapeStatus === "FAILED" &&
          supplier.lastErrorMessage && (
            <Banner tone="critical">
              <Text as="p" variant="bodySm">
                {supplier.lastErrorMessage}
              </Text>
            </Banner>
          )}
      </BlockStack>
    </Card>
  );
}
