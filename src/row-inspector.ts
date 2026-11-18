const NUMERIC = /^(?:(?:tiny|small|medium|big)?int(?:eger)?\d*|numeric|decimal|float\d*|double|real|(?:big|small)?serial\d*|money|number|bit)(?:\b|\()/i;
export const isNumericType = (dataType: string) => NUMERIC.test(dataType);

/** Pretty-prints JSON objects and arrays; any other value is returned unchanged. */
export function formatInspectorValue(value: string) {
  const text = value.trim();
  if (!/^[[{]/.test(text)) return { text: value, json: false };
  try { return { text: JSON.stringify(JSON.parse(text), null, 2), json: true }; } catch { return { text: value, json: false }; }
}
