/** Secret-free configuration metadata shared with the renderer. */
export type LocalConfigIssue = 'missing-api-key' | 'missing-model' | 'invalid-base-url' | 'unsupported-config' | 'invalid-config';
export interface DetectedApiKeyConfig {
  sourceId: 'codex-api-key' | 'claude-code-api-key' | 'openai-config';
  authType: 'api_key';
  provider: 'openai' | 'anthropic';
  providerName: string;
  configId: string;
  sourcePath?: string;
  baseUrl?: string;
  model?: string;
  api: 'openai-responses' | 'openai-completions' | 'anthropic-messages';
  hasApiKey: boolean;
  usable: boolean;
  issue?: LocalConfigIssue;
  envKey?: string;
}
export interface LocalApiKeyConfig {
  detected: DetectedApiKeyConfig;
  /** Server-side only. Never return this container through RPC. */
  apiKey?: string;
}
export interface LocalConfigScanOptions { directory?: string }

export interface LocalApiKeyImportOptions extends LocalConfigScanOptions { model?: string }
