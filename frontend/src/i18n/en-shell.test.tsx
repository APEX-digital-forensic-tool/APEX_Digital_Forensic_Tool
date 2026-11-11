// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderInEnglish } from "./testing";
import { enUS } from "../locales/en-US";
import { GatewayError } from "../gateway";
import {
  Badge,
  displayValue,
  Empty,
  ErrorState,
  evidenceFormat,
  Loading,
  time,
} from "../ui";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("renders shared states in English", () => {
  renderInEnglish(
    <>
      <Empty />
      <Loading />
      <ErrorState
        error={new GatewayError("DESKTOP_REQUIRED")}
        retry={() => {}}
      />
    </>,
  );
  expect(screen.getByText("No results")).toBeTruthy();
  expect(
    screen.getByText("Nothing was found in the selected scope."),
  ).toBeTruthy();
  expect(screen.getByText("Waiting for the analysis engine")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("translates enum labels and helper text", () => {
  renderInEnglish(<Badge value="CHANGES_REQUESTED" />);
  expect(screen.getByText("Changes requested")).toBeTruthy();
  expect(displayValue(true, "UTC", enUS)).toBe("Yes");
  expect(evidenceFormat("DIRECTORY", enUS)).toBe("Folder");
  expect(time("2026-01-01T00:00:00", "UTC", enUS)).toContain(
    "time zone unknown",
  );
});
