import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, mock, test } from 'node:test';

const { pool } = await import('../src/db');
after(async () => { await pool.end(); });

// Without these listeners a dropped database connection is an unhandled
// 'error' event, which crashes the whole API process.

test('a dropped idle connection is logged, not thrown', () => {
  const log = mock.method(console, 'error', () => {});
  try {
    assert.doesNotThrow(() => pool.emit('error', new Error('Connection terminated unexpectedly')));
    assert.match(String(log.mock.calls[0].arguments[0]), /Connection terminated unexpectedly/);
  } finally { log.mock.restore(); }
});

test('a dropped checked-out connection is logged, not thrown', () => {
  const log = mock.method(console, 'error', () => {});
  try {
    const client = new EventEmitter();
    pool.emit('connect', client);
    assert.doesNotThrow(() => client.emit('error', new Error('Connection terminated unexpectedly')));
    assert.equal(log.mock.callCount(), 1);
  } finally { log.mock.restore(); }
});
