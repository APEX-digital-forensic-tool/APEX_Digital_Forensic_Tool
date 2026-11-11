import type { Messages } from "./i18n/catalog";
import type { Locale } from "./i18n/locales";
import * as validators from "./contracts/validators.js";
import type { AiConnectionStatus } from "../electron/aiConnection";
export type Row = Record<string, any>; // Heterogeneous Core projection/plugin fields.
export interface ApiError {
  code: string;
  message_key?: string;
  retryable?: boolean;
  target?: string;
}
export type Reply<T> = { ok: true; data: T } | { ok: false; error: ApiError };
export interface DesktopBridge {
  invoke(operation: string, payload: Row): Promise<Reply<any>>;
  /** `locale` selects the language of the native file dialog. */
  pick(
    kind: "file" | "directory",
    locale?: Locale,
  ): Promise<Reply<{ reference: string; name: string } | null>>;
  openExports(): Promise<Reply<null>>;
  account(): Promise<Reply<{ connected: boolean; origin: string | null }>>;
  login(input: Row): Promise<Reply<{ connected: boolean; origin: string }>>;
  logout(): Promise<Reply<null>>;
  aiConnection(): Promise<Reply<AiConnectionStatus>>;
  saveAiConnection(input: {
    base_url: string;
    model_id: string;
    api_key?: string;
    temperature?: number;
    max_output?: number;
    timeout?: number;
  }): Promise<Reply<AiConnectionStatus>>;
  clearAiConnection(): Promise<Reply<AiConnectionStatus>>;
  completeSetup(): Promise<Reply<null>>;
}
declare global {
  interface Window {
    apex?: DesktopBridge;
  }
}
export class GatewayError extends Error {
  constructor(
    public code: string,
    public messageKey?: string,
  ) {
    super(code);
  }
}
export function validateContract(name: string, data: unknown) {
  const valid = (validators as Record<string, (data: unknown) => boolean>)[
    "validate_" + name.replaceAll("-", "_")
  ];
  if (!valid || !valid(data)) throw new GatewayError("CONTRACT_MISMATCH");
}
export function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok)
    throw new GatewayError(reply.error.code, reply.error.message_key);
  return reply.data;
}
export interface ApexGateway {
  call<T = Row>(operation: string, payload?: Row): Promise<T>;
}
export class DesktopGateway implements ApexGateway {
  async call<T = Row>(operation: string, payload: Row = {}): Promise<T> {
    if (!window.apex) throw new GatewayError("DESKTOP_REQUIRED");
    const data = unwrap(await window.apex.invoke(operation, payload));
    const lists: Record<string, string> = {
      "cases.list": "case",
      "evidence.list": "evidence",
      "files.roots": "file",
    };
    const pages: Record<string, string> = {
      "files.list": "file",
      "artifacts.list": "artifact",
      "candidates.list": "machine-extracted-candidate",
      "reports.list": "report-record",
    };
    if (lists[operation])
      data.forEach((item: unknown) => validateContract(lists[operation], item));
    if (pages[operation])
      data.items.forEach((item: unknown) =>
        validateContract(pages[operation], item),
      );
    if (operation.startsWith("context."))
      validateContract("gui-session-context", data);
    if (operation === "view") validateContract("view-projection", data);
    if (operation === "runtime")
      validateContract("runtime-capability-report", data.capabilities);
    return data as T;
  }
}
export const gateway = new DesktopGateway();
// Engine message keys resolve to the same localized text as their error codes.
const RESOURCE_KEY_CODES: Record<string, keyof Messages["errors"]> = {
  "error.evidence.capability_unavailable": "CAPABILITY_UNAVAILABLE",
  "error.capability_unavailable": "CAPABILITY_UNAVAILABLE",
  "error.context_scope_mismatch": "CONTEXT_SCOPE_MISMATCH",
  "error.context_revision_conflict": "CONTEXT_REVISION_CONFLICT",
  "error.context_expired": "CONTEXT_EXPIRED",
  "error.validation": "VALIDATION_ERROR",
  "error.raw_read_limit_exceeded": "RAW_READ_LIMIT_EXCEEDED",
  "error.raw_range_not_satisfiable": "RAW_RANGE_NOT_SATISFIABLE",
};
export function errorText(error: unknown, m: Messages): string {
  const code =
    error instanceof GatewayError ? error.code : "DESKTOP_OPERATION_FAILED";
  const key = error instanceof GatewayError ? error.messageKey : undefined;
  const known = (value: string): value is keyof Messages["errors"] =>
    Object.hasOwn(m.errors, value);
  if (key && Object.hasOwn(RESOURCE_KEY_CODES, key))
    return m.errors[RESOURCE_KEY_CODES[key]];
  return known(code) ? m.errors[code] : m.common.operationFailed(code);
}
