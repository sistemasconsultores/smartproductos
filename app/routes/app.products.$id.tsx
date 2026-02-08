import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Box,
} from "@shopify/polaris";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { GeminiEnrichmentResponse } from "../services/enrichment/gemini.server";
import { applyEnrichment } from "../services/enrichment/shopify-updater.server";
import { fetchSingleProduct } from "../services/shopify/queries.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const logId = params.id;

  const log = await prisma.enrichmentLog.findUnique({
    where: { id: logId },
  });

  if (!log || log.shop !== session.shop) {
    throw new Response("No encontrado", { status: 404 });
  }

  return json({ log });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const logId = params.id;

  if (!logId) {
    return json({ error: "ID requerido" }, { status: 400 });
  }

  const log = await prisma.enrichmentLog.findUnique({
    where: { id: logId },
  });

  if (!log || log.shop !== session.shop) {
    return json({ error: "No encontrado" }, { status: 404 });
  }

  if (log.status !== "PENDING") {
    return json({ error: `No se puede procesar un log con estado: ${log.status}` }, { status: 400 });
  }

  if (intent === "reject") {
    await prisma.enrichmentLog.update({
      where: { id: logId },
      data: { status: "REJECTED" },
    });
    return json({ success: true, status: "REJECTED" });
  }

  // Apply the proposed changes
  const enrichment = log.proposedChanges as unknown as GeminiEnrichmentResponse;
  if (!enrichment) {
    return json({ error: "No hay cambios propuestos" }, { status: 400 });
  }

  // Fetch current product tags from Shopify to merge (not replace)
  const product = await fetchSingleProduct(admin, log.shopifyProductId);
  const existingTags = product?.tags ?? [];

  const result = await applyEnrichment(
    admin,
    log.shopifyProductId,
    enrichment,
    existingTags,
  );

  if (result.errors.length > 0) {
    await prisma.enrichmentLog.update({
      where: { id: logId },
      data: {
        status: "FAILED",
        errorMessage: result.errors.join("; "),
      },
    });
    return json({ success: false, errors: result.errors });
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

export default function ProductDetail() {
  const { log } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const original = log.originalData as Record<string, unknown>;
  const proposed =
    log.proposedChanges as unknown as GeminiEnrichmentResponse | null;

  const handleAction = (intent: string) => {
    submit({ intent }, { method: "post" });
  };

  const statusTone = () => {
    switch (log.status) {
      case "APPLIED":
        return "success" as const;
      case "PENDING":
        return "info" as const;
      case "FAILED":
        return "critical" as const;
      case "REJECTED":
        return "warning" as const;
      default:
        return undefined;
    }
  };

  return (
    <Page
      backAction={{ url: "/app/products" }}
      title={log.shopifyProductTitle}
      titleMetadata={
        <Badge tone={statusTone()}>
          {log.status === "APPLIED"
            ? "Aplicado"
            : log.status === "PENDING"
              ? "Pendiente"
              : log.status === "REJECTED"
                ? "Rechazado"
                : log.status === "FAILED"
                  ? "Error"
                  : log.status}
        </Badge>
      }
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Scores */}
            <Card>
              <InlineStack gap="600">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Score antes
                  </Text>
                  <Text as="p" variant="headingLg">
                    {log.scoreBefore}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Score después
                  </Text>
                  <Text as="p" variant="headingLg">
                    {log.scoreAfter ?? "—"}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Confianza IA
                  </Text>
                  <Text as="p" variant="headingLg">
                    {log.confidenceScore
                      ? `${Math.round(log.confidenceScore * 100)}%`
                      : "—"}
                  </Text>
                </BlockStack>
              </InlineStack>
            </Card>

            {/* Comparison */}
            {proposed && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    Descripción propuesta
                  </Text>
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <div
                      dangerouslySetInnerHTML={{
                        __html: proposed.description_html,
                      }}
                    />
                  </Box>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    Tipo de producto
                  </Text>
                  <Text as="p">
                    {(original.productType as string) || "—"} →{" "}
                    {proposed.product_type}
                  </Text>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    Tags
                  </Text>
                  <InlineStack gap="100">
                    {proposed.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </InlineStack>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    SEO
                  </Text>
                  <Text as="p" variant="bodySm">
                    Título: {proposed.seo_title}
                  </Text>
                  <Text as="p" variant="bodySm">
                    Descripción: {proposed.seo_description}
                  </Text>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    Metafields
                  </Text>
                  {Object.entries(proposed.metafields || {})
                    .filter(([, v]) => v !== null)
                    .map(([key, value]) => (
                      <InlineStack key={key} gap="200">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {key.replace("custom.", "")}:
                        </Text>
                        <Text as="span" variant="bodySm">
                          {value}
                        </Text>
                      </InlineStack>
                    ))}
                </BlockStack>
              </Card>
            )}

            {/* Actions */}
            {log.status === "PENDING" && (
              <InlineStack gap="300">
                <Button
                  variant="primary"
                  onClick={() => handleAction("approve")}
                  loading={isSubmitting}
                >
                  Aprobar y aplicar
                </Button>
                <Button
                  variant="secondary"
                  tone="critical"
                  onClick={() => handleAction("reject")}
                  loading={isSubmitting}
                >
                  Rechazar
                </Button>
              </InlineStack>
            )}

            {/* Error message */}
            {log.errorMessage && (
              <Card>
                <Text as="p" tone="critical">
                  Error: {log.errorMessage}
                </Text>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
