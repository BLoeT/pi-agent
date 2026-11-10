import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from '../background.js';

test('overlap is skipped and the next run works', async () => {
  let finish, calls = 0;
  const task = singleFlight(() => { calls++; return new Promise(resolve => finish = resolve); });
  const first = task();
  assert.equal(await task(), false);
  assert.equal(calls, 1);
  finish(); assert.equal(await first, true);
  const second = task(); finish(); assert.equal(await second, true);
  assert.equal(calls, 2);
});
test('failure releases the guard', async () => {
  let errors = 0;
  const task = singleFlight(async () => { throw Error('test'); }, () => errors++);
  assert.equal(await task(), false);
  assert.equal(await task(), false);
  assert.equal(errors, 2);
});
