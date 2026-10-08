import type { Field, FieldOption } from '../types';
import { FormField, Input, Select } from './ui';

const optValue = (o: FieldOption) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: FieldOption) => (typeof o === 'string' ? o : o.label);

/** Renders a server-described list of fields (brands, storage types). */
export function FieldsForm({
  fields,
  values,
  onChange,
  idPrefix,
  secretPlaceholder,
  errors,
}: {
  fields: Field[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  idPrefix: string;
  /** when editing existing config: password fields left empty keep their stored value */
  secretPlaceholder?: string;
  errors?: Record<string, string>;
}) {
  return (
    <>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const v = values[f.key] ?? '';
        return (
          <FormField key={f.key} label={f.label} htmlFor={id} optional={!f.required} hint={f.help} error={errors?.[f.key]}>
            {f.type === 'select' ? (
              <Select id={id} value={v} onChange={(e) => onChange(f.key, e.target.value)} required={f.required}>
                {!f.required || !v ? <option value="">{f.placeholder ?? 'Choose…'}</option> : null}
                {(f.options ?? []).map((o) => (
                  <option key={optValue(o)} value={optValue(o)}>
                    {optLabel(o)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                inputMode={f.type === 'number' ? 'numeric' : undefined}
                value={v}
                placeholder={f.type === 'password' && secretPlaceholder ? secretPlaceholder : f.placeholder}
                autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                spellCheck={false}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={f.type === 'text' && /url|host|ip|path|endpoint/i.test(f.key) ? 'mono-input' : undefined}
              />
            )}
          </FormField>
        );
      })}
    </>
  );
}

export function initialValues(fields: Field[], prefill: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const pre = prefill[f.key];
    if (pre !== undefined) out[f.key] = pre;
    else if (f.default !== undefined) out[f.key] = f.default;
    else if (f.type === 'select' && f.required && f.options?.length) out[f.key] = optValue(f.options[0]!);
    else out[f.key] = '';
  }
  return out;
}

export function missingRequired(fields: Field[], values: Record<string, string>, skipSecrets = false): Field | undefined {
  return fields.find((f) => f.required && !(values[f.key] ?? '').trim() && !(skipSecrets && f.type === 'password'));
}
