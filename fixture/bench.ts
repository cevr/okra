#!/usr/bin/env bun
import { sort, primes, buildString } from "./subject.js";

// Generate deterministic test data
const SIZE = 10_000;
const data: number[] = [];
for (let i = 0; i < SIZE; i++) {
  data.push(Math.sin(i) * SIZE);
}

const PRIME_LIMIT = 10_000;
const STRING_SIZE = 50_000;
const WARMUP = 3;
const RUNS = 10;

function bench(name: string, fn: () => void): number {
  // Warmup
  for (let i = 0; i < WARMUP; i++) fn();

  // Timed runs
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  // Median
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

const sortMs = bench("sort", () => sort(data));
const primesMs = bench("primes", () => primes(PRIME_LIMIT));
const stringMs = bench("string", () => buildString(STRING_SIZE));
const totalMs = sortMs + primesMs + stringMs;

console.log(`sort: ${sortMs.toFixed(2)} ms`);
console.log(`primes: ${primesMs.toFixed(2)} ms`);
console.log(`string: ${stringMs.toFixed(2)} ms`);
console.log(`RESULT ${totalMs.toFixed(2)}`);
