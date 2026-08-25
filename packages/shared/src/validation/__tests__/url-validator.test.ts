import { describe, expect, test } from 'bun:test';
import { validateMcpUrl } from '../url-validator.ts';

describe('validateMcpUrl', () => {
  test.each([
    'https://mcp.craft.do/links/ABC123/mcp',
    'https://mcp.craft.do/links/xY9-abc_123/mcp',
    'https://mcp.craft.do/links/xY9-abc_123/mcp/',
  ])('accepts %s', async (url) => {
    expect(await validateMcpUrl(url)).toEqual({ valid: true });
  });

  test.each([
    'mcp.craft.do/links/abc/mcp',
    'http://mcp.craft.do/links/abc/mcp',
    'https://evil.com/mcp.craft.do/links/abc/mcp',
    'https://mcp.craft.do.evil.com/links/abc/mcp',
    'https://user:pass@mcp.craft.do/links/abc/mcp',
    'https://mcp.craft.do/links/abc!',
    'https://mcp.craft.do/links/abc/mcp?x=1',
    ' https://mcp.craft.do/links/abc/mcp',
  ])('rejects %s', async (url) => {
    expect((await validateMcpUrl(url)).valid).toBe(false);
  });
});
