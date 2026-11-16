import { describe, expect, it } from 'vitest';
import { visibleWindow } from './shelf.js';

describe('visibleWindow', () => {
  it('shows nothing for an empty series', () => {
    expect(visibleWindow(0, 0).indices).toEqual([]);
  });

  it('shows all cards when there are at most three', () => {
    expect(visibleWindow(1, 0).indices).toEqual([0]);
    expect(visibleWindow(3, 2).indices).toEqual([0, 1, 2]);
  });

  it('keeps three visible cards and centres the active one', () => {
    expect(visibleWindow(5, 0).indices).toEqual([0, 1, 2]);
    expect(visibleWindow(5, 2).indices).toEqual([1, 2, 3]);
    expect(visibleWindow(5, 4).indices).toEqual([2, 3, 4]);
  });

  it('clamps out-of-range active indexes', () => {
    expect(visibleWindow(5, 9).indices).toEqual([2, 3, 4]);
    expect(visibleWindow(5, -3).indices).toEqual([0, 1, 2]);
  });

  it('reports the window start for positioning', () => {
    expect(visibleWindow(5, 3).start).toBe(2);
  });
});
