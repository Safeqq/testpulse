import { useId, type HTMLInputAutoCompleteAttribute, type HTMLInputTypeAttribute } from "react";

interface FormFieldProps {
  name: string;
  label: string;
  type?: HTMLInputTypeAttribute;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  autoComplete?: HTMLInputAutoCompleteAttribute;
  hint?: string;
  /** Awalan data-testid: input -> `<testIdPrefix>-<name>`. */
  testIdPrefix: string;
}

export function FormField({
  name,
  label,
  type = "text",
  value,
  onChange,
  error,
  autoComplete,
  hint,
  testIdPrefix,
}: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        data-testid={`${testIdPrefix}-${name}`}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error" data-testid={`field-error-${name}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
