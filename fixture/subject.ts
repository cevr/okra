// The code under optimization. Intentionally naive — room for the agent to improve.

/**
 * Sort an array of numbers.
 * Current implementation: bubble sort.
 */
export function sort(arr: number[]): number[] {
  const result = arr.slice();
  for (let i = 0; i < result.length; i++) {
    for (let j = 0; j < result.length - 1; j++) {
      if (result[j]! > result[j + 1]!) {
        const tmp = result[j]!;
        result[j] = result[j + 1]!;
        result[j + 1] = tmp;
      }
    }
  }
  return result;
}

/**
 * Find all prime numbers up to n.
 * Current implementation: trial division, no sieve.
 */
export function primes(n: number): number[] {
  const result: number[] = [];
  for (let i = 2; i <= n; i++) {
    let isPrime = true;
    for (let j = 2; j < i; j++) {
      if (i % j === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) result.push(i);
  }
  return result;
}

/**
 * Concatenate strings.
 * Current implementation: string += in a loop.
 */
export function buildString(n: number): string {
  let result = "";
  for (let i = 0; i < n; i++) {
    result += `item-${i},`;
  }
  return result;
}
