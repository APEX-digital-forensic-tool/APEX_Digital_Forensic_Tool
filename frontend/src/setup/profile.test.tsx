// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish } from "../i18n/testing";
import { createDemoBridge } from "../demoBridge";
import { App } from "../App";
import { readExaminerName, writeExaminerName } from "./profile";
import { ProfileSettings } from "./ProfileSettings";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("remembers the examiner name and trims it", () => {
  writeExaminerName("  Kim  ");
  expect(readExaminerName()).toBe("Kim");
  writeExaminerName("");
  expect(localStorage.getItem("apex.examinerName")).toBeNull();
});

it("survives blocked storage", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(readExaminerName()).toBe("");
  get.mockRestore();
});

it("prefills the examiner name in a new case", async () => {
  writeExaminerName("Kim");
  window.apex = createDemoBridge();
  renderInEnglish(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "New case" }));
  expect(
    (screen.getByLabelText("Examiner name") as HTMLInputElement).value,
  ).toBe("Kim");
});

it("edits the default from settings", async () => {
  renderInEnglish(<ProfileSettings />);
  await userEvent.type(screen.getByLabelText("Examiner name"), "Lee");
  expect(readExaminerName()).toBe("Lee");
});
