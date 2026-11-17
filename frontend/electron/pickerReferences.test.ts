import { expect, it } from "vitest";
import { PickerReferences } from "./pickerReferences";

it("retains recent picks when capacity is reached and binds each to its purpose and window", () => {
  const picks = new PickerReferences(2);
  const oldest = picks.add("/first", "file", "evidence", 1);
  const recent = picks.add("/second", "directory", "model", 1);
  picks.add("/third", "directory", "tessdata", 2);
  expect(picks.get(oldest, "evidence", 1)).toBeUndefined();
  expect(picks.get(recent, "model", 1)?.path).toBe("/second");
  expect(picks.get(recent, "evidence", 1)).toBeUndefined();
  expect(picks.get(recent, "model", 2)).toBeUndefined();
});
