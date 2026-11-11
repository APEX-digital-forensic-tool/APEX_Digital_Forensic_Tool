import { common } from "./common";
import { errors } from "./errors";
import { labels } from "./labels";
import { native } from "./native";
import { panels } from "./panels";
import { report } from "./report";
import { settings } from "./settings";
import { shell } from "./shell";
import { ui } from "./ui";
import { views } from "./views";

/** Korean is the source catalog: its shape is the type every locale must match. */
export const koKR = {
  common,
  errors,
  settings,
  native,
  labels,
  ui,
  shell,
  views,
  panels,
  report,
};

export type Messages = typeof koKR;
