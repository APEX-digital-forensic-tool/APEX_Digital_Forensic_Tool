import { ai } from "./ai";
import { common } from "./common";
import { errors } from "./errors";
import { evidence } from "./evidence";
import { labels } from "./labels";
import { machine } from "./machine";
import { native } from "./native";
import { panels } from "./panels";
import { report } from "./report";
import { settings } from "./settings";
import { shell } from "./shell";
import { tools } from "./tools";
import { ui } from "./ui";
import { views } from "./views";
import { workbench } from "./workbench";

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
  evidence,
  workbench,
  tools,
  machine,
  ai,
};

export type Messages = typeof koKR;
