export const EXAMINER_NAME_KEY = "apex.examinerName";
const MAX_LENGTH = 255;

/** The default examiner name for new cases; "" when unset or storage fails. */
export function readExaminerName(): string {
  try {
    return localStorage.getItem(EXAMINER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeExaminerName(name: string): void {
  const value = name.trim().slice(0, MAX_LENGTH);
  try {
    if (value) localStorage.setItem(EXAMINER_NAME_KEY, value);
    else localStorage.removeItem(EXAMINER_NAME_KEY);
  } catch {
    // Storage is blocked; the name simply is not remembered.
  }
}
