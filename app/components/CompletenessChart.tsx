import { Card, Text, BlockStack, ProgressBar, InlineStack } from "@shopify/polaris";

interface ChartItem {
  label: string;
  score: number;
}

interface CompletenessChartProps {
  title: string;
  items: ChartItem[];
}

export function CompletenessChart({ title, items }: CompletenessChartProps) {
  const getProgressTone = (score: number) => {
    if (score >= 80) return "success" as const;
    if (score >= 50) return "highlight" as const;
    return "critical" as const;
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingSm">
          {title}
        </Text>

        {items.map((item) => (
          <BlockStack key={item.label} gap="100">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm">
                {item.label}
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                {item.score}%
              </Text>
            </InlineStack>
            <ProgressBar
              progress={item.score}
              size="small"
              tone={getProgressTone(item.score)}
            />
          </BlockStack>
        ))}
      </BlockStack>
    </Card>
  );
}
