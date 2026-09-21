import { describe, expect, test } from "bun:test";
import {
  buildQuestions,
  toChoiceQuestion,
  toNoulQuestion,
  toScoreQuestion,
  toSdkQuestion,
} from "../src/questions.ts";

describe("toNoulQuestion", () => {
  test("sets type noul and passes criteria through", () => {
    const criteria = { true: "time-sensitive", false: "no urgency" };
    const q = toNoulQuestion({ question: "Does this message convey urgency?", criteria });
    expect(q.type).toBe("noul");
    expect(q.instructions).toBe("Does this message convey urgency?");
    expect(q.criteria).toEqual(criteria);
  });
});

describe("toChoiceQuestion", () => {
  test("sets type choice and uses options as criteria", () => {
    const options = { billing: "Payments", technical: null };
    const q = toChoiceQuestion({ question: "Which team?", options });
    expect(q.type).toBe("choice");
    expect(q.instructions).toBe("Which team?");
    expect(q.criteria).toEqual(options);
  });
});

describe("toScoreQuestion", () => {
  test("sets type score and passes levels as array criteria", () => {
    const levels = ["Calm", "Frustrated", "Very angry"];
    const q = toScoreQuestion({ question: "How frustrated?", levels });
    expect(q.type).toBe("score");
    expect(q.instructions).toBe("How frustrated?");
    expect([...q.criteria]).toEqual(levels);
  });
});

describe("toSdkQuestion / buildQuestions", () => {
  test("dispatches on type for each entry", () => {
    const questions = buildQuestions({
      urgent: { type: "noul", question: "Urgent?" },
      dept: { type: "choice", question: "Team?", options: { a: null, b: null } },
      anger: { type: "score", question: "Anger?", levels: ["low", "high"] },
    });
    expect(questions["urgent"]?.type).toBe("noul");
    expect(questions["dept"]?.type).toBe("choice");
    expect(questions["anger"]?.type).toBe("score");
  });

  test("toSdkQuestion preserves question text and criteria", () => {
    const q = toSdkQuestion({
      type: "choice",
      question: "Team?",
      options: { a: "A desc", b: null },
    });
    expect(q.instructions).toBe("Team?");
    expect(q.criteria).toEqual({ a: "A desc", b: null });
  });
});
