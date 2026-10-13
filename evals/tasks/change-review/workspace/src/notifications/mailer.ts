import { AppError } from "../lib/errors.ts";

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

const MAIL_API_URL = process.env.MAIL_API_URL ?? "http://localhost:8025";

/** Hands a message to the mail provider. Throws if the provider does not accept it. */
export async function sendMail(mail: Mail): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${MAIL_API_URL}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mail),
    });
  } catch (err) {
    throw new AppError("EMAIL_FAILED", { cause: err });
  }
  if (!response.ok) throw new AppError("EMAIL_FAILED", { details: { status: response.status } });
}
