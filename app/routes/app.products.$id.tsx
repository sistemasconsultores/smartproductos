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
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { GeminiEnrichmentResponse } from "../services/enrichment/gemini.server";

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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const logId = params.id;

  if (!logId) {
    return json({ error: "ID requerido" }, { status: 400 });
  }

  // Forward to the approve API
  const response = await fetch(
    new URL("/api/approve", request.url).toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: request.headers.get("Cookie") || "",
      },
      body: JSON.stringify({
        logId,
        action: intent === "approve" ? "approve" : "reject",
      }),
    },
  );

  return response;
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
