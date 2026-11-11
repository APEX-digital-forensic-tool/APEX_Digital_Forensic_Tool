import { common } from "./common";
import { errors } from "./errors";
import { labels } from "./labels";
import { native } from "./native";
import { settings } from "./settings";
import { ui } from "./ui";

/** Korean is the source catalog: its shape is the type every locale must match. */
export const koKR = {
  common,
  errors,
  settings,
  native,
  labels,
  ui,
};

export type Messages = typeof koKR;
