import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Badge,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const runs = await prisma.enrichmentRun.findMany({
    where: { shop: session.shop },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return json({ runs });
};

export default function History() {
  const { runs } = useLoaderData<typeof loader>();

  const statusBadge = (status: string) => {
    const map: Record<string, { tone: "success" | "info" | "warning" | "critical"; label: string }> = {
      RUNNING: { tone: "info", label: "En progreso" },
      COMPLETED: { tone: "success", label: "Completado" },
      FAILED: { tone: "critical", label: "Error" },
      CANCELLED: { tone: "warning", label: "Cancelado" },
    };
    const info = map[status] || { tone: "info" as const, label: status };
    return <Badge tone={info.tone}>{info.label}</Badge>;
  };

  const triggerLabel = (trigger: string) => {
    switch (trigger) {
      case "CRON":
        return "Automático";
      case "MANUAL":
        return "Manual";
      case "WEBHOOK":
        return "Webhook";
      default:
        return trigger;
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString("es-CR", {
      dateStyle: "short",
      timeStyle: "short",
    });

  const rowMarkup = runs.map((run, index) => (
    <IndexTable.Row id={run.id} key={run.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {formatDate(run.startedAt)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(run.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {triggerLabel(run.triggeredBy)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {run.totalProducts}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="success">
          {run.enrichedCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="critical">
          {run.failedCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {run.skippedCount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {run.completedAt ? formatDate(run.completedAt) : "—"}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page title="Historial de ejecuciones">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{
                singular: "ejecución",
                plural: "ejecuciones",
              }}
              itemCount={runs.length}
              selectable={false}
              headings={[
                { title: "Inicio" },
                { title: "Estado" },
                { title: "Trigger" },
                { title: "Total" },
                { title: "Enriquecidos" },
                { title: "Fallidos" },
                { title: "Omitidos" },
                { title: "Fin" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
