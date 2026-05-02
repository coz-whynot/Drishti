// Sample TS app for parser tests.
import { computeTotal } from './lib/utils';
import { Settings } from './config';
import React from 'react';

export class App {
  private name = 'sample';

  async run(): Promise<number> {
    try {
      return await computeTotal(Settings.values);
    } catch {}
    return 0;
  }

  swallow(): void {
    fetchSomething().catch(() => {});  // swallowed promise
  }
}

export function helper(x: number): string {
  if (x > 0) {
    if (x > 10) return 'big';
    return 'small';
  }
  return 'zero';
}

export const arrowFn = async (id: string) => {
  const data = await fetch(`/api/${id}`);
  return data;
};

declare function fetchSomething(): Promise<void>;
