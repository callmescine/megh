import { describe, it, expect } from 'vitest';
import { parseMemory } from '../sessions/container-manager.js';
import { parseSsOutput } from '../preview/port-detector.js';

describe('parseMemory', () => {
  it('parses gigabytes', () => {
    expect(parseMemory('2g')).toBe(2 * 1024 * 1024 * 1024);
    expect(parseMemory('1G')).toBe(1024 * 1024 * 1024);
  });

  it('parses megabytes', () => {
    expect(parseMemory('512m')).toBe(512 * 1024 * 1024);
    expect(parseMemory('256M')).toBe(256 * 1024 * 1024);
  });

  it('parses decimal values', () => {
    expect(parseMemory('1.5g')).toBe(1.5 * 1024 * 1024 * 1024);
  });

  it('throws on invalid input', () => {
    expect(() => parseMemory('')).toThrow('Invalid memory string');
    expect(() => parseMemory('2tb')).toThrow('Invalid memory string');
    expect(() => parseMemory('abc')).toThrow('Invalid memory string');
  });
});

describe('parseSsOutput', () => {
  it('parses IPv4 LISTEN lines', () => {
    const output = `State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port  Process
LISTEN  0       128      0.0.0.0:5173          0.0.0.0:*
LISTEN  0       128      0.0.0.0:3000          0.0.0.0:*`;
    const ports = parseSsOutput(output);
    expect(ports).toContain(5173);
    expect(ports).toContain(3000);
  });

  it('parses IPv6 LISTEN lines', () => {
    const output = `State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port  Process
LISTEN  0       128      [::]:3000              [::]:*`;
    const ports = parseSsOutput(output);
    expect(ports).toContain(3000);
  });

  it('deduplicates IPv4 and IPv6 ports', () => {
    const output = `State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port  Process
LISTEN  0       128      0.0.0.0:3000          0.0.0.0:*
LISTEN  0       128      [::]:3000              [::]:*`;
    const ports = parseSsOutput(output);
    expect(ports).toEqual([3000]);
  });

  it('ignores non-LISTEN lines', () => {
    const output = `State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port
ESTAB   0       0        10.0.0.1:3000         10.0.0.2:45678`;
    const ports = parseSsOutput(output);
    expect(ports).toEqual([]);
  });

  it('handles empty output', () => {
    expect(parseSsOutput('')).toEqual([]);
  });
});

describe('cost calculation', () => {
  it('calculates cost with markup', () => {
    const rates = { input: 3.0, output: 15.0 };
    const markupMultiplier = 2.0;
    const inputTokens = 1000;
    const outputTokens = 500;
    const inputCost = (inputTokens / 1_000_000) * rates.input;
    const outputCost = (outputTokens / 1_000_000) * rates.output;
    const cost = (inputCost + outputCost) * markupMultiplier;
    expect(cost).toBeCloseTo(0.000021, 6);
  });
});
