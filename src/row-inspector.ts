const NUMERIC = /int|numeric|decimal|float|double|real|serial|money|number|bit/i;
export const isNumericType = (dataType: string) => NUMERIC.test(dataType);

/** Pretty-prints JSON objects and arrays; any other value is returned unchanged. */
export function formatInspectorValue(value: string) {
  const text = value.trim();
  if (!/^[[{]/.test(text)) return { text: value, json: false };
  try { return { text: JSON.stringify(JSON.parse(text), null, 2), json: true }; } catch { return { text: value, json: false }; }
}
