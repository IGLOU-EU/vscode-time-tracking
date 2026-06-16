import { describe, it, expect } from 'vitest';
import { projectIdFromFsPath } from './project';

describe('projectIdFromFsPath', () => {
  it('is a 16-character hex string', () => {
    expect(projectIdFromFsPath('/home/me/project')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same path', () => {
    expect(projectIdFromFsPath('/home/me/project')).toBe(projectIdFromFsPath('/home/me/project'));
  });

  it('ignores a trailing slash so the same folder yields the same id', () => {
    expect(projectIdFromFsPath('/home/me/project/')).toBe(projectIdFromFsPath('/home/me/project'));
  });

  it('produces different ids for different paths', () => {
    expect(projectIdFromFsPath('/home/me/a')).not.toBe(projectIdFromFsPath('/home/me/b'));
  });
});
