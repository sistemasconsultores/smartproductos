import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Layout, BlockStack, Banner } from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { SettingsForm } from "../components/SettingsForm";
import { setupCronJob, removeCronJob } from "../services/queue/enrichment.queue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let config = await prisma.appConfig.findUnique({
    where: { shop: session.shop },
  });

  // Create default config if not exists
  if (!config) {
    config = await prisma.appConfig.create({
      data: {
        shop: session.shop,
        cronSchedule: "0 2 * * *",
        cronEnabled: true,
        autoApply: false,
        maxProductsPerRun: 50,
        minConfidenceScore: 0.7,
      },
    });
  }

  return json({
    config: {
      cronSchedule: config.cronSchedule,
      cronEnabled: config.cronEnabled,
      autoApply: config.autoApply,
      maxProductsPerRun: config.maxProductsPerRun,
      minConfidenceScore: config.minConfidenceScore,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const cronSchedule = String(formData.get("cronSchedule") || "0 2 * * *");
  const cronEnabled = formData.get("cronEnabled") === "true";
  const autoApply = formData.get("autoApply") === "true";

  const rawMax = Number(formData.get("maxProductsPerRun"));
  const maxProductsPerRun =
    Number.isFinite(rawMax) && rawMax >= 1 && rawMax <= 200
      ? Math.round(rawMax)
      : 50;

  const rawConf = parseFloat(String(formData.get("minConfidenceScore")));
  const minConfidenceScore =
    Number.isFinite(rawConf) && rawConf >= 0 && rawConf <= 1
      ? rawConf
      : 0.7;

  const config = await prisma.appConfig.upsert({
    where: { shop: session.shop },
    update: {
      cronSchedule,
      cronEnabled,
      autoApply,
      maxProductsPerRun,
      minConfidenceScore,
    },
    create: {
      shop: session.shop,
      cronSchedule,
      cronEnabled,
      autoApply,
      maxProductsPerRun,
      minConfidenceScore,
    },
  });

  // Update cron job in BullMQ
  if (cronEnabled) {
    await setupCronJob(session.shop, cronSchedule);
  } else {
    await removeCronJob(session.shop);
  }

  return json({ success: true, config });
};

export default function Settings() {
  const { config } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [saved, setSaved] = useState(false);

  const handleSave = (values: typeof config) => {
    const formData = new FormData();
    formData.set("cronSchedule", values.cronSchedule);
    formData.set("cronEnabled", String(values.cronEnabled));
    formData.set("autoApply", String(values.autoApply));
    formData.set("maxProductsPerRun", String(values.maxProductsPerRun));
    formData.set("minConfidenceScore", String(values.minConfidenceScore));
    submit(formData, { method: "post" });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <Page title="Configuración">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {saved && (
              <Banner tone="success" onDismiss={() => setSaved(false)}>
                Configuración guardada exitosamente
              </Banner>
            )}
            <SettingsForm
              initialValues={config}
              onSave={handleSave}
              saving={navigation.state === "submitting"}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
