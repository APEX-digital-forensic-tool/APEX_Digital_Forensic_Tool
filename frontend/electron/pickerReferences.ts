import { randomUUID } from "node:crypto";

export type PickPurpose = "evidence" | "model" | "tessdata";
export class PickerReferences {
  private entries = new Map<
    string,
    {
      path: string;
      kind: "file" | "directory";
      purpose: PickPurpose;
      owner: number;
    }
  >();
  constructor(private limit = 64) {}
  add(
    path: string,
    kind: "file" | "directory",
    purpose: PickPurpose,
    owner: number,
  ) {
    while (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const reference = randomUUID();
    this.entries.set(reference, { path, kind, purpose, owner });
    return reference;
  }
  get(reference: string, purpose: PickPurpose, owner: number) {
    const entry = this.entries.get(reference);
    return entry?.purpose === purpose && entry.owner === owner
      ? entry
      : undefined;
  }
  delete(reference: string) {
    this.entries.delete(reference);
  }
}
