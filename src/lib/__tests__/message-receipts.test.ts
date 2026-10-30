import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { effectiveDirectMessageStatus } from '../message-receipts';

test('a server acknowledgement alone does not mean delivery', () => {
  assert.equal(effectiveDirectMessageStatus('SENT', []), 'SENT');
});

test('a recipient receipt corrects a stale single check mark', () => {
  assert.equal(effectiveDirectMessageStatus('SENT', [{userJid:'recipient@lid',deliveredAt:1792713253}]), 'DELIVERED');
  assert.equal(effectiveDirectMessageStatus('DELIVERED', [{userJid:'recipient@lid',readAt:1792713260}]), 'READ');
});

test('a later delivery receipt never downgrades a read message', () => {
  assert.equal(effectiveDirectMessageStatus('READ', [{userJid:'recipient@lid',deliveredAt:1792713253}]), 'READ');
});
