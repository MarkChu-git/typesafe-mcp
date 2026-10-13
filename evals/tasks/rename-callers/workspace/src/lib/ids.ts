const counters = new Map<string, number>();

/** Sequential ids such as "sub_0004", unique per prefix within one process. */
export function newId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}_${String(next).padStart(4, "0")}`;
}

/** The part before the first underscore: "sub_0004" gives "sub". */
export function idPrefix(id: string): string {
  const cut = id.indexOf("_");
  return cut === -1 ? id : id.slice(0, cut);
}

/** Starts every prefix counting from zero again. */
export function resetIds(): void {
  counters.clear();
}
