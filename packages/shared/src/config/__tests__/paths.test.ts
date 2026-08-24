import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveConfigDir } from '../paths.ts';

describe('resolveConfigDir', () => {
  const home = join(process.cwd(), 'fake-home');

  test('defaults to the BoAI data directory', () => {
    expect(resolveConfigDir({}, home)).toEqual({
      path: join(home, '.boai'),
      source: 'default',
    });
  });

  test('BOAI_HOME has precedence over the legacy override', () => {
    expect(resolveConfigDir({
      BOAI_HOME: join(home, 'boai-custom'),
      CRAFT_CONFIG_DIR: join(home, 'legacy-custom'),
    }, home)).toEqual({
      path: join(home, 'boai-custom'),
      source: 'BOAI_HOME',
    });
  });

  test('keeps CRAFT_CONFIG_DIR as a compatibility alias', () => {
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: join(home, 'legacy-custom') }, home)).toEqual({
      path: join(home, 'legacy-custom'),
      source: 'CRAFT_CONFIG_DIR',
    });
  });

  test('expands a home-relative BOAI_HOME', () => {
    expect(resolveConfigDir({ BOAI_HOME: '~/.boai-dev' }, home).path)
      .toBe(join(home, '.boai-dev'));
  });

  test('ignores blank overrides', () => {
    expect(resolveConfigDir({ BOAI_HOME: ' ', CRAFT_CONFIG_DIR: '' }, home).source)
      .toBe('default');
  });
});
