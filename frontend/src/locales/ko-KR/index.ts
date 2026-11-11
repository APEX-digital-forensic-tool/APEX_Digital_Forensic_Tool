import { common } from "./common";
import { errors } from "./errors";

/** Korean is the source catalog: its shape is the type every locale must match. */
export const koKR = {
  common,
  errors,
};

export type Messages = typeof koKR;
