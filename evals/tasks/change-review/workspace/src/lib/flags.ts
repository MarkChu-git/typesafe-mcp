const state = new Map<string, boolean>();

export const flags = {
  /** True when the named feature flag is switched on. Flags nobody has defined are off. */
  isOn(name: string): boolean {
    return state.get(name) ?? false;
  },

  /** Replaces every flag value at once. */
  set(values: Readonly<Record<string, boolean>>): void {
    state.clear();
    for (const [name, value] of Object.entries(values)) state.set(name, value);
  },
};

/** Pulls the current flag values from the flag service. The server calls it once at startup. */
export async function refreshFlags(): Promise<void> {
  const baseUrl = process.env.FLAG_SERVICE_URL;
  if (!baseUrl) throw new Error("FLAG_SERVICE_URL is not set");

  const response = await fetch(`${baseUrl}/v1/flags`);
  if (!response.ok) throw new Error(`flag service answered ${response.status}`);
  flags.set((await response.json()) as Record<string, boolean>);
}
