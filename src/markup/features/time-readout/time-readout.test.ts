import { isRemainingTime, millisecondsOf } from './time-readout';

describe('millisecondsOf', () => {
  it.each([
    [12.456, '.456'],
    [0, '.000'],
    [1.001, '.001'],
    [0.3, '.300'],
    [59.9999, '.999'],
    [3600.05, '.050'],
  ])('reads %p s as %p', (seconds, expected) => {
    expect(millisecondsOf(seconds)).toBe(expected);
  });
});

describe('isRemainingTime', () => {
  it.each([
    ['-10:05', true],
    [' -0:00 ', true],
    ['0:30', false],
    ['1:02:03', false],
    ['', false],
  ])('reads %p as remaining time: %p', (text, expected) => {
    expect(isRemainingTime(text)).toBe(expected);
  });
});
