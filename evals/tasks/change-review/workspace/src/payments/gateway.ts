import { AppError } from "../lib/errors.ts";

export interface ChargeResult {
  chargeId: string;
  amountCents: number;
}

interface GatewayCharge {
  id: string;
  amount: number;
  status: "succeeded" | "failed";
}

const GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL ?? "http://localhost:9090";

async function post(path: string, body: Readonly<Record<string, unknown>>): Promise<GatewayCharge> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new AppError("PAYMENT_FAILED", { details: { status: response.status } });
  return (await response.json()) as GatewayCharge;
}

/** Charges the payment method the customer saved earlier. The amount is in cents. */
export async function chargeSavedMethod(
  orderId: string,
  customerId: string,
  amountCents: number,
): Promise<ChargeResult> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AppError("INVALID_AMOUNT");

  try {
    const charge = await post("/v1/charges", {
      order_id: orderId,
      customer_id: customerId,
      amount: amountCents,
      source: "saved_method",
    });
    if (charge.status !== "succeeded") throw new AppError("PAYMENT_FAILED", { details: { orderId } });
    return { chargeId: charge.id, amountCents: charge.amount };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("PAYMENT_FAILED", { cause: err, details: { orderId } });
  }
}
