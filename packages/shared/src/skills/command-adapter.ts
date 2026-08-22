import { existsSync, mkdirSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import type { SkillOrigin } from './types.ts';

export interface SkillCommandRequest {
  executable: string;
  args: string[];
  cwd: string;
  shell: false;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SkillCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SkillCommandRunner = (request: SkillCommandRequest) => Promise<SkillCommandResult>;

export interface AcquireSkillRequest {
  source: string;
  slug: string;
  stagingRoot: string;
  signal?: AbortSignal;
}

export interface AcquiredSkill {
  skillDirectory: string;
  workingDirectory: string;
  stdout: string;
  stderr: string;
}

const OUTPUT_LIMIT = 1024 * 1024;

export function inferSkillOrigin(source: string): SkillOrigin {
  const value = source.trim();
  if (value.startsWith('.') || value.startsWith('/')) return { type: 'local', path: value };
  if (value.startsWith('npm:')) {
    const spec = value.slice(4);
    const versionAt = spec.lastIndexOf('@');
    const hasVersion = versionAt > 0;
    return {
      type: 'registry',
      package: hasVersion ? spec.slice(0, versionAt) : spec,
      version: hasVersion ? spec.slice(versionAt + 1) : undefined,
    };
  }

  const hashAt = value.lastIndexOf('#');
  const at = value.lastIndexOf('@');
  const shortGit = /^[\w.-]+\/[\w.-]+(?:@[^/]+)?$/.test(value);
  const refAt = hashAt >= 0 ? hashAt : shortGit && at > value.indexOf('/') ? at : -1;
  const url = refAt >= 0 ? value.slice(0, refAt) : value;
  const ref = refAt >= 0 ? value.slice(refAt + 1) : undefined;
  return {
    type: 'git',
    url,
    ref,
    commit: ref && /^[a-f0-9]{40}$/i.test(ref) ? ref : undefined,
    version: ref && /^v?\d+\.\d+\.\d+/.test(ref) ? ref : undefined,
  };
}

function safeCommandEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'LANG', 'LC_ALL',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSH_AUTH_SOCK',
    'npm_config_cache', 'npm_config_registry',
  ];
  const env: NodeJS.ProcessEnv = {
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
  };
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export const runSkillCommand: SkillCommandRunner = request => new Promise((resolve, reject) => {
  const child = spawn(request.executable, request.args, {
    cwd: request.cwd,
    shell: request.shell,
    env: safeCommandEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: request.signal,
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => child.kill('SIGTERM'), request.timeoutMs);

  child.stdout.on('data', chunk => {
    if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString().slice(0, OUTPUT_LIMIT - stdout.length);
  });
  child.stderr.on('data', chunk => {
    if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString().slice(0, OUTPUT_LIMIT - stderr.length);
  });
  child.once('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('close', (code, signal) => {
    clearTimeout(timeout);
    if (signal && code === null) {
      reject(new Error(`Skills CLI terminated by ${signal}`));
      return;
    }
    resolve({ exitCode: code ?? 1, stdout, stderr });
  });
});

export class NpxSkillsAdapter {
  constructor(private readonly runner: SkillCommandRunner = runSkillCommand) {}

  async acquire(request: AcquireSkillRequest): Promise<AcquiredSkill> {
    if (!request.source.trim() || request.source.startsWith('-')) {
      throw new Error('Invalid Skills source');
    }
    if (!/^[a-z0-9-]+$/.test(request.slug)) {
      throw new Error(`Invalid Skill slug: ${request.slug}`);
    }

    mkdirSync(request.stagingRoot, { recursive: true });
    const workingDirectory = mkdtempSync(join(request.stagingRoot, 'npx-skills-'));
    const command: SkillCommandRequest = {
      executable: 'npx',
      args: [
        '--yes',
        'skills',
        'add',
        request.source,
        '--skill',
        request.slug,
        '--agent',
        'universal',
        '--yes',
        '--copy',
      ],
      cwd: workingDirectory,
      shell: false,
      timeoutMs: 120_000,
      signal: request.signal,
    };
    const result = await this.runner(command);
    if (result.exitCode !== 0) {
      throw new Error(`Skills CLI failed (${result.exitCode}): ${result.stderr || result.stdout}`);
    }

    const skillDirectory = join(workingDirectory, '.agents', 'skills', request.slug);
    if (!existsSync(join(skillDirectory, 'SKILL.md'))) {
      throw new Error(`Skills CLI completed without producing ${request.slug}`);
    }
    return {
      skillDirectory,
      workingDirectory,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
