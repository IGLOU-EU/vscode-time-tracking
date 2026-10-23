import { describe, expect, it } from 'vitest';
import { fromPage } from './page-message';

const entry = { reason: 'Meeting', date: '2026-10-20', start: '09:00', end: '10:30' };

describe('fromPage', () => {
  it.each(['ready', 'openMonths'])('reads the %s signal', (type) => {
    expect(fromPage({ type })).toEqual({ type });
  });

  it('reads the add-time form', () => {
    expect(fromPage({ type: 'submitEntry', ...entry })).toEqual({ type: 'submitEntry', ...entry });
  });

  it('reads a request for the save dialog', () => {
    expect(fromPage({ type: 'exportBrowse', path: '/tmp/october.csv' })).toEqual({
      type: 'exportBrowse',
      path: '/tmp/october.csv',
    });
  });

  it.each(['day', 'session'])('reads an export by %s', (granularity) => {
    const message = { type: 'exportRun', month: '202610', granularity, path: 'october.csv' };
    expect(fromPage(message)).toEqual(message);
  });

  it('keeps only the fields of the message type', () => {
    expect(fromPage({ type: 'ready', path: '/etc/passwd' })).toEqual({ type: 'ready' });
    expect(fromPage({ type: 'exportBrowse', path: 'a.csv', month: '202610' })).toEqual({
      type: 'exportBrowse',
      path: 'a.csv',
    });
  });

  it.each([undefined, null, 'ready', 42, true, ['ready']])('rejects %j, which is not an object', (message) => {
    expect(fromPage(message)).toBeUndefined();
  });

  it.each([{}, { type: 1 }, { type: 'months' }, { type: 'READY' }, { kind: 'ready' }])(
    'rejects %j, which names no message the page sends',
    (message) => {
      expect(fromPage(message)).toBeUndefined();
    },
  );

  it.each([
    { ...entry, start: 900 },
    { reason: 'Meeting', date: '2026-10-20', start: '09:00' },
    { ...entry, reason: null },
  ])('rejects the add-time form %j, whose fields are not all text', (fields) => {
    expect(fromPage({ type: 'submitEntry', ...fields })).toBeUndefined();
  });

  it.each([{}, { path: 7 }])('rejects the save dialog request %j, without a text path', (fields) => {
    expect(fromPage({ type: 'exportBrowse', ...fields })).toBeUndefined();
  });

  it.each([
    { month: '202610', granularity: 'week', path: 'a.csv' },
    { month: 202610, granularity: 'day', path: 'a.csv' },
    { month: '202610', granularity: 'day', path: ['a.csv'] },
    { month: '202610', path: 'a.csv' },
  ])('rejects the export %j', (fields) => {
    expect(fromPage({ type: 'exportRun', ...fields })).toBeUndefined();
  });
});
