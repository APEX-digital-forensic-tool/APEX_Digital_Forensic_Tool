type Closable = {
  on(
    event: "close",
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
};

/**
 * Closing `target` asks the app to quit, so the before-quit check runs while the window still
 * exists. A cancelled quit keeps the window; once `approved()` is true the close goes ahead.
 */
export function quitOnClose(
  target: Closable,
  approved: () => boolean,
  quit: () => void,
) {
  target.on("close", (event) => {
    if (approved()) return;
    event.preventDefault();
    quit();
  });
}
