// Util — referenced from app.ts via `import { computeTotal } from './lib/utils'`.

export async function computeTotal(values: number[]): Promise<number> {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
