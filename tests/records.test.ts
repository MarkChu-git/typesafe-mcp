import { describe, expect, test } from "bun:test";
import { MAX_FILE_BYTES } from "../src/files.ts";
import { isPiece, splitFile, type Part } from "../src/records.ts";
import { ITEM_MODES, type ItemsMode } from "../src/schemas.ts";
import { png } from "./helpers/images.ts";

const split = (content: string, mode: ItemsMode, path = "f.txt"): Part[] => splitFile({ path, content }, mode);

/** key → content (or image) of the records Jev would be asked about. */
const records = (parts: readonly Part[]): Record<string, unknown> =>
  Object.fromEntries(parts.filter(isPiece).map((p) => [p.key, "image" in p ? p.image : p.content]));

/** key → reason of what cannot be judged. */
const rejected = (parts: readonly Part[]): Record<string, string> =>
  Object.fromEntries(parts.flatMap((p) => ("reason" in p ? [[p.key, p.reason]] : [])));

describe("splitFile: images", () => {
  test("an image is one record keyed by its path, whatever items says", () => {
    const image = { format: "png" as const, width: 1280, height: 720, bytes: png(1280, 720) };
    for (const mode of ITEM_MODES) {
      expect(splitFile({ path: "shots/home.png", image }, mode)).toEqual([{ key: "shots/home.png", file: "shots/home.png", image }]);
    }
  });
});

describe("splitFile: file", () => {
  test("the whole file is one record keyed by its path", () => {
    const parts = split("a\n\nb\n", "file", "docs/a.md");
    expect(parts).toEqual([{ key: "docs/a.md", file: "docs/a.md", content: "a\n\nb\n" }]);
  });
});

describe("splitFile: lines", () => {
  test("keys are path:N from 1, blank lines are skipped but still numbered, and \\r is dropped", () => {
    const parts = split("first\n\n   \n\tthird\r\nlast", "lines", "logs/app.log");
    expect(records(parts)).toEqual({
      "logs/app.log:1": "first",
      "logs/app.log:4": "\tthird",
      "logs/app.log:5": "last",
    });
    expect(parts.every((p) => isPiece(p) && p.file === "logs/app.log")).toBe(true);
    expect(rejected(parts)).toEqual({});
  });

  test("an empty file, or one with a final newline only, gives no records", () => {
    expect(split("", "lines")).toEqual([]);
    expect(split("\n", "lines")).toEqual([]);
    expect(records(split("a\n", "lines"))).toEqual({ "f.txt:1": "a" });
  });
});

describe("splitFile: jsonl", () => {
  test("each line is parsed; blank lines are skipped and any JSON value is a record", () => {
    const text = '{"id":1}\n\n"text"\r\n[1,2]\n  \n7\nnull\n';
    expect(records(split(text, "jsonl", "d.jsonl"))).toEqual({
      "d.jsonl:1": { id: 1 },
      "d.jsonl:3": "text",
      "d.jsonl:4": [1, 2],
      "d.jsonl:6": 7,
      "d.jsonl:7": null,
    });
  });

  test("a line that is not JSON is an error for its own key; the others are kept", () => {
    const parts = split('{"ok":true}\n{broken\n{"ok":false}', "jsonl");
    expect(records(parts)).toEqual({ "f.txt:1": { ok: true }, "f.txt:3": { ok: false } });
    expect(rejected(parts)).toEqual({ "f.txt:2": "invalid JSON" });
    expect(parts.map((p) => p.key)).toEqual(["f.txt:1", "f.txt:2", "f.txt:3"]);
  });
});

describe("splitFile: json", () => {
  test("array items are keyed path[i] from 0", () => {
    expect(records(split('[{"a":1}, "two", 3, null, [4]]', "json", "d.json"))).toEqual({
      "d.json[0]": { a: 1 },
      "d.json[1]": "two",
      "d.json[2]": 3,
      "d.json[3]": null,
      "d.json[4]": [4],
    });
  });

  test("an empty array gives no records and no error", () => {
    expect(split("[]", "json")).toEqual([]);
  });

  test("invalid JSON and a non-array are errors for the file", () => {
    expect(rejected(split("[1, 2", "json", "d.json"))).toEqual({ "d.json": "invalid JSON" });
    expect(rejected(split("", "json", "d.json"))).toEqual({ "d.json": "invalid JSON" });
    expect(rejected(split('{"items":[1]}', "json", "d.json"))).toEqual({ "d.json": "not a JSON array" });
    expect(rejected(split("null", "json", "d.json"))).toEqual({ "d.json": "not a JSON array" });
    expect(records(split("7", "json"))).toEqual({});
  });
});

describe("splitFile: csv", () => {
  test("each row is an object of header name → text, keyed by the line it starts on", () => {
    const parts = split("id,name\n1,Ada\n2,Grace\n", "csv", "people.csv");
    expect(records(parts)).toEqual({
      "people.csv:2": { id: "1", name: "Ada" },
      "people.csv:3": { id: "2", name: "Grace" },
    });
    expect(parts.every((p) => isPiece(p) && p.file === "people.csv")).toBe(true);
  });

  test("quoted fields may hold commas, quotes and newlines, and later keys count those newlines", () => {
    const text = 'id,note\n1,"a, b"\n2,"say ""hi"""\n3,"two\nlines"\n4,last';
    expect(records(split(text, "csv"))).toEqual({
      "f.txt:2": { id: "1", note: "a, b" },
      "f.txt:3": { id: "2", note: 'say "hi"' },
      "f.txt:4": { id: "3", note: "two\nlines" },
      "f.txt:6": { id: "4", note: "last" },
    });
  });

  test("CRLF ends a row; inside quotes it is kept as written", () => {
    const text = 'id,note\r\n1,plain\r\n2,"a\r\nb"\r\n3,end\r\n';
    expect(records(split(text, "csv"))).toEqual({
      "f.txt:2": { id: "1", note: "plain" },
      "f.txt:3": { id: "2", note: "a\r\nb" },
      "f.txt:5": { id: "3", note: "end" },
    });
  });

  test("header names are trimmed; an empty one is column_<n> and a repeated one gets _2, _3", () => {
    const text = " id , ,name,name,name,id\n1,2,3,4,5,6";
    expect(records(split(text, "csv"))).toEqual({
      "f.txt:2": { id: "1", column_2: "2", name: "3", name_2: "4", name_3: "5", id_2: "6" },
    });
  });

  test("fields beyond the header are column_<n>; missing ones are left out", () => {
    const text = "a,b\n1,2,3,4\n5\n6,";
    expect(records(split(text, "csv"))).toEqual({
      "f.txt:2": { a: "1", b: "2", column_3: "3", column_4: "4" },
      "f.txt:3": { a: "5" },
      "f.txt:4": { a: "6", b: "" },
    });
  });

  test("rows whose fields are all empty are skipped, including blank lines around the header", () => {
    const text = "\n\na,b\n\n,\n1,2\n\"\",\"\"\n\n3,\n";
    expect(records(split(text, "csv"))).toEqual({
      "f.txt:6": { a: "1", b: "2" },
      "f.txt:9": { a: "3", b: "" },
    });
  });

  test("a header alone, or an empty file, gives no records", () => {
    expect(split("a,b\n", "csv")).toEqual([]);
    expect(split("", "csv")).toEqual([]);
  });

  test("a quote inside an unquoted field is text; text after a closing quote is kept", () => {
    expect(records(split('a,b\nsay "hi",x"y"z\n"ab"cd,e', "csv"))).toEqual({
      "f.txt:2": { a: 'say "hi"', b: 'x"y"z' },
      "f.txt:3": { a: "abcd", b: "e" },
    });
  });

  test("a quote that never closes makes the whole file an error", () => {
    const parts = split('a,b\n1,"never closed\n2,3\n', "csv", "bad.csv");
    expect(parts).toEqual([{ key: "bad.csv", reason: "invalid CSV: unterminated quote" }]);
    expect(rejected(split('a\n"', "csv"))).toEqual({ "f.txt": "invalid CSV: unterminated quote" });
  });
});

describe("splitFile: sections", () => {
  test("every heading starts a section that runs to the next heading of any level", () => {
    const text = "# Title\nintro\n\n## One\nbody 1\n\n\n### Deep\ntext\n## Two\n";
    expect(records(split(text, "sections", "doc.md"))).toEqual({
      "doc.md:1": "# Title\nintro",
      "doc.md:4": "## One\nbody 1",
      "doc.md:8": "### Deep\ntext",
      "doc.md:10": "## Two",
    });
  });

  test("text before the first heading is a section keyed by its first non-blank line", () => {
    const text = "\n\nPreamble line\nmore\n\n# First\nbody";
    expect(records(split(text, "sections"))).toEqual({
      "f.txt:3": "\n\nPreamble line\nmore",
      "f.txt:6": "# First\nbody",
    });
    expect(records(split("\n \n# Only\n", "sections"))).toEqual({ "f.txt:3": "# Only" });
  });

  test("a file without headings is one section; a blank one has none", () => {
    expect(records(split("just text\n\nmore text\n\n", "sections"))).toEqual({ "f.txt:1": "just text\n\nmore text" });
    expect(split("\n  \n", "sections")).toEqual([]);
    expect(split("", "sections")).toEqual([]);
  });

  test("only ATX headings count: up to 3 spaces of indent, 1 to 6 hashes, then a space or the end", () => {
    const text = "# One\n  ## Two\n#Not\n####### seven\n    # code\n#\ntail";
    expect(records(split(text, "sections"))).toEqual({
      "f.txt:1": "# One",
      "f.txt:2": "  ## Two\n#Not\n####### seven\n    # code",
      "f.txt:6": "#\ntail",
    });
  });

  test("# lines inside fenced code are not headings", () => {
    const text = [
      "# Real",
      "```sh",
      "# comment, not a heading",
      "```",
      "after fence",
      "~~~",
      "# also code",
      "~~~",
      "## Next",
    ].join("\n");
    expect(records(split(text, "sections"))).toEqual({
      "f.txt:1": "# Real\n```sh\n# comment, not a heading\n```\nafter fence\n~~~\n# also code\n~~~",
      "f.txt:9": "## Next",
    });
  });

  test("a fence closes only on the same character, at least as long, with nothing after it", () => {
    const text = ["````", "```", "# still code", "~~~~", "```` x", "# still code", "````", "# Heading"].join("\n");
    expect(records(split(text, "sections"))).toEqual({
      "f.txt:1": "````\n```\n# still code\n~~~~\n```` x\n# still code\n````",
      "f.txt:8": "# Heading",
    });
  });

  test("a fence that never closes runs to the end of the file", () => {
    expect(records(split("# A\n```\n# B\n# C", "sections"))).toEqual({ "f.txt:1": "# A\n```\n# B\n# C" });
  });

  test("an inline code span of three backticks does not open a fence", () => {
    expect(records(split("# A\n```x``` text\n# B", "sections"))).toEqual({
      "f.txt:1": "# A\n```x``` text",
      "f.txt:3": "# B",
    });
  });

  test("CRLF files split the same way, and sections are joined with \\n", () => {
    expect(records(split("# A\r\nbody\r\n\r\n# B\r\n", "sections"))).toEqual({ "f.txt:1": "# A\nbody", "f.txt:4": "# B" });
  });
});

const over = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB is over the ${MAX_FILE_BYTES / 1024} KB limit`;

describe("splitFile: the size of one record", () => {
  test("a record of exactly MAX_FILE_BYTES is kept; one byte more is an error for its key", () => {
    const text = `ok\n${"x".repeat(MAX_FILE_BYTES)}\n${"y".repeat(MAX_FILE_BYTES + 1)}\nok`;
    const parts = split(text, "lines");
    expect(Object.keys(records(parts))).toEqual(["f.txt:1", "f.txt:2", "f.txt:4"]);
    expect(rejected(parts)).toEqual({ "f.txt:3": over(MAX_FILE_BYTES + 1) });
  });

  test("size is measured in UTF-8 bytes, not characters", () => {
    const text = "é".repeat(MAX_FILE_BYTES / 2 + 1);
    expect(text.length).toBeLessThan(MAX_FILE_BYTES);
    expect(rejected(split(text, "lines"))).toEqual({ "f.txt:1": over(MAX_FILE_BYTES + 2) });
  });

  test("parsed records are measured by their JSON", () => {
    const big = JSON.stringify({ blob: "z".repeat(MAX_FILE_BYTES) });
    const jsonl = split(`{"small":1}\n${big}`, "jsonl");
    expect(Object.keys(records(jsonl))).toEqual(["f.txt:1"]);
    expect(Object.keys(rejected(jsonl))).toEqual(["f.txt:2"]);
    expect(Object.keys(rejected(split(`[${big}]`, "json")))).toEqual(["f.txt[0]"]);
    const csv = split(`a\n${"c".repeat(MAX_FILE_BYTES)}`, "csv");
    expect(Object.keys(rejected(csv))).toEqual(["f.txt:2"]);
  });

  test("a record nested too deeply to be sent is an error for its key", () => {
    const deep = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
    const parts = split(`[1, ${deep}, 2]`, "json");
    expect(Object.keys(records(parts))).toEqual(["f.txt[0]", "f.txt[2]"]);
    expect(rejected(parts)).toEqual({ "f.txt[1]": "nested too deeply" });
  });

  test("a section over the limit is an error for the section", () => {
    const parts = split(`# Small\ntext\n# Big\n${"w".repeat(MAX_FILE_BYTES)}`, "sections");
    expect(Object.keys(records(parts))).toEqual(["f.txt:1"]);
    expect(Object.keys(rejected(parts))).toEqual(["f.txt:3"]);
  });
});
