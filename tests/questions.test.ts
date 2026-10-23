import { describe, expect, test } from "bun:test";
import {
  buildQuestions,
  takesBox,
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
    expect(q).toEqual({ type: "choice", instructions: "Team?", criteria: { a: "A desc", b: null } });
  });

  test("a box question sends what to find as its instructions, and nothing else", () => {
    expect(toSdkQuestion({ type: "box", question: "the Checkout button in `content`" })).toEqual({
      type: "box",
      instructions: "the Checkout button in `content`",
    });
  });
});

describe("takesBox", () => {
  test("Jev versions before 1.14 do not take box questions", () => {
    for (const model of ["jev-1.13.0", "jev-1.9.2", "jev-0.20.0", "JEV-1.13.0", " jev-1.13 "]) {
      expect(takesBox(model)).toBe(false);
    }
  });

  test("1.14 and later, and names without a version, go to the API", () => {
    for (const model of ["jev-1.14.0", "jev-1.14.3", "jev-1.20.0", "jev-2.0.0", "jev-latest", "jev-preview"]) {
      expect(takesBox(model)).toBe(true);
    }
  });
});
