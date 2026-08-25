/** Deterministic validation for Craft MCP share URLs. */

import type { AgentError } from '../agent/errors.ts';
import { debug } from '../utils/debug.ts';

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  /** Kept in the public result shape for callers that also display typed network errors. */
  typedError?: AgentError;
}

const CRAFT_MCP_PATH = /^\/links\/[A-Za-z0-9_-]+\/mcp\/?$/;

/**
 * Validate a Craft MCP URL locally.
 *
 * The accepted format is intentionally narrow:
 * https://mcp.craft.do/links/<link-id>/mcp
 */
export async function validateMcpUrl(url: string): Promise<UrlValidationResult> {
  debug('[url-validator] Validating URL:', url);

  if (!url || url !== url.trim()) {
    return { valid: false, error: 'Enter only the MCP URL without surrounding text or spaces.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Enter a valid URL beginning with https://.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'The MCP URL must use https://.' };
  }

  if (parsed.hostname !== 'mcp.craft.do' || parsed.port) {
    return { valid: false, error: 'The MCP URL must use the mcp.craft.do domain.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials are not allowed in the MCP URL.' };
  }

  if (parsed.search || parsed.hash || !CRAFT_MCP_PATH.test(parsed.pathname)) {
    return {
      valid: false,
      error: 'Use a Craft MCP URL in the form https://mcp.craft.do/links/<link-id>/mcp.',
    };
  }

  return { valid: true };
}
