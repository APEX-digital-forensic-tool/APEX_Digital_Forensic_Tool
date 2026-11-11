import { afterEach, describe, expect, it, vi } from "vitest";
import { hasActiveTasks, stopChild, type StoppableChild } from "./engineGuard";

type Reply = { ok: boolean; data?: unknown; error?: { code: string } };

function engine(tasksByCase: Record<string, { status: string }[]>) {
  return vi.fn(
    async (
      operation: string,
      payload: Record<string, unknown>,
    ): Promise<Reply> => {
      if (operation === "cases.list")
        return {
          ok: true,
          // The engine returns case records keyed by `id` (see CaseRecord).
          data: Object.keys(tasksByCase).map((id) => ({ id, name: id })),
        };
      if (operation === "tasks.list")
        return { ok: true, data: tasksByCase[String(payload.case_id)] ?? [] };
      return { ok: false, error: { code: "UNKNOWN" } };
    },
  );
}

describe("hasActiveTasks", () => {
  it("is false without cases", async () => {
    const call = engine({});
    await expect(hasActiveTasks(call)).resolves.toBe(false);
    expect(call).toHaveBeenCalledWith("cases.list", {});
  });

  it("is false when every task has finished", async () => {
    const call = engine({
      a: [{ status: "SUCCEEDED" }, { status: "FAILED" }],
      b: [{ status: "CANCELLED" }],
    });
    await expect(hasActiveTasks(call)).resolves.toBe(false);
    expect(call).toHaveBeenCalledWith("tasks.list", { case_id: "a" });
    expect(call).toHaveBeenCalledWith("tasks.list", { case_id: "b" });
  });

  it("finds an active task in the second case", async () => {
    const call = engine({
      a: [{ status: "SUCCEEDED" }],
      b: [{ status: "FAILED" }, { status: "RUNNING" }],
    });
    await expect(hasActiveTasks(call)).resolves.toBe(true);
  });

  it.each(["QUEUED", "RUNNING", "CANCELLING"])(
    "treats %s as active",
    async (status) => {
      await expect(hasActiveTasks(engine({ a: [{ status }] }))).resolves.toBe(
        true,
      );
    },
  );

  it("rejects when cases.list fails", async () => {
    const call = vi.fn(async () => ({
      ok: false,
      error: { code: "SERVICE_NOT_READY" },
    }));
    await expect(hasActiveTasks(call)).rejects.toThrow();
  });

  it("rejects when tasks.list fails", async () => {
    const call = vi.fn(async (operation: string) =>
      operation === "cases.list"
        ? { ok: true, data: [{ id: "a" }] }
        : { ok: false, error: { code: "INTERNAL_ERROR" } },
    );
    await expect(hasActiveTasks(call)).rejects.toThrow();
  });

  it("rejects when a case record has no id", async () => {
    const call = vi.fn(async (operation: string) =>
      operation === "cases.list"
        ? { ok: true, data: [{ case_id: "a" }] }
        : { ok: true, data: [] },
    );
    await expect(hasActiveTasks(call)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rejects when the call itself throws", async () => {
    const call = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(hasActiveTasks(call)).rejects.toThrow();
  });
});

class FakeChild implements StoppableChild {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: (NodeJS.Signals | undefined)[] = [];
  private listeners: (() => void)[] = [];
  constructor(private exitsOn: (NodeJS.Signals | undefined)[]) {}
  kill(signal?: NodeJS.Signals) {
    this.signals.push(signal);
    if (this.exitsOn.includes(signal)) {
      setTimeout(() => {
        this.signalCode = signal ?? "SIGTERM";
        for (const listener of this.listeners.splice(0)) listener();
      }, 50);
    }
    return true;
  }
  once(_event: "exit", listener: () => void) {
    this.listeners.push(listener);
    return this;
  }
}

describe("stopChild", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const options = { graceMs: 10000, killMs: 5000 };

  it("resolves true for a child that already exited", async () => {
    const child = new FakeChild([]);
    child.exitCode = 0;
    await expect(stopChild(child, options)).resolves.toBe(true);
    expect(child.signals).toEqual([]);
  });

  it("resolves true when the first kill stops it", async () => {
    vi.useFakeTimers();
    const child = new FakeChild([undefined]);
    const stopped = stopChild(child, options);
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopped).resolves.toBe(true);
    expect(child.signals).toEqual([undefined]);
  });

  it("sends SIGKILL when the grace period passes", async () => {
    vi.useFakeTimers();
    const child = new FakeChild(["SIGKILL"]);
    const stopped = stopChild(child, options);
    await vi.advanceTimersByTimeAsync(10000);
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopped).resolves.toBe(true);
  });

  it("resolves false when the child survives SIGKILL", async () => {
    vi.useFakeTimers();
    const child = new FakeChild([]);
    let result: boolean | undefined;
    void stopChild(child, options).then((value) => (result = value));
    await vi.advanceTimersByTimeAsync(14999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
    expect(child.signals).toEqual([undefined, "SIGKILL"]);
  });
});
