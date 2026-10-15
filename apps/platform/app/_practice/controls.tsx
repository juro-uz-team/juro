"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Select } from "../_components/Select";
import type { Locale } from "../../lib/practice/domain";
import { t } from "./copy";

export function Modal({
  locale,
  title,
  children,
  close,
}: {
  locale: Locale;
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="practice-modal"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label={t(locale, "close")}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export type Field = {
  key: string;
  label?: string;
  type?:
    | "text"
    | "textarea"
    | "checkbox"
    | "select"
    | "remote"
    | "number"
    | "date"
    | "datetime-local"
    | "multi";
  required?: boolean;
  options?:
    | { value: string; label: string }[]
    | ((values: Record<string, any>) => { value: string; label: string }[]);
  loadOptions?: (query: string) => Promise<{ value: string; label: string }[]>;
  min?: number;
  step?: string;
  help?: string;
};
export function RemoteSelect({
  id,
  locale,
  value,
  initial = [],
  load,
  onChange,
  required = true,
}: {
  id?: string;
  locale: Locale;
  value: string;
  initial?: { value: string; label: string }[];
  load: (query: string) => Promise<{ value: string; label: string }[]>;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [options, setOptions] = useState(initial),
    [error, setError] = useState("");
  const loadRef = useRef(load);
  loadRef.current = load;
  const selected = useRef(initial.find((option) => option.value === value));
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      loadRef
        .current(query)
        .then((rows) => {
          if (active) {
            setOptions(rows);
            setError("");
          }
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const current =
    options.find((option) => option.value === value) ?? selected.current;
  if (current?.value === value) selected.current = current;
  const rows =
    current && !options.some((option) => option.value === current.value)
      ? [current, ...options]
      : options;
  return (
    <div className="practice-stack">
      <input
        aria-label={t(locale, "search")}
        placeholder={t(locale, "search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        id={id}
        required={required}
        value={value}
        onChange={(event) => {
          selected.current = rows.find(
            (option) => option.value === event.target.value,
          );
          onChange(event.target.value);
        }}
      >
        <option value="">{t(locale, "choose")}</option>
        {rows.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
export function ActionForm({
  locale,
  fields,
  initial,
  submit,
  label,
}: {
  locale: Locale;
  fields: Field[];
  initial?: Record<string, any>;
  submit: (values: Record<string, any>) => Promise<void>;
  label?: string;
}) {
  const [values, setValues] = useState<Record<string, any>>(initial ?? {}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="practice-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await submit(values);
        } catch (error) {
          setError(
            error instanceof Error ? error.message : t(locale, "failed"),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((field) => {
        const options =
          typeof field.options === "function"
            ? field.options(values)
            : field.options;
        const id = `practice-field-${field.key}`;
        return (
          <div
            className={`practice-field ${field.type === "checkbox" ? "check-field" : ""}`}
            key={field.key}
          >
            {field.type === "checkbox" ? (
              <label htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.checked })
                  }
                />
                {field.label ?? t(locale, field.key)}
              </label>
            ) : (
              <>
                <label htmlFor={id}>
                  {field.label ?? t(locale, field.key)}
                </label>
                {field.type === "remote" && field.loadOptions ? (
                  <RemoteSelect
                    id={id}
                    locale={locale}
                    value={values[field.key] ?? ""}
                    initial={options}
                    load={field.loadOptions}
                    required={field.required !== false}
                    onChange={(value) =>
                      setValues({ ...values, [field.key]: value })
                    }
                  />
                ) : field.type === "textarea" ? (
                  <textarea
                    id={id}
                    rows={4}
                    required={field.required !== false}
                    value={values[field.key] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [field.key]: event.target.value })
                    }
                  />
                ) : field.type === "select" ? (
                  <Select
                    id={id}
                    required={field.required !== false}
                    value={values[field.key] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [field.key]: event.target.value })
                    }
                  >
                    <option value="">{t(locale, "choose")}</option>
                    {options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : field.type === "multi" ? (
                  <div className="practice-checks">
                    {options?.map((option) => (
                      <label key={option.value}>
                        <input
                          type="checkbox"
                          checked={(values[field.key] ?? []).includes(
                            option.value,
                          )}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              [field.key]: event.target.checked
                                ? [...(values[field.key] ?? []), option.value]
                                : (values[field.key] ?? []).filter(
                                    (value: string) => value !== option.value,
                                  ),
                            })
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    id={id}
                    type={field.type ?? "text"}
                    required={field.required !== false}
                    min={field.min}
                    step={field.step}
                    value={values[field.key] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [field.key]: event.target.value })
                    }
                  />
                )}
              </>
            )}
            {field.help && <small>{field.help}</small>}
          </div>
        );
      })}
      {error && (
        <p className="practice-error" role="alert">
          {error}
        </p>
      )}
      <button className="practice-primary" type="submit" disabled={busy}>
        {busy ? t(locale, "loading") : (label ?? t(locale, "save"))}
      </button>
    </form>
  );
}
export function RichEditor({
  html,
  locale,
  onChange,
  readOnly = false,
  fields = [],
}: {
  html: string;
  locale: Locale;
  onChange: (value: string) => void;
  readOnly?: boolean;
  fields?: { value: string; label: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null),
    selection = useRef<Range | null>(null);
  useEffect(() => {
    if (
      ref.current &&
      document.activeElement !== ref.current &&
      ref.current.innerHTML !== html
    )
      ref.current.innerHTML = html;
  }, [html]);
  function command(name: string, value?: string) {
    ref.current?.focus();
    if (selection.current) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
    document.execCommand(name, false, value);
    onChange(ref.current?.innerHTML ?? "");
  }
  return (
    <div className="practice-editor-wrap">
      {!readOnly && (
        <div
          className="practice-editor-tools"
          role="toolbar"
          aria-label={t(locale, "edit")}
        >
          {[
            ["bold", "bold"],
            ["italic", "italic"],
            ["underline", "underline"],
            ["insertUnorderedList", "list"],
          ].map(([cmd, label]) => (
            <button
              key={cmd}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(cmd)}
              title={t(locale, label)}
            >
              {t(locale, label)}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command("formatBlock", "h2")}
          >
            {t(locale, "heading")}
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              command(
                "insertHTML",
                "<table><tbody><tr><td> </td><td> </td></tr><tr><td> </td><td> </td></tr></tbody></table><p></p>",
              )
            }
          >
            {t(locale, "addTable")}
          </button>
          {fields.length > 0 && (
            <Select
              aria-label={t(locale, "insert")}
              value=""
              onChange={(event) =>
                command("insertText", `{{${event.target.value}}}`)
              }
            >
              <option value="">{t(locale, "insert")}</option>
              {fields.map((field) => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
      <div
        ref={ref}
        className="practice-editor"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t(locale, "body")}
        onKeyUp={() => {
          const range = window.getSelection();
          if (range?.rangeCount)
            selection.current = range.getRangeAt(0).cloneRange();
        }}
        onMouseUp={() => {
          const range = window.getSelection();
          if (range?.rangeCount)
            selection.current = range.getRangeAt(0).cloneRange();
        }}
        onInput={() => onChange(ref.current?.innerHTML ?? "")}
        onPaste={(event) => {
          if (readOnly) return;
          event.preventDefault();
          command("insertText", event.clipboardData.getData("text/plain"));
        }}
      />
    </div>
  );
}
