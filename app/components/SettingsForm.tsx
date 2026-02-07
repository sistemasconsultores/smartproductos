import {
  Card,
  FormLayout,
  TextField,
  Checkbox,
  Select,
  Text,
  BlockStack,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";

interface SettingsFormProps {
  initialValues: {
    cronSchedule: string;
    cronEnabled: boolean;
    autoApply: boolean;
    maxProductsPerRun: number;
    minConfidenceScore: number;
  };
  onSave: (values: SettingsFormProps["initialValues"]) => void;
  saving?: boolean;
}

const CRON_OPTIONS = [
  { label: "Todos los días a las 2:00 AM", value: "0 2 * * *" },
  { label: "Todos los días a las 6:00 AM", value: "0 6 * * *" },
  { label: "Lunes a viernes a las 2:00 AM", value: "0 2 * * 1-5" },
  { label: "Cada 12 horas", value: "0 */12 * * *" },
  { label: "Una vez por semana (domingos)", value: "0 2 * * 0" },
];

export function SettingsForm({
  initialValues,
  onSave,
  saving = false,
}: SettingsFormProps) {
  const [values, setValues] = useState(initialValues);

  const handleChange = useCallback(
    (field: keyof typeof values, value: unknown) => {
      setValues((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Configuración del enriquecimiento
        </Text>

        <FormLayout>
          <Checkbox
            label="Cron automático habilitado"
            helpText="Ejecutar enriquecimiento automáticamente según el horario"
            checked={values.cronEnabled}
            onChange={(v) => handleChange("cronEnabled", v)}
          />

          <Select
            label="Horario de ejecución"
            options={CRON_OPTIONS}
            value={values.cronSchedule}
            onChange={(v) => handleChange("cronSchedule", v)}
            disabled={!values.cronEnabled}
          />

          <Checkbox
            label="Auto-aplicar cambios"
            helpText="Aplicar cambios automáticamente cuando la confianza sea suficiente. Si está deshabilitado, los cambios quedan pendientes de aprobación."
            checked={values.autoApply}
            onChange={(v) => handleChange("autoApply", v)}
          />

          <TextField
            type="number"
            label="Productos por ejecución"
            helpText="Máximo de productos a procesar en cada ejecución"
            value={String(values.maxProductsPerRun)}
            onChange={(v) => handleChange("maxProductsPerRun", Number(v))}
            autoComplete="off"
            min={1}
            max={200}
          />

          <TextField
            type="number"
            label="Confianza mínima para auto-aplicar"
            helpText="Score de confianza mínimo (0.0 - 1.0) para aplicar cambios automáticamente"
            value={String(values.minConfidenceScore)}
            onChange={(v) =>
              handleChange("minConfidenceScore", parseFloat(v) || 0.7)
            }
            autoComplete="off"
            min={0}
            max={1}
            step={0.05}
          />
        </FormLayout>

        <Button
          variant="primary"
          onClick={() => onSave(values)}
          loading={saving}
        >
          Guardar configuración
        </Button>
      </BlockStack>
    </Card>
  );
}
