import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Badge,
  Text,
  Pagination,
  BlockStack,
  InlineStack,
  Button,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useCallback } from "react";

const ITEMS_PER_PAGE = 25;

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

  const resourceName = {
    singular: "producto",
    plural: "productos",
  };

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
    });
  };

  const filterButtons: { label: string; value: string }[] = [
    { label: `Todos (${counts["ALL"] ?? 0})`, value: "" },
    { label: `Aplicados (${counts["APPLIED"] ?? 0})`, value: "APPLIED" },
    { label: `Pendientes (${counts["PENDING"] ?? 0})`, value: "PENDING" },
    { label: `Fallidos (${counts["FAILED"] ?? 0})`, value: "FAILED" },
    { label: `Omitidos (${counts["SKIPPED"] ?? 0})`, value: "SKIPPED" },
  ];

  const rowMarkup = logs.map((log, index) => (
    <IndexTable.Row
      id={log.id}
      key={log.id}
      position={index}
      onClick={() => navigate(`/app/products/${log.id}`)}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">
          {log.shopifyProductTitle.length > 65
            ? log.shopifyProductTitle.substring(0, 65) + "..."
            : log.shopifyProductTitle}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {log.scoreBefore}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {log.confidenceScore
            ? `${Math.round(log.confidenceScore * 100)}%`
            : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(log.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {formatDate(log.processedAt)}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page title="Productos" subtitle={`${total} productos procesados`}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
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

            <Card padding="0">
              {logs.length === 0 ? (
                <Box padding="800">
                  <BlockStack align="center" inlineAlign="center">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No se encontraron productos con este filtro.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <IndexTable
                  resourceName={resourceName}
                  itemCount={logs.length}
                  selectable={false}
                  headings={[
                    { title: "Producto" },
                    { title: "Score" },
                    { title: "Confianza" },
                    { title: "Estado" },
                    { title: "Fecha" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>

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
