// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resolveInitialLocale } from "./locales";
import { I18nProvider, useI18n } from "./I18nProvider";
import { HANGUL } from "./testing";
import { koKR } from "../locales/ko-KR";
import { enUS } from "../locales/en-US";
import { errorText, GatewayError } from "../gateway";
import { lookup } from "./catalog";
import { displayValue } from "../ui";

afterEach(cleanup);

function Probe() {
  const { locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => setLocale("en-US")}>en</button>
      <button onClick={() => setLocale("ko-KR")}>ko</button>
    </div>
  );
}

type Shape = string | { [key: string]: Shape };
function shape(value: unknown): Shape {
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shape(v)]),
    );
  return typeof value;
}
function hangulLeaves(value: unknown, path = ""): string[] {
  if (typeof value === "string") return HANGUL.test(value) ? [path] : [];
  if (typeof value === "function") {
    const text = (value as (...args: number[]) => unknown)(
      ...Array(value.length).fill(2),
    );
    return HANGUL.test(String(text)) ? [path] : [];
  }
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      hangulLeaves(v, path ? `${path}.${k}` : k),
    );
  return [];
}

describe("resolveInitialLocale", () => {
  it("prefers a valid stored locale", () =>
    expect(resolveInitialLocale("en-US", ["ko-KR"])).toBe("en-US"));
  it("ignores invalid stored values", () => {
    expect(resolveInitialLocale("fr-FR", ["ko-KR"])).toBe("ko-KR");
    expect(resolveInitialLocale("", ["en-GB"])).toBe("en-US");
  });
  it("takes the first Korean or English system language", () => {
    expect(resolveInitialLocale(null, ["ja-JP", "ko"])).toBe("ko-KR");
    expect(resolveInitialLocale(null, ["en-GB", "ko-KR"])).toBe("en-US");
  });
  it("falls back to English", () => {
    expect(resolveInitialLocale(null, ["de-DE"])).toBe("en-US");
    expect(resolveInitialLocale(null, [])).toBe("en-US");
  });
});

describe("I18nProvider", () => {
  it("defaults to Korean without a provider", () => {
    render(<Probe />);
    expect(screen.getByTestId("locale").textContent).toBe("ko-KR");
  });
  it("persists the choice and syncs <html lang>", () => {
    render(
      <I18nProvider initialLocale="ko-KR">
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
    expect(localStorage.getItem("apex.locale")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en");
  });
  it("restores the stored choice on the next launch", () => {
    localStorage.setItem("apex.locale", "en-US");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en-US");
  });
  it("keeps working when storage throws", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
      // jsdom reports navigator.languages as en-US.
      expect(screen.getByTestId("locale").textContent).toBe("en-US");
      fireEvent.click(screen.getByRole("button", { name: "ko" }));
      expect(screen.getByTestId("locale").textContent).toBe("ko-KR");
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("catalogs", () => {
  it("English has exactly the Korean keys", () =>
    expect(shape(enUS)).toEqual(shape(koKR)));
  it("English contains no Hangul", () =>
    expect(hangulLeaves(enUS)).toEqual([]));
});

describe("errorText", () => {
  it("translates known codes and message keys", () => {
    expect(errorText(new GatewayError("DESKTOP_REQUIRED"), enUS)).toBe(
      "Analysis runs in the Windows or macOS desktop app.",
    );
    expect(errorText(new GatewayError("X", "error.validation"), enUS)).toBe(
      enUS.errors.VALIDATION_ERROR,
    );
  });
  it("falls back to a sentence with the code", () => {
    expect(errorText(new GatewayError("NEW_ENGINE_CODE"), enUS)).toBe(
      "The operation could not be completed. Error code: NEW_ENGINE_CODE",
    );
    expect(errorText(new Error("boom"), enUS)).toContain(
      "DESKTOP_OPERATION_FAILED",
    );
  });
});

describe("lookup", () => {
  it("shows evidence values named like built-in object members as-is", () => {
    expect(lookup(enUS.labels, "FILE")).toBe("File");
    for (const key of ["constructor", "toString", "__proto__", "valueOf"]) {
      expect(lookup(enUS.labels, key)).toBe(key);
      expect(displayValue(key, "UTC", koKR)).toBe(key);
    }
  });
});
