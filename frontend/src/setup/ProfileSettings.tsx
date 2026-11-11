import React, { useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { readExaminerName, writeExaminerName } from "./profile";

export function ProfileSettings() {
  const { m } = useI18n();
  const t = m.setup.examiner;
  const id = useId();
  const [name, setName] = useState(readExaminerName);
  return (
    <>
      <label htmlFor={id}>{t.label}</label>
      <input
        id={id}
        type="text"
        autoComplete="name"
        maxLength={255}
        value={name}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setName(e.target.value);
          writeExaminerName(e.target.value);
        }}
      />
      <p id={`${id}-hint`} className="muted">
        {t.hint}
      </p>
    </>
  );
}
