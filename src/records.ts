import { MAX_FILE_BYTES, overLimit, type FileItem } from "./files.ts";
import type { ItemsMode, JsonValue } from "./schemas.ts";

/** Records one `jev_ask` call may send to Jev, across all its files. */
export const MAX_RECORDS = 500;

/** A record to judge. `key` names it in the result: `path`, `path:N` (line) or `path[i]` (array index). */
export interface Piece {
  key: string;
  file: string;
  content: JsonValue;
}

/** A record, or a whole file, that cannot be judged, with the reason the agent reads. */
export interface Rejected {
  key: string;
  reason: string;
}

export type Part = Piece | Rejected;

export const isPiece = (part: Part): part is Piece => "content" in part;

const stripCr = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);
const isBlank = (text: string): boolean => text.trim() === "";

function byLines(path: string, text: string): Part[] {
  const parts: Part[] = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = stripCr(raw);
    if (!isBlank(line)) parts.push({ key: `${path}:${i + 1}`, file: path, content: line });
  }
  return parts;
}

function byJsonLines(path: string, text: string): Part[] {
  const parts: Part[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (isBlank(line)) continue;
    const key = `${path}:${i + 1}`;
    try {
      parts.push({ key, file: path, content: JSON.parse(line) as JsonValue });
    } catch {
      parts.push({ key, reason: "invalid JSON" });
    }
  }
  return parts;
}

function byJsonArray(path: string, text: string): Part[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [{ key: path, reason: "invalid JSON" }];
  }
  if (!Array.isArray(value)) return [{ key: path, reason: "not a JSON array" }];
  return value.map((content: JsonValue, i) => ({ key: `${path}[${i}]`, file: path, content }));
}

interface CsvRow {
  /** The physical line the row starts on, which a quoted newline makes differ from its position. */
  line: number;
  fields: string[];
}

/**
 * RFC 4180 rows, split on LF or CRLF outside quotes. A quote opens a field only at its start; a stray
 * quote elsewhere is text. Undefined when a quote is never closed.
 */
function parseCsv(text: string): CsvRow[] | undefined {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== '"') {
        field += ch;
        if (ch === "\n") line += 1;
      } else if (text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
    } else if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      fieldStart = true;
    } else if (ch === "\n") {
      rows.push({ line: rowLine, fields: [...fields, field] });
      fields = [];
      field = "";
      fieldStart = true;
      line += 1;
      rowLine = line;
    } else if (ch !== "\r" || text.charAt(i + 1) !== "\n") {
      // A \r before \n belongs to the line ending, not to the field.
      field += ch;
      fieldStart = false;
    }
  }
  if (quoted) return undefined;
  if (field !== "" || fields.length > 0) rows.push({ line: rowLine, fields: [...fields, field] });
  return rows;
}

/** Trimmed names; an empty one becomes `column_<n>` and a repeated one gets `_2`, `_3`, … appended. */
function headerNames(fields: readonly string[]): string[] {
  const seen = new Set<string>();
  return fields.map((field, i) => {
    const base = field.trim() || `column_${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name); n += 1) name = `${base}_${n}`;
    seen.add(name);
    return name;
  });
}

/** The first row with any text is the header, so blank lines around it are not records. */
function byCsvRows(path: string, text: string): Part[] {
  const rows = parseCsv(text);
  if (rows === undefined) return [{ key: path, reason: "invalid CSV: unterminated quote" }];
  const [head, ...body] = rows.filter((row) => row.fields.some((f) => f !== ""));
  if (head === undefined) return [];
  const names = headerNames(head.fields);
  return body.map((row) => ({
    key: `${path}:${row.line}`,
    file: path,
    content: Object.fromEntries(row.fields.map((value, i) => [names[i] ?? `column_${i + 1}`, value])),
  }));
}

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const BACKTICK_FENCE = /^ {0,3}(`{3,})[^`]*$/;
const TILDE_FENCE = /^ {0,3}(~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

const fenceOpened = (line: string): string | undefined => BACKTICK_FENCE.exec(line)?.[1] ?? TILDE_FENCE.exec(line)?.[1];

/** A closing fence repeats the opening character at least as many times. */
function fenceClosed(line: string, open: string): boolean {
  const run = FENCE_CLOSE.exec(line)?.[1];
  return run !== undefined && run.charAt(0) === open.charAt(0) && run.length >= open.length;
}

/** ATX headings outside fenced code split the file; the text before the first one is a section too. */
function bySections(path: string, text: string): Part[] {
  let current = { first: 1, lines: [] as string[] };
  const sections = [current];
  let fence: string | undefined;
  for (const [i, raw] of text.split("\n").entries()) {
    const line = stripCr(raw);
    if (fence !== undefined) {
      if (fenceClosed(line, fence)) fence = undefined;
    } else if (HEADING.test(line)) {
      current = { first: i + 1, lines: [] };
      sections.push(current);
    } else {
      fence = fenceOpened(line);
    }
    current.lines.push(line);
  }
  return sections.flatMap(({ first, lines }) => {
    const offset = lines.findIndex((line) => !isBlank(line));
    return offset < 0 ? [] : [{ key: `${path}:${first + offset}`, file: path, content: lines.join("\n").trimEnd() }];
  });
}

const SPLITTERS: Record<ItemsMode, (path: string, text: string) => Part[]> = {
  file: (path, text) => [{ key: path, file: path, content: text }],
  lines: byLines,
  jsonl: byJsonLines,
  json: byJsonArray,
  csv: byCsvRows,
  sections: bySections,
};

/** A record's text as Jev gets it: a string as is, a csv row, json item or jsonl value as JSON. */
export const textOf = (content: JsonValue): string => (typeof content === "string" ? content : JSON.stringify(content));

const bytesOf = (content: JsonValue): number => Buffer.byteLength(textOf(content));

/** Jev takes about the same state from a record as from a file, so a record over the file limit is refused. */
function withinLimit(part: Part): Part {
  if (!isPiece(part)) return part;
  let size: number;
  try {
    size = bytesOf(part.content);
  } catch {
    // JSON.parse accepts nesting that JSON.stringify, which sends the record, cannot take.
    return { key: part.key, reason: "nested too deeply" };
  }
  return size > MAX_FILE_BYTES ? { key: part.key, reason: overLimit(size, MAX_FILE_BYTES) } : part;
}

/** The records of one file in `mode`, in file order, with those that cannot be judged as `Rejected`. */
export function splitFile(file: FileItem, mode: ItemsMode): Part[] {
  return SPLITTERS[mode](file.path, file.content).map(withinLimit);
}
