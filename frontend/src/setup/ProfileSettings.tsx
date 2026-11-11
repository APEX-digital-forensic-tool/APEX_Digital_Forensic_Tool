import React, { useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { readExaminerName, writeExaminerName } from "./profile";

/** `showHint` is off where the host already explains the field. */
export function ProfileSettings({ showHint = true }: { showHint?: boolean }) {
  const { m } = useI18n();
  const t = m.setup.examiner;
  const id = useId();
  const [name, setName] = useState(readExaminerName);
  return (
    <div className="setup-fields">
      <label>
        {t.label}
        <input
          type="text"
          autoComplete="name"
          maxLength={255}
          value={name}
          aria-describedby={showHint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            writeExaminerName(e.target.value);
          }}
        />
      </label>
      {showHint && (
        <p id={`${id}-hint`} className="setup-note">
          {t.hint}
        </p>
      )}
    </div>
  );
}
