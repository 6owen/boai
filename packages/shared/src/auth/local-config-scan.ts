import { lstatSync, readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { readCodexApiKeyConfig } from './codex-api-key-detection.ts';
import { readCodexCliChatGptTokens, getLocalLoginConfigId, decodeCodexIdTokenEmail, resolveCodexCliHome, type DetectedLogin } from './local-login-detection.ts';
import { parseConfigEnv, parseLocalApiConfigs } from './local-api-config-parser.ts';
import type { LocalApiKeyConfig, LocalConfigScanOptions, LocalApiKeyImportOptions } from './local-config-types.ts';

export interface LocalConfigScanResult {
  logins: DetectedLogin[];
  /** True if a directory/file/size limit prevented a complete scan. */
  truncated: boolean;
  skippedFiles: number;
}
interface ScanOptions extends LocalConfigScanOptions { env?: NodeJS.ProcessEnv; userHome?: string }
const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 200;
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', '.next', '.venv', 'venv', 'vendor', 'sessions', 'history', 'logs']);
const configFile = (name: string) => name.startsWith('.env') || ['.env', '.json', '.toml', '.yaml', '.yml'].includes(extname(name).toLowerCase());

function scan(options: ScanOptions) {
  const env = options.env ?? process.env;
  const logins: DetectedLogin[] = [];
  const apiConfigs: LocalApiKeyConfig[] = [];
  const seenRoots = new Set<string>();
  let files = 0, entries = 0, truncated = false, skippedFiles = 0;
  function read(path: string): string | undefined {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) return undefined;
      if (stat.size > MAX_BYTES) { truncated = true; skippedFiles++; return undefined; }
      return readFileSync(path, 'utf8');
    } catch { skippedFiles++; return undefined; }
  }
  function add(config: LocalApiKeyConfig | null) {
    if (config && !apiConfigs.some(item => item.detected.configId === config.detected.configId)) {
      apiConfigs.push(config); logins.push(config.detected);
    }
  }
  function scanDirectory(directory: string, depth: number, knownCodex = false, recurse = true) {
    if (seenRoots.has(directory)) return;
    seenRoots.add(directory);
    let items;
    try { items = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { if (knownCodex) add(readCodexApiKeyConfig({ codexHome: directory, env })); else skippedFiles++; return; }
    const names = new Set(items.filter(item => item.isFile()).map(item => item.name));
    const dotEnv = names.has('.env') ? read(join(directory, '.env')) : undefined;
    const scopeEnv = { ...parseConfigEnv(dotEnv ?? ''), ...env };
    const toml = names.has('config.toml') ? read(join(directory, 'config.toml')) : undefined;
    const auth = names.has('auth.json') ? read(join(directory, 'auth.json')) : undefined;
    const codex = knownCodex || !!toml?.match(/(?:model_provider|model_providers|openai_base_url|wire_api)\s*(?:=|\])/)
      || !!auth?.match(/"(?:auth_mode|OPENAI_API_KEY|tokens)"\s*:/);
    // Do not let the Codex reader follow files that this bounded scan refused.
    const safeCodex = (!existsSync(join(directory, 'config.toml')) || toml !== undefined)
      && (!existsSync(join(directory, 'auth.json')) || auth !== undefined);
    if (codex && safeCodex) {
      add(readCodexApiKeyConfig({ codexHome: directory, env: scopeEnv }));
      const tokens = readCodexCliChatGptTokens({ codexHome: directory, env: scopeEnv });
      if (tokens) logins.push({
        authType: 'oauth', sourceId: 'codex-cli', provider: 'openai-codex',
        configId: getLocalLoginConfigId(tokens), sourcePath: join(directory, 'auth.json'),
        accountEmail: decodeCodexIdTokenEmail(tokens.idToken), expiresAt: tokens.expiresAt, usable: tokens.expiresAt > Date.now(),
      });
    }
    for (const item of items) {
      if (++entries > MAX_ENTRIES || files >= MAX_FILES) { truncated = true; return; }
      const path = join(directory, item.name);
      if (item.isDirectory() && recurse && !SKIP_DIRS.has(item.name)) {
        if (depth < MAX_DEPTH) scanDirectory(path, depth + 1, item.name === '.codex');
        else truncated = true;
      } else if (item.isFile() && configFile(item.name)) {
        if (codex && ['auth.json', 'config.toml'].includes(item.name)) continue;
        files++;
        const content = item.name === '.env' ? dotEnv : read(path);
        if (content !== undefined) parseLocalApiConfigs(content, path, scopeEnv).forEach(add);
      }
    }
  }
  if (options.directory) {
    let directory: string;
    try {
      directory = realpathSync(resolve(options.directory));
      if (!lstatSync(directory).isDirectory()) throw new Error();
    } catch { throw new Error('Unable to read the selected configuration directory'); }
    scanDirectory(directory, 0, basename(directory) === '.codex');
  } else {
    // Default discovery is deliberately confined to tool config directories.
    const codex = resolveCodexCliHome(env);
    const claude = resolve(env.CLAUDE_CONFIG_DIR?.trim() || join(options.userHome ?? homedir(), '.claude'));
    scanDirectory(existsSync(codex) ? realpathSync(codex) : codex, 0, true, false);
    if (existsSync(claude)) scanDirectory(realpathSync(claude), 0, false, false);
  }
  return { logins, apiConfigs, truncated, skippedFiles };
}

/** Only this secret-free projection may cross the RPC boundary. */
export function scanLocalConfigs(options: ScanOptions = {}): LocalConfigScanResult {
  const { logins, truncated, skippedFiles } = scan(options);
  return { logins, truncated, skippedFiles };
}

/** Re-read the selected scope and match file, object, endpoint and model at import time. */
export function readScannedApiKeyConfig(configId: string, options: ScanOptions & LocalApiKeyImportOptions = {}): LocalApiKeyConfig | null {
  const config = scan(options).apiConfigs.find(config => config.detected.configId === configId) ?? null;
  const model = options.model?.trim();
  if (config && (!config.detected.issue || config.detected.issue === 'missing-model') && !config.detected.model && model && model.length <= 400) {
    return { ...config, detected: { ...config.detected, model, usable: true, issue: undefined } };
  }
  return config;
}
