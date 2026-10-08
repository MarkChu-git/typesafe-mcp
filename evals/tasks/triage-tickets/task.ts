import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { itemAccuracy } from "../../verifiers.ts";

const ticketSchema = z.object({
  id: z.string(),
  team: z.enum(["billing", "technical", "account", "sales", "other"]),
  urgent: z.boolean(),
});

const answerSchema = z.object({
  tickets: z.array(ticketSchema),
});

type AnswerType = z.infer<typeof answerSchema>;

export default defineTask({
  id: "triage-tickets",
  title: "Ticket Triage",
  category: "triage",
  split: "dev",
  dir: import.meta.dir,
  prompt: `You are a support operations manager. Your task is to review customer support tickets and triage them to the appropriate team and urgency level.

Team definitions:
- **billing**: Issues with invoicing, payments, refunds, subscription management, or pricing.
- **technical**: System errors, API failures, application crashes, bugs, or feature malfunctions.
- **account**: User profile issues, authentication, password resets, account access, or data management.
- **sales**: Product inquiries, demos, licensing, quote requests, or partnership opportunities.
- **other**: Everything else, including feedback, feature requests that don't fit other categories, or unclear requests.

Urgency guidance:
- **urgent**: true only when the customer's business is blocked or at risk right now: the product or a critical feature is down for them, data loss or a security/fraud incident is in progress, or they cannot pay or get paid. Judge the impact, not the tone: an angry customer with a minor issue is not urgent, and a calm report of an outage is.
- **urgent**: false for everything else (questions, minor bugs with workarounds, feedback, sales inquiries).

Files in the tickets/ directory contain support tickets. Each ticket has a subject line followed by the customer's message. Some include earlier email replies or signatures as context.

Review all tickets in tickets/ and classify each one by its ID (T001, T002, etc.).

Return your final answer as structured output.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const predById: Record<string, { team: string; urgent: boolean }> = {};
    for (const ticket of answer.tickets) {
      predById[ticket.id] = { team: ticket.team, urgent: ticket.urgent };
    }

    const goldById: Record<string, { team: string; urgent: boolean }> = {};
    for (const ticket of gold.tickets) {
      goldById[ticket.id] = { team: ticket.team, urgent: ticket.urgent };
    }

    const teamAccuracy = itemAccuracy(
      Object.fromEntries(Object.entries(predById).map(([k, v]) => [k, v.team])),
      Object.fromEntries(Object.entries(goldById).map(([k, v]) => [k, v.team])),
    );

    const urgentAccuracy = itemAccuracy(
      Object.fromEntries(Object.entries(predById).map(([k, v]) => [k, String(v.urgent)])),
      Object.fromEntries(Object.entries(goldById).map(([k, v]) => [k, String(v.urgent)])),
      (a, b) => a === b,
    );

    const score = 0.7 * teamAccuracy + 0.3 * urgentAccuracy;
    return { score, passed: score >= 0.8, details: { teamAccuracy, urgentAccuracy } };
  },
});
