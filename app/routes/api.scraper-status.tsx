import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { Prisma } from "@prisma/client";
import { json } from "@remix-run/node";
import prisma from "../db.server";

const DEFAULT_SHOP = "smartcostarica.myshopify.com";

function authenticateApiKey(request: Request): boolean {
  const apiKey = request.headers.get("x-api-key");
  const internalKey = process.env.INTERNAL_API_KEY;
  return !!(apiKey && internalKey && apiKey === internalKey);
}

// POST /api/scraper-status - Reportar estado del scraper (desde scraper_cron)
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authenticateApiKey(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = body.event as string;
  const supplierName = body.supplier as string;

  if (!event || !supplierName) {
    return json({ error: "Missing required fields: event, supplier" }, { status: 400 });
  }

  const shop = (body.shop as string) || DEFAULT_SHOP;
  const slug = supplierName.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Upsert del supplier
  const supplier = await prisma.supplier.upsert({
    where: { shop_slug: { shop, slug } },
    create: { shop, name: supplierName, slug },
    update: { name: supplierName },
  });

  switch (event) {
    case "scrape_start": {
      // Crear nuevo ScraperRun y marcar supplier como RUNNING
      const run = await prisma.scraperRun.create({
        data: {
          supplierId: supplier.id,
          shop,
          status: "RUNNING",
        },
      });

      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { lastScrapeStatus: "RUNNING", lastErrorMessage: null },
      });

      return json({ success: true, runId: run.id });
    }

    case "scrape_complete": {
      const productsScraped = (body.productsScraped as number) || 0;
      const durationSeconds = (body.durationSeconds as number) || 0;
      const averageMargin = body.averageMargin as number | undefined;
      const runId = body.runId as string | undefined;

      // Actualizar o crear el run
      if (runId) {
        await prisma.scraperRun.update({
          where: { id: runId },
          data: {
            status: "COMPLETED",
            productsScraped,
            durationSeconds,
            averageMargin: averageMargin ?? null,
            completedAt: new Date(),
          },
        });
      } else {
        await prisma.scraperRun.create({
          data: {
            supplierId: supplier.id,
            shop,
            status: "COMPLETED",
            productsScraped,
            durationSeconds,
            averageMargin: averageMargin ?? null,
            completedAt: new Date(),
          },
        });
      }

      // Actualizar supplier con ultimas stats
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          lastScrapeStatus: "COMPLETED",
          lastProductCount: productsScraped,
          lastScrapeDuration: durationSeconds,
          lastScrapeAt: new Date(),
          lastMargin: averageMargin ?? supplier.lastMargin,
          lastErrorMessage: null,
        },
      });

      return json({ success: true });
    }

    case "scrape_error": {
      const errorMessage = (body.errorMessage as string) || "Error desconocido";
      const errorDetails = body.errorDetails ?? null;
      const runId = body.runId as string | undefined;

      if (runId) {
        await prisma.scraperRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            errorMessage,
            errorDetails: (errorDetails ?? undefined) as Prisma.InputJsonValue | undefined,
            completedAt: new Date(),
          },
        });
      } else {
        await prisma.scraperRun.create({
          data: {
            supplierId: supplier.id,
            shop,
            status: "FAILED",
            errorMessage,
            errorDetails: (errorDetails ?? undefined) as Prisma.InputJsonValue | undefined,
            completedAt: new Date(),
          },
        });
      }

      await prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          lastScrapeStatus: "FAILED",
          lastScrapeAt: new Date(),
          lastErrorMessage: errorMessage,
        },
      });

      return json({ success: true });
    }

    case "sync_start": {
      const runId = body.runId as string | undefined;
      const syncProductsTotal = (body.syncProductsTotal as number) || 0;

      if (runId) {
        await prisma.scraperRun.update({
          where: { id: runId },
          data: { syncStatus: "syncing", syncProductsTotal },
        });
      }

      return json({ success: true });
    }

    case "sync_complete": {
      const runId = body.runId as string | undefined;
      const productsCreated = (body.productsCreated as number) || 0;
      const productsUpdated = (body.productsUpdated as number) || 0;
      const productsFailed = (body.productsFailed as number) || 0;

      if (runId) {
        await prisma.scraperRun.update({
          where: { id: runId },
          data: {
            syncStatus: "completed",
            productsCreated,
            productsUpdated,
            productsFailed,
            syncProductsDone: productsCreated + productsUpdated,
          },
        });
      }

      return json({ success: true });
    }

    case "sync_error": {
      const runId = body.runId as string | undefined;
      const errorMessage = (body.errorMessage as string) || "Error de sincronizacion";

      if (runId) {
        await prisma.scraperRun.update({
          where: { id: runId },
          data: {
            syncStatus: "failed",
            errorMessage,
          },
        });
      }

      return json({ success: true });
    }

    case "update_margin": {
      const averageMargin = body.averageMargin as number;
      if (typeof averageMargin === "number") {
        await prisma.supplier.update({
          where: { id: supplier.id },
          data: { lastMargin: averageMargin },
        });
      }
      return json({ success: true });
    }

    default:
      return json({ error: `Unknown event: ${event}` }, { status: 400 });
  }
};

// GET /api/scraper-status - Obtener estado de todos los proveedores
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Soporta tanto Shopify auth como API key
  const apiKey = request.headers.get("x-api-key");
  const internalKey = process.env.INTERNAL_API_KEY;
  const isApiKeyAuth = !!(apiKey && internalKey && apiKey === internalKey);

  let shop: string;

  if (isApiKeyAuth) {
    const url = new URL(request.url);
    shop = url.searchParams.get("shop") || DEFAULT_SHOP;
  } else {
    // Intentar autenticacion Shopify
    const { authenticate } = await import("../shopify.server");
    const { session } = await authenticate.admin(request);
    shop = session.shop;
  }

  const suppliers = await prisma.supplier.findMany({
    where: { shop },
    orderBy: { name: "asc" },
    include: {
      scraperRuns: {
        orderBy: { startedAt: "desc" },
        take: 10,
      },
    },
  });

  // Calcular resumen
  const totalProducts = suppliers.reduce((sum, s) => sum + (s.lastProductCount || 0), 0);
  const activeSuppliers = suppliers.filter((s) => s.isActive).length;
  const failedSuppliers = suppliers.filter((s) => s.lastScrapeStatus === "FAILED").length;
  const runningSuppliers = suppliers.filter((s) => s.lastScrapeStatus === "RUNNING").length;

  return json({
    suppliers,
    summary: {
      totalSuppliers: suppliers.length,
      activeSuppliers,
      failedSuppliers,
      runningSuppliers,
      totalProducts,
    },
  });
};
