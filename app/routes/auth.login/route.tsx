import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useState } from "react";
import { login } from "../../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = login(request);
  return json({ errors, shopDomain: "smartcostarica.myshopify.com" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = login(request);
  return json({ errors });
};

export default function Auth() {
  const { shopDomain } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shopValue, setShopValue] = useState(shopDomain);

  return (
    <PolarisAppProvider i18n={{}}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingLg" as="h1">
                SmartEnrich
              </Text>
              <Text as="p">Ingrese el dominio de su tienda Shopify</Text>
              <TextField
                type="text"
                name="shop"
                label="Dominio de la tienda"
                autoComplete="on"
                value={shopValue}
                onChange={setShopValue}
                error={(actionData?.errors as Record<string, string>)?.shop}
              />
              <Button submit variant="primary">
                Ingresar
              </Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
