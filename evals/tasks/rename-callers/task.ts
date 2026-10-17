import * as z from "zod/v4";
import { defineTask } from "../types.ts";
import { normPath, setF1 } from "../../verifiers.ts";

const answerSchema = z.object({
  calls: z.array(z.string()),
});

type AnswerType = z.infer<typeof answerSchema>;

/** "path:line" with the path normalized; the line is whatever follows the last colon. */
function normCall(entry: string): string {
  const cut = entry.lastIndexOf(":");
  if (cut < 0) return entry.trim();
  return `${normPath(entry.slice(0, cut).trim())}:${entry.slice(cut + 1).trim()}`;
}

export default defineTask({
  id: "rename-callers",
  title: "Call Sites Before a Rename",
  category: "control",
  split: "dev",
  dir: import.meta.dir,
  prompt: `I'm about to rename \`formatPrice()\` in src/lib/money.ts to \`formatMoney()\` and want to see what that touches before I change anything. Can you list every call site of that function as \`path:line\`, with the path relative to the workspace root and the line being the 1-based line where the call starts? Count calls wherever they are, including inside the file that defines it and ones made through an import alias. Don't list the definition, re-exports, imports, or mentions in comments, docs and strings, and leave out calls to anything else with a similar name, such as another function or a method on some class.

Please don't edit any files. Return your final answer as structured output: \`calls\` is the list of \`path:line\` strings.`,
  answer: answerSchema,
  score(answer: AnswerType, gold: AnswerType) {
    const { f1 } = setF1(answer.calls, gold.calls, normCall);
    return { score: f1, passed: f1 >= 0.9 };
  },
});
