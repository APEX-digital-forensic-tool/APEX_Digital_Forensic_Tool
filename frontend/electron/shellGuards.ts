import { randomUUID } from "node:crypto";

/** What a native pick is for; a path picked for one use is not accepted for another. */
export type PickPurpose = "evidence" | "model" | "tessdata";

/** Paths from native file dialogs, handed to the renderer only as opaque references. */
export class PickedPaths {
  // Insertion-ordered, so the first key is the oldest reference.
  private readonly entries = new Map<
    string,
    { path: string; purpose: PickPurpose; owner: number }
  >();

  constructor(private readonly limit = 64) {}

  /** `owner` is the picking window's webContents id. */
  add(path: string, purpose: PickPurpose, owner: number): string {
    while (this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    const reference = randomUUID();
    this.entries.set(reference, { path, purpose, owner });
    return reference;
  }

  get(reference: string, purpose: PickPurpose, owner: number) {
    const entry = this.entries.get(reference);
    return entry?.purpose === purpose && entry.owner === owner
      ? entry.path
      : undefined;
  }

  delete(reference: string) {
    this.entries.delete(reference);
  }
}

/** A login server origin: https, or http on loopback, with nothing after the host. Null otherwise. */
export function authOrigin(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname));
  return allowed &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/"
    ? url
    : null;
}
