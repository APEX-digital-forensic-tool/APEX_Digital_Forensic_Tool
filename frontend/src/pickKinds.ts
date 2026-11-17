/** What a native pick is for, and the dialog kinds each purpose may open. The shell enforces it. */
export const PICK_KINDS = {
  evidence: ["file", "directory"],
  // whisper.cpp takes a model file; faster-whisper takes a model folder.
  model: ["file", "directory"],
  tessdata: ["directory"],
} as const;
export type PickPurpose = keyof typeof PICK_KINDS;
export type PickKind<P extends PickPurpose = PickPurpose> =
  (typeof PICK_KINDS)[P][number];

export function pickAllowed(
  purpose: unknown,
  kind: unknown,
): purpose is PickPurpose {
  return (
    typeof purpose === "string" &&
    Object.hasOwn(PICK_KINDS, purpose) &&
    (PICK_KINDS[purpose as PickPurpose] as readonly unknown[]).includes(kind)
  );
}
