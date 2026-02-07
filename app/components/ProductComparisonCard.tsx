import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";

interface ComparisonField {
  label: string;
  before: string;
  after: string;
}

interface ProductComparisonCardProps {
  productTitle: string;
  scoreBefore: number;
  scoreAfter: number | null;
  confidenceScore: number | null;
  status: string;
  fields: ComparisonField[];
}

export function ProductComparisonCard({
  productTitle,
  scoreBefore,
  scoreAfter,
  confidenceScore,
  status,
  fields,
}: ProductComparisonCardProps) {
  const statusTone = () => {
    switch (status) {
      case "APPLIED":
        return "success" as const;
      case "PENDING":
        return "info" as const;
      case "REJECTED":
        return "warning" as const;
      case "FAILED":
        return "critical" as const;
      default:
        return undefined;
    }
  };

  const statusLabel = () => {
    switch (status) {
      case "APPLIED":
        return "Aplicado";
      case "PENDING":
        return "Pendiente";
      case "APPROVED":
        return "Aprobado";
      case "REJECTED":
        return "Rechazado";
      case "FAILED":
        return "Error";
      case "SKIPPED":
        return "Omitido";
      default:
        return status;
    }
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h3" variant="headingSm">
            {productTitle}
          </Text>
          <Badge tone={statusTone()}>{statusLabel()}</Badge>
        </InlineStack>

        <InlineStack gap="400">
          <Text as="span" variant="bodySm">
            Score: {scoreBefore} → {scoreAfter ?? "—"}
          </Text>
          {confidenceScore !== null && (
            <Text as="span" variant="bodySm" tone="subdued">
              Confianza: {Math.round(confidenceScore * 100)}%
            </Text>
          )}
        </InlineStack>

        <Divider />

        {fields.map((field) => (
          <Box key={field.label}>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {field.label}
            </Text>
            <InlineStack gap="200" wrap={false}>
              <Box width="50%">
                <Text as="p" variant="bodySm" tone="subdued">
                  Antes:
                </Text>
                <Text as="p" variant="bodySm">
                  {field.before || "—"}
                </Text>
              </Box>
              <Box width="50%">
                <Text as="p" variant="bodySm" tone="subdued">
                  Después:
                </Text>
                <Text as="p" variant="bodySm">
                  {field.after || "—"}
                </Text>
              </Box>
            </InlineStack>
          </Box>
        ))}
      </BlockStack>
    </Card>
  );
}
