/**
 * Memindahkan satu elemen ke indeks baru dan mengembalikan salinan. `to` dibatasi ke `[0, length-1]`;
 * `from` di luar rentang mengembalikan salinan apa adanya (tidak ada yang dipindah).
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items];
  if (from < 0 || from >= result.length) return result;
  // Stryker disable next-line ArithmeticOperator: after the splice below the array is one shorter, so any index from length - 1 upward inserts at the end; "length + 1" moves the item to the same place.
  const target = Math.min(Math.max(to, 0), result.length - 1);
  const [moved] = result.splice(from, 1);
  result.splice(target, 0, moved as T);
  return result;
}
