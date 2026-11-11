import type { Messages } from "../ko-KR";

export const common: Messages["common"] = {
  operationFailed: (code: string) =>
    `The operation could not be completed. Error code: ${code}`,
};
