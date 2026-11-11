/** One engine operation; resolves with the engine's `{ok, data}` / `{ok: false, error}` reply. */
export type EngineCall = (
  operation: string,
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: unknown; error?: { code?: string } }>;

const ACTIVE = new Set(["QUEUED", "RUNNING", "CANCELLING"]);

async function data(
  call: EngineCall,
  operation: string,
  payload: Record<string, unknown>,
) {
  const reply = await call(operation, payload);
  if (!reply?.ok || !Array.isArray(reply.data))
    throw new Error(`${operation} failed: ${reply?.error?.code ?? "UNKNOWN"}`);
  return reply.data as Record<string, unknown>[];
}

/** True when any case has a queued, running or cancelling task. Throws when the engine cannot say. */
export async function hasActiveTasks(call: EngineCall): Promise<boolean> {
  for (const record of await data(call, "cases.list", {})) {
    // The engine's case records carry `id`; tasks.list takes it as `case_id`.
    if (typeof record.id !== "string" || !record.id)
      throw new Error("cases.list returned a case without an id");
    const tasks = await data(call, "tasks.list", { case_id: record.id });
    if (tasks.some((task) => ACTIVE.has(String(task.status)))) return true;
  }
  return false;
}

export interface StoppableChild {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: () => void): unknown;
}

function exited(child: StoppableChild) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolves true once the child exits within `ms`, false otherwise. */
function waitForExit(
  child: StoppableChild,
  ms: number,
  signal?: NodeJS.Signals,
) {
  return new Promise<boolean>((done) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(value);
    };
    const timer = setTimeout(() => finish(exited(child)), ms);
    child.once("exit", () => finish(true));
    child.kill(signal);
  });
}

/** Asks the child to stop, then forces it. Resolves false when it is still alive after SIGKILL. */
export async function stopChild(
  child: StoppableChild,
  { graceMs, killMs }: { graceMs: number; killMs: number },
): Promise<boolean> {
  if (exited(child)) return true;
  if (await waitForExit(child, graceMs)) return true;
  if (exited(child)) return true;
  return waitForExit(child, killMs, "SIGKILL");
}
