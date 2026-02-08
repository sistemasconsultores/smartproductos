import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Badge,
  Text,
  Pagination,
  BlockStack,
  InlineStack,
  Button,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useCallback } from "react";

const ITEMS_PER_PAGE = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page") || 1);

  const baseWhere = { shop: session.shop };
  const where = {
    ...baseWhere,
    ...(statusFilter ? { status: statusFilter as never } : {}),
  };

  const [logs, total, statusCounts] = await Promise.all([
    prisma.enrichmentLog.findMany({
      where,
      orderBy: { processedAt: "desc" },
      take: ITEMS_PER_PAGE,
      skip: (page - 1) * ITEMS_PER_PAGE,
      select: {
        id: true,
        shopifyProductId: true,
        shopifyProductTitle: true,
        scoreBefore: true,
        scoreAfter: true,
        status: true,
        confidenceScore: true,
        processedAt: true,
      },
    }),
    prisma.enrichmentLog.count({ where }),
    prisma.enrichmentLog.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { status: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  let totalAll = 0;
  for (const group of statusCounts) {
    counts[group.status] = group._count.status;
    totalAll += group._count.status;
  }
  counts["ALL"] = totalAll;

  return json({ logs, total, page, counts });
};

export default function Products() {
  const { logs, total, page, counts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  const currentStatus = searchParams.get("status") || "";

  const statusBadge = (status: string) => {
    const map: Record<string, { tone: "success" | "info" | "warning" | "critical"; label: string }> = {
      APPLIED: { tone: "success", label: "Aplicado" },
      PENDING: { tone: "info", label: "Pendiente" },
      APPROVED: { tone: "info", label: "Aprobado" },
      REJECTED: { tone: "warning", label: "Rechazado" },
      FAILED: { tone: "critical", label: "Error" },
      SKIPPED: { tone: "warning", label: "Omitido" },
    };
    const info = map[status] || { tone: "info" as const, label: status };
    return <Badge tone={info.tone}>{info.label}</Badge>;
  };

  const goToPage = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", String(newPage));
      navigate(`/app/products?${params.toString()}`);
    },
    [navigate, searchParams],
  );

  const filterByStatus = useCallback(
    (status: string) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      params.set("page", "1");
      navigate(`/app/products?${params.toString()}`);
    },
    [navigate],
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("es-CR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const truncate = (text: string, maxLen: number) =>
    text.length > maxLen ? text.substring(0, maxLen) + "..." : text;

  const filterButtons: { label: string; value: string }[] = [
    { label: `Todos (${counts["ALL"] ?? 0})`, value: "" },
    { label: `Aplicados (${counts["APPLIED"] ?? 0})`, value: "APPLIED" },
    { label: `Pendientes (${counts["PENDING"] ?? 0})`, value: "PENDING" },
    { label: `Fallidos (${counts["FAILED"] ?? 0})`, value: "FAILED" },
    { label: `Omitidos (${counts["SKIPPED"] ?? 0})`, value: "SKIPPED" },
  ];

  return (
    <Page title="Productos" subtitle={`${total} productos procesados`}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Status filter buttons with counts */}
            <InlineStack gap="200" wrap>
              {filterButtons.map((btn) => (
                <Button
                  key={btn.value}
                  variant={currentStatus === btn.value ? "primary" : "tertiary"}
                  onClick={() => filterByStatus(btn.value)}
                  size="slim"
                >
                  {btn.label}
                </Button>
              ))}
            </InlineStack>

            {/* Product list */}
            <Card padding="0">
              {/* Table header */}
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 140px", gap: "8px", alignItems: "center" }}>
                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                    Producto
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                    Score
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                    Confianza
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                    Estado
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                    Fecha
                  </Text>
                </div>
              </div>

              {/* Scrollable rows */}
              <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
                {logs.length === 0 ? (
                  <Box padding="800">
                    <BlockStack align="center" inlineAlign="center">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No se encontraron productos con este filtro.
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  logs.map((log, index) => (
                    <div key={log.id}>
                      <Link
                        to={`/app/products/${log.id}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 80px 80px 100px 140px",
                            gap: "8px",
                            alignItems: "center",
                            padding: "10px 16px",
                            cursor: "pointer",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--p-color-bg-surface-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {truncate(log.shopifyProductTitle, 60)}
                            </Text>
                          </div>
                          <Text as="span" variant="bodySm">
                            {log.scoreBefore}
                          </Text>
                          <Text as="span" variant="bodySm">
                            {log.confidenceScore
                              ? `${Math.round(log.confidenceScore * 100)}%`
                              : "—"}
                          </Text>
                          <div>{statusBadge(log.status)}</div>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {formatDate(log.processedAt)}
                          </Text>
                        </div>
                      </Link>
                      {index < logs.length - 1 && <Divider />}
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={hasPrevious}
                  hasNext={hasNext}
                  onPrevious={() => goToPage(page - 1)}
                  onNext={() => goToPage(page + 1)}
                  label={`Pagina ${page} de ${totalPages} (${total} productos)`}
                />
              </InlineStack>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
