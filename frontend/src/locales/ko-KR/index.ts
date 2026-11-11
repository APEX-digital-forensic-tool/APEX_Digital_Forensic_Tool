import { common } from "./common";
import { errors } from "./errors";
import { native } from "./native";
import { settings } from "./settings";

/** Korean is the source catalog: its shape is the type every locale must match. */
export const koKR = {
  common,
  errors,
  settings,
  native,
};

export type Messages = typeof koKR;
