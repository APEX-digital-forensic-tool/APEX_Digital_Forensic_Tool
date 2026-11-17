import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { quitOnClose } from "./quitOnClose";

function closeEvent() {
  return { preventDefault: vi.fn() };
}

// The before-quit check may be cancelled; the window must still be there when it is.
it("turns a window close into a quit request until the quit is approved", () => {
  const window = new EventEmitter();
  let approved = false;
  const quit = vi.fn();
  quitOnClose(window, () => approved, quit);

  const first = closeEvent();
  window.emit("close", first);
  expect(first.preventDefault).toHaveBeenCalled();
  expect(quit).toHaveBeenCalledTimes(1);

  approved = true;
  const second = closeEvent();
  window.emit("close", second);
  expect(second.preventDefault).not.toHaveBeenCalled();
  expect(quit).toHaveBeenCalledTimes(1);
});
