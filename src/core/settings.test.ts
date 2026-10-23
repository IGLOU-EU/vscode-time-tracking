import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NUMBER_BOUNDS, normalizeSettings, type SettingReader } from './settings';

// The fallback the adapter reads from the editor is the manifest default, so the tests use it too.
const properties = (
  JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { default: unknown }> } };
  }
).contributes.configuration.properties;
const manifestDefault: SettingReader = (key) => properties[`timeTracking.${key}`]?.default;

/** The settings read when only the given keys are written by hand, every other one left unset. */
const settingsWith = (values: Record<string, unknown>) =>
  normalizeSettings((key) => (key in values ? values[key] : manifestDefault(key)), manifestDefault);

const unset = settingsWith({});

describe('normalizeSettings', () => {
  it('converts the minute and hour settings into milliseconds', () => {
    const s = settingsWith({
      inactivityThresholdMinutes: 10,
      backgroundProcessTimeoutMinutes: 20,
      focusedIdleCapMinutes: 45,
      debugIdleCapHours: 2,
      minSessionMinutes: 0.5,
    });
    expect([s.idleThresholdMs, s.backgroundTimeoutMs, s.focusCapMs, s.debugIdleCapMs, s.minSessionMs]).toEqual([
      600_000, 1_200_000, 2_700_000, 7_200_000, 30_000,
    ]);
  });

  it('raises a focus cap shorter than the inactivity threshold to the threshold', () => {
    expect(settingsWith({ inactivityThresholdMinutes: 40, focusedIdleCapMinutes: 10 }).focusCapMs).toBe(2_400_000);
  });

  it('keeps a focus cap of 0 disabled', () => {
    expect(settingsWith({ focusedIdleCapMinutes: 0 }).focusCapMs).toBe(0);
  });

  it('trims the project name and the git email', () => {
    const s = settingsWith({ projectName: '  Alpha ', gitUserEmail: ' me@example.org\n' });
    expect([s.projectName, s.gitUserEmail]).toEqual(['Alpha', 'me@example.org']);
  });

  it('splits each export column at its first equals sign', () => {
    expect(settingsWith({ exportColumns: ['Date={date}', 'Note=a=b', 'Blank'] }).exportColumns).toEqual([
      { name: 'Date', template: '{date}' },
      { name: 'Note', template: 'a=b' },
      { name: 'Blank', template: '' },
    ]);
  });

  it('truncates each preset reason and drops the empty ones', () => {
    const long = 'x'.repeat(40);
    expect(settingsWith({ manualReasons: [' Review ', '  ', long] }).manualReasons).toEqual(['Review', 'x'.repeat(32)]);
  });

  it('capitalizes the default reason', () => {
    expect(settingsWith({ defaultReason: 'support' }).defaultReason).toBe('Support');
  });

  it('keeps a valid export date format', () => {
    expect(settingsWith({ exportDateFormat: 'rfc850' }).exportDateFormat).toBe('rfc850');
  });
});

describe('normalizeSettings with a value written by hand', () => {
  const NOT_A_NUMBER: [string, unknown][] = [
    ['a numeric string', '45'],
    ['a word', 'abc'],
    ['null', null],
    ['NaN', Number.NaN],
    ['an infinite number', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an array', [5]],
    ['an object', { minutes: 5 }],
  ];

  describe.each(Object.keys(NUMBER_BOUNDS))('%s', (key) => {
    it.each(NOT_A_NUMBER)('falls back to the default for %s', (_label, value) => {
      expect(settingsWith({ [key]: value })).toEqual(unset);
    });

    it('raises a negative value to the minimum', () => {
      const { minimum } = NUMBER_BOUNDS[key as keyof typeof NUMBER_BOUNDS];
      expect(settingsWith({ [key]: -5 })).toEqual(settingsWith({ [key]: minimum }));
    });
  });

  it('raises an inactivity threshold of 0 to the minimum', () => {
    const atMinimum = settingsWith({ inactivityThresholdMinutes: NUMBER_BOUNDS.inactivityThresholdMinutes.minimum });
    expect(settingsWith({ inactivityThresholdMinutes: 0 })).toEqual(atMinimum);
  });

  it('lowers a font size above the maximum to the maximum', () => {
    const { maximum } = NUMBER_BOUNDS.fontSize;
    expect(settingsWith({ fontSize: 400 }).fontSizePx).toBe(maximum);
  });

  it('keeps the focus cap when the inactivity threshold is not a number', () => {
    // Multiplied as is, 'abc' gave NaN, and the cap raised to NaN no longer bounded a forgotten session.
    expect(settingsWith({ inactivityThresholdMinutes: 'abc' }).focusCapMs).toBe(unset.focusCapMs);
  });

  it.each(['gitUserEmail', 'projectName', 'exportSeparator', 'defaultReason'])(
    'falls back to the default when %s is not a string',
    (key) => {
      for (const value of [42, null, true, ['a'], { a: 1 }]) {
        expect(settingsWith({ [key]: value })).toEqual(unset);
      }
    },
  );

  it('falls back to the default when debugLogging is not a boolean', () => {
    for (const value of ['true', 1, null, [true]]) {
      expect(settingsWith({ debugLogging: value })).toEqual(unset);
    }
  });

  it.each(['manualReasons', 'exportColumns'])('falls back to the default when %s is not a list of strings', (key) => {
    for (const value of ['Date={date}', null, 42, { a: 'b' }, ['Date={date}', 42], [null]]) {
      expect(settingsWith({ [key]: value })).toEqual(unset);
    }
  });

  it('falls back to the default for an export date format outside the list', () => {
    for (const value of ['ISO8601', 'rfc', '', 42, null]) {
      expect(settingsWith({ exportDateFormat: value })).toEqual(unset);
    }
  });
});
