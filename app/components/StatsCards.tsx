import { InlineGrid, Card, Text, BlockStack, Icon } from "@shopify/polaris";
import {
  ProductIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  ClockIcon,
} from "@shopify/polaris-icons";

interface StatsCardsProps {
  totalProducts: number;
  enrichedCount: number;
  pendingCount: number;
  failedCount: number;
}

export function StatsCards({
  totalProducts,
  enrichedCount,
  pendingCount,
  failedCount,
}: StatsCardsProps) {
  const stats = [
    {
      title: "Productos totales",
      value: totalProducts,
      icon: ProductIcon,
    },
    {
      title: "Enriquecidos",
      value: enrichedCount,
      icon: CheckCircleIcon,
    },
    {
      title: "Pendientes",
      value: pendingCount,
      icon: ClockIcon,
    },
    {
      title: "Fallidos",
      value: failedCount,
      icon: AlertTriangleIcon,
    },
  ];

  return (
    <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <BlockStack gap="200">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Icon source={stat.icon} />
              <Text as="p" variant="bodySm" tone="subdued">
                {stat.title}
              </Text>
            </div>
            <Text as="p" variant="headingLg" fontWeight="bold">
              {stat.value.toLocaleString()}
            </Text>
          </BlockStack>
        </Card>
      ))}
    </InlineGrid>
  );
}
