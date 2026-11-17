// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./App";
import { createDemoBridge } from "./demoBridge";
import type { Reply, Row } from "./gateway";
import { koKR } from "./locales/ko-KR";

afterEach(() => {
  cleanup();
  delete window.apex;
});

/** A desktop bridge whose engine is down with `code` until restartEngine() is called. */
function engineDownBridge(code: string) {
  const bridge = createDemoBridge();
  const original = bridge.invoke.bind(bridge);
  let down = true;
  bridge.invoke = async (op: string, payload: Row): Promise<Reply<unknown>> =>
    down
      ? ({ ok: false, error: { code } } as Reply<unknown>)
      : original(op, payload);
  bridge.restartEngine = vi.fn(async () => {
    down = false;
    return { ok: true as const, data: null };
  });
  window.apex = bridge;
  return bridge;
}

it("offers an engine restart after the engine failed to start in time", async () => {
  const bridge = engineDownBridge("BACKEND_START_TIMEOUT");
  render(<App />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(koKR.errors.BACKEND_START_TIMEOUT);
  fireEvent.click(screen.getByRole("button", { name: koKR.ui.restartEngine }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(bridge.restartEngine).toHaveBeenCalledTimes(1);
});

it("keeps the plain retry while the engine is still starting", async () => {
  const bridge = engineDownBridge("SERVICE_NOT_READY");
  render(<App />);
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: koKR.ui.retry })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: koKR.ui.restartEngine }),
  ).toBeNull();
  expect(bridge.restartEngine).not.toHaveBeenCalled();
});
