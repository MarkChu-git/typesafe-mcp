import { expressCheckout } from "./checkout/expressCheckout.ts";
import type { ExpressRequest } from "./checkout/expressCheckout.ts";
import { redeemGiftCard } from "./checkout/giftCards.ts";
import { AppError, isAppError } from "./lib/errors.ts";
import type { ErrorCode } from "./lib/errors.ts";
import { flags, refreshFlags } from "./lib/flags.ts";
import { logger } from "./lib/logger.ts";
import { recentOrders } from "./orders/orderHistory.ts";

const port = Number(process.env.PORT ?? 3000);

const STATUS: Record<ErrorCode, number> = {
  FEATURE_DISABLED: 404,
  NOT_FOUND: 404,
  CART_EMPTY: 400,
  GIFT_CARD_INVALID: 422,
  GIFT_CARD_EXPIRED: 422,
  INVALID_AMOUNT: 400,
  PAYMENT_FAILED: 402,
  EMAIL_FAILED: 502,
  INTERNAL: 500,
};

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/checkout/express") {
    const body = (await request.json()) as ExpressRequest;
    return Response.json(await expressCheckout(body));
  }

  if (request.method === "POST" && url.pathname === "/checkout/gift-card") {
    if (!flags.isOn("gift_cards")) throw new AppError("FEATURE_DISABLED");
    const body = (await request.json()) as { code: string; amountDueCents: number };
    return Response.json(await redeemGiftCard(body.code, body.amountDueCents));
  }

  if (request.method === "GET" && url.pathname === "/orders/recent") {
    const customerId = url.searchParams.get("customerId");
    if (!customerId) throw new AppError("NOT_FOUND");
    return Response.json(await recentOrders(customerId));
  }

  throw new AppError("NOT_FOUND");
}

async function handle(request: Request): Promise<Response> {
  try {
    return await route(request);
  } catch (err) {
    if (isAppError(err)) return Response.json({ code: err.code }, { status: STATUS[err.code] });
    logger.error({ err }, "unhandled error while serving request");
    return Response.json({ code: "INTERNAL" }, { status: STATUS.INTERNAL });
  }
}

await refreshFlags();
Bun.serve({ port, fetch: handle });
logger.info({ port }, "checkout service listening");
