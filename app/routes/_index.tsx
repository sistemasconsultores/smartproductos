import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    // Shopify embedded request — redirect to /app with all query params
    throw redirect(`/app${url.search}`);
  }

  // Direct access without shop param — show login page
  throw redirect("/auth/login");
};
