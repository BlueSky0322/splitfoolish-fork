import { describe, expect, test } from 'vitest';
import { evaluateSum } from './math';

describe('evaluateSum', () => {
  test.each([
    ['90', 90],
    ['12.50', 12.5],
    ['.5', 0.5],
    ['30*3', 90],
    ['30 × 3', 90],
    ['10 + 20 * 2', 50],
    ['(10 + 20) * 2', 60],
    ['100 / 4 - 5', 20],
    ['9 ÷ 2', 4.5],
    ['-5 + 10', 5],
    ['2 * -3', -6],
  ])('%s is %d', (text, value) => {
    expect(evaluateSum(text)).toBe(value);
  });

  test.each(['', 'abc', '3 +', '(3 + 4', '3 + 4)', '1 / 0', '2 ** 3', '1e5', 'sqrt(4)'])(
    "'%s' isn't an amount",
    (text) => {
      expect(evaluateSum(text)).toBeNull();
    },
  );
});
