import { Card, Text, ProgressBar, BlockStack, InlineStack, Badge } from "@shopify/polaris";

interface EnrichmentProgressProps {
  status: string;
  totalProducts: number;
  enrichedCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string;
  completedAt: string | null;
}

export function EnrichmentProgress({
  status,
  totalProducts,
  enrichedCount,
  failedCount,
  skippedCount,
  startedAt,
  completedAt,
}: EnrichmentProgressProps) {
  const processed = enrichedCount + failedCount + skippedCount;
  const progress = totalProducts > 0 ? (processed / totalProducts) * 100 : 0;

  const statusBadge = () => {
    switch (status) {
      case "RUNNING":
        return <Badge tone="info">En progreso</Badge>;
      case "COMPLETED":
        return <Badge tone="success">Completado</Badge>;
      case "FAILED":
        return <Badge tone="critical">Error</Badge>;
      case "CANCELLED":
        return <Badge tone="warning">Cancelado</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("es-CR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h3" variant="headingSm">
            Progreso del enriquecimiento
          </Text>
          {statusBadge()}
        </InlineStack>

        <ProgressBar progress={progress} size="small" />

        <InlineStack gap="400">
          <Text as="span" variant="bodySm">
            {enrichedCount} enriquecidos
          </Text>
          <Text as="span" variant="bodySm">
            {skippedCount} omitidos
          </Text>
          <Text as="span" variant="bodySm" tone="critical">
            {failedCount} fallidos
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {processed}/{totalProducts}
          </Text>
        </InlineStack>

        <InlineStack gap="400">
          <Text as="span" variant="bodySm" tone="subdued">
            Inicio: {formatDate(startedAt)}
          </Text>
          {completedAt && (
            <Text as="span" variant="bodySm" tone="subdued">
              Fin: {formatDate(completedAt)}
            </Text>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
