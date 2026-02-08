import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Badge,
  Text,
  useIndexResourceState,
  Pagination,
  BlockStack,
  InlineStack,
  Button,
  Filters,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useCallback } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page") || 1);
  const limit = 25;

  const where = {
    shop: session.shop,
    ...(statusFilter ? { status: statusFilter as never } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.enrichmentLog.findMany({
      where,
      orderBy: { processedAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
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
  ]);

  return json({ logs, total, page, limit });
};

export default function Products() {
  const { logs, total, page, limit } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  const currentStatus = searchParams.get("status") || "";

  const resourceName = {
    singular: "producto",
    plural: "productos",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(logs);

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

  const rowMarkup = logs.map((log, index) => (
    <IndexTable.Row
      id={log.id}
      key={log.id}
      selected={selectedResources.includes(log.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Link to={`/app/products/${log.id}`}>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {log.shopifyProductTitle}
          </Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {log.scoreBefore}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {log.scoreAfter ?? "—"}
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
          {new Date(log.processedAt).toLocaleDateString("es-CR")}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page title="Productos" subtitle={`${total} productos procesados`}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStack gap="200">
              <Button
                variant={currentStatus === "" ? "primary" : "tertiary"}
                onClick={() => filterByStatus("")}
                size="slim"
              >
                Todos
              </Button>
              <Button
                variant={currentStatus === "APPLIED" ? "primary" : "tertiary"}
                onClick={() => filterByStatus("APPLIED")}
                size="slim"
              >
                Aplicados
              </Button>
              <Button
                variant={currentStatus === "PENDING" ? "primary" : "tertiary"}
                onClick={() => filterByStatus("PENDING")}
                size="slim"
              >
                Pendientes
              </Button>
              <Button
                variant={currentStatus === "FAILED" ? "primary" : "tertiary"}
                onClick={() => filterByStatus("FAILED")}
                size="slim"
              >
                Fallidos
              </Button>
            </InlineStack>

            <Card padding="0">
              <IndexTable
                resourceName={resourceName}
                itemCount={logs.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Producto" },
                  { title: "Score antes" },
                  { title: "Score después" },
                  { title: "Confianza" },
                  { title: "Estado" },
                  { title: "Fecha" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>

            <InlineStack align="center">
              <Pagination
                hasPrevious={hasPrevious}
                hasNext={hasNext}
                onPrevious={() => goToPage(page - 1)}
                onNext={() => goToPage(page + 1)}
                label={`Página ${page} de ${totalPages}`}
              />
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
