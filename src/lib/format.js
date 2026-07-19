/**
 * Formatting helpers. Currency is gold pieces, shown as "12.50gp".
 */
export function money(n) {
  const v = Number(n);
  return (isFinite(v) ? v.toFixed(2) : '0.00') + 'gp';
}
