import { randomUUID } from 'crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { validateSkillContent } from '../config/validators.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import { SkillCatalogStore } from './catalog.ts';
import { NpxSkillsAdapter, inferSkillOrigin, type AcquireSkillRequest, type AcquiredSkill } from './command-adapter.ts';
import { diffSkillDirectories } from './diff.ts';
import { scanSkillRoot } from './inventory.ts';
import type {
  SkillOperationRecord,
  SkillOrigin,
  SkillInstallPlan,
  SkillTarget,
} from './types.ts';

const MAX_SKILL_BYTES = 50 * 1024 * 1024;

function resolveTargetRoot(target: SkillTarget): string {
  switch (target.source) {
    case 'global': return resolve(target.globalSkillsRoot);
    case 'workspace': return resolve(getWorkspaceSkillsPath(target.workspaceRoot));
    case 'project': return resolve(target.projectRoot, '.agents', 'skills');
  }
}

function validateSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid Skill slug: ${slug}`);
  }
}

function assertContained(root: string, path: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Skill path escapes target root: ${resolvedPath}`);
  }
}

function assertSafeSourceTree(directory: string): void {
  let totalSize = 0;
  function visit(current: string): void {
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in managed Skills: ${current}`);
    if (stats.isFile()) {
      totalSize += stats.size;
      if (totalSize > MAX_SKILL_BYTES) throw new Error('Skill exceeds the 50 MB size limit');
      return;
    }
    if (!stats.isDirectory()) throw new Error(`Unsupported file type in Skill: ${current}`);
    for (const entry of readdirSync(current)) visit(join(current, entry));
  }
  visit(directory);
}

export interface InstallSkillFromDirectoryRequest {
  sourceDirectory: string;
  slug: string;
  target: SkillTarget;
  origin: SkillOrigin;
  overwrite?: boolean;
}

export interface RemoveSkillRequest {
  slug: string;
  target: SkillTarget;
}

export interface InstallSkillFromNpxRequest {
  source: string;
  slug: string;
  target: SkillTarget;
  overwrite?: boolean;
  signal?: AbortSignal;
}

export interface SkillAcquirer {
  acquire(request: AcquireSkillRequest): Promise<AcquiredSkill>;
}

export class SkillOperationService {
  private readonly operationsPath: string;
  private readonly backupsRoot: string;

  constructor(
    private readonly dataRoot: string,
    private readonly catalog: SkillCatalogStore,
    private readonly acquirer: SkillAcquirer = new NpxSkillsAdapter(),
  ) {
    this.operationsPath = join(dataRoot, 'skills', 'operations.jsonl');
    this.backupsRoot = join(dataRoot, 'skills', 'backups');
  }

  async installFromNpx(request: InstallSkillFromNpxRequest): Promise<SkillOperationRecord> {
    const cliStagingRoot = join(this.dataRoot, 'skills', 'cli-staging');
    mkdirSync(cliStagingRoot, { recursive: true });
    const requestStagingRoot = mkdtempSync(join(cliStagingRoot, 'request-'));
    try {
      const acquired = await this.acquirer.acquire({
        source: request.source,
        slug: request.slug,
        stagingRoot: requestStagingRoot,
        signal: request.signal,
      });
      return this.installFromDirectory({
        sourceDirectory: acquired.skillDirectory,
        slug: request.slug,
        target: request.target,
        origin: inferSkillOrigin(request.source),
        overwrite: request.overwrite,
      });
    } finally {
      rmSync(requestStagingRoot, { recursive: true, force: true });
    }
  }

  async previewFromNpx(request: InstallSkillFromNpxRequest): Promise<SkillInstallPlan> {
    const cliStagingRoot = join(this.dataRoot, 'skills', 'cli-staging');
    mkdirSync(cliStagingRoot, { recursive: true });
    const requestStagingRoot = mkdtempSync(join(cliStagingRoot, 'preview-'));
    try {
      const acquired = await this.acquirer.acquire({
        source: request.source,
        slug: request.slug,
        stagingRoot: requestStagingRoot,
        signal: request.signal,
      });
      return this.previewFromDirectory({
        sourceDirectory: acquired.skillDirectory,
        slug: request.slug,
        target: request.target,
        origin: inferSkillOrigin(request.source),
        overwrite: request.overwrite,
      });
    } finally {
      rmSync(requestStagingRoot, { recursive: true, force: true });
    }
  }

  adopt(placement: ReturnType<typeof scanSkillRoot>[number], target: SkillTarget, origin: SkillOrigin = { type: 'unknown' }): SkillOperationRecord {
    const startedAt = Date.now();
    const id = randomUUID();
    const beforeRecord = this.catalog.getRecordForPlacement(placement.id);
    const record = this.catalog.adopt(placement, origin);
    const operation: SkillOperationRecord = {
      id, type: 'adopt', status: 'succeeded', slug: placement.slug,
      target, targetPath: placement.path, startedAt, completedAt: Date.now(),
      hadTarget: true, recordId: record.id, beforeRecord, afterHash: placement.contentHash,
    };
    this.appendOperation(operation);
    return operation;
  }

  stopManaging(placement: ReturnType<typeof scanSkillRoot>[number], target: SkillTarget): SkillOperationRecord {
    const record = this.catalog.getRecordForPlacement(placement.id);
    if (!record) throw new Error(`Managed Skill not found: ${placement.id}`);
    const startedAt = Date.now();
    const id = randomUUID();
    this.catalog.stopManaging(record.id);
    const operation: SkillOperationRecord = {
      id, type: 'stop-managing', status: 'succeeded', slug: placement.slug,
      target, targetPath: placement.path, startedAt, completedAt: Date.now(),
      hadTarget: true, recordId: record.id, beforeRecord: record, afterHash: placement.contentHash,
    };
    this.appendOperation(operation);
    return operation;
  }

  updateMetadata(
    placement: ReturnType<typeof scanSkillRoot>[number],
    target: SkillTarget,
    updates: { favorite?: boolean; tags?: string[] },
  ): SkillOperationRecord {
    const beforeRecord = this.catalog.getRecordForPlacement(placement.id);
    if (!beforeRecord) throw new Error(`Managed Skill not found: ${placement.id}`);
    const startedAt = Date.now();
    const id = randomUUID();
    const record = this.catalog.updateMetadata(beforeRecord.id, updates);
    const operation: SkillOperationRecord = {
      id, type: 'metadata', status: 'succeeded', slug: placement.slug,
      target, targetPath: placement.path, startedAt, completedAt: Date.now(),
      hadTarget: true, recordId: record.id, beforeRecord, afterHash: placement.contentHash,
    };
    this.appendOperation(operation);
    return operation;
  }

  listOperations(): SkillOperationRecord[] {
    if (!existsSync(this.operationsPath)) return [];
    return readFileSync(this.operationsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as SkillOperationRecord);
  }

  previewFromDirectory(request: InstallSkillFromDirectoryRequest): SkillInstallPlan {
    validateSlug(request.slug);
    const targetRoot = resolveTargetRoot(request.target);
    const targetPath = resolve(targetRoot, request.slug);
    assertContained(targetRoot, targetPath);
    assertSafeSourceTree(request.sourceDirectory);
    const skillFile = join(request.sourceDirectory, 'SKILL.md');
    if (!existsSync(skillFile)) {
      return {
        slug: request.slug,
        target: request.target,
        targetPath,
        operationType: existsSync(targetPath) ? 'update' : 'install',
        valid: false,
        diagnostics: [{ path: 'SKILL.md', message: 'SKILL.md not found' }],
      };
    }
    const validation = validateSkillContent(readFileSync(skillFile, 'utf8'), request.slug);
    const placementId = `${request.target.source}:${targetPath}`;
    const record = this.catalog.getRecordForPlacement(placementId);
    const baselineToLocalDiff = record?.baselineSnapshot && existsSync(record.baselineSnapshot) && existsSync(targetPath)
      ? diffSkillDirectories(record.baselineSnapshot, targetPath)
      : undefined;
    const baselineToUpstreamDiff = record?.baselineSnapshot && existsSync(record.baselineSnapshot)
      ? diffSkillDirectories(record.baselineSnapshot, request.sourceDirectory)
      : undefined;
    const localModified = baselineToLocalDiff?.changed ?? false;
    const upstreamChanged = baselineToUpstreamDiff?.changed ?? false;
    return {
      slug: request.slug,
      target: request.target,
      targetPath,
      operationType: existsSync(targetPath) ? 'update' : 'install',
      valid: validation.valid,
      diagnostics: validation.errors.map(issue => ({
        path: issue.path,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
      diff: existsSync(targetPath)
        ? diffSkillDirectories(targetPath, request.sourceDirectory)
        : undefined,
      baselineToLocalDiff,
      baselineToUpstreamDiff,
      localModified,
      upstreamChanged,
      threeWayConflict: localModified && upstreamChanged,
    };
  }

  installFromDirectory(request: InstallSkillFromDirectoryRequest): SkillOperationRecord {
    const startedAt = Date.now();
    const id = randomUUID();
    const targetRoot = resolveTargetRoot(request.target);
    const targetPath = resolve(targetRoot, request.slug);
    let hadTarget = false;
    let beforeSnapshot: string | undefined;
    let stagingRoot: string | undefined;
    let oldTarget: string | undefined;
    let committed = false;
    let adoptedRecordId: string | undefined;
    let beforeRecord;

    try {
      validateSlug(request.slug);
      assertContained(targetRoot, targetPath);
      assertSafeSourceTree(request.sourceDirectory);
      mkdirSync(targetRoot, { recursive: true });
      hadTarget = existsSync(targetPath);
      beforeRecord = this.catalog.getRecordForPlacement(`${request.target.source}:${targetPath}`);
      if (hadTarget && !request.overwrite) {
        throw new Error(`Skill already exists: ${request.slug}`);
      }

      stagingRoot = mkdtempSync(join(targetRoot, '.skill-manager-stage-'));
      const stagedSkill = join(stagingRoot, request.slug);
      cpSync(request.sourceDirectory, stagedSkill, { recursive: true, errorOnExist: true });
      assertSafeSourceTree(stagedSkill);
      const stagedSkillFile = join(stagedSkill, 'SKILL.md');
      if (!existsSync(stagedSkillFile)) throw new Error('Skill validation failed: SKILL.md not found');
      const validation = validateSkillContent(readFileSync(stagedSkillFile, 'utf8'), request.slug);
      if (!validation.valid) {
        throw new Error(`Skill validation failed: ${validation.errors.map(issue => issue.message).join('; ')}`);
      }

      if (hadTarget) {
        beforeSnapshot = join(this.backupsRoot, id, 'before');
        mkdirSync(dirname(beforeSnapshot), { recursive: true });
        cpSync(targetPath, beforeSnapshot, { recursive: true, errorOnExist: true });
      }

      oldTarget = join(targetRoot, `.skill-manager-old-${id}`);
      if (hadTarget) renameSync(targetPath, oldTarget);
      try {
        renameSync(stagedSkill, targetPath);
        committed = true;
      } catch (error) {
        if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
        if (hadTarget && existsSync(oldTarget)) renameSync(oldTarget, targetPath);
        throw error;
      }

      const placement = scanSkillRoot(targetRoot, request.target.source)
        .find(item => item.slug === request.slug);
      if (!placement || placement.status !== 'valid') {
        throw new Error('Installed Skill could not be loaded after commit');
      }
      const record = this.catalog.adopt(placement, request.origin);
      adoptedRecordId = record.id;
      const operation: SkillOperationRecord = {
        id,
        type: hadTarget ? 'update' : 'install',
        status: 'succeeded',
        slug: request.slug,
        target: request.target,
        targetPath,
        startedAt,
        completedAt: Date.now(),
        hadTarget,
        beforeSnapshot,
        recordId: record.id,
        beforeRecord,
        afterHash: placement.contentHash,
      };
      this.appendOperation(operation);
      if (oldTarget && existsSync(oldTarget)) rmSync(oldTarget, { recursive: true, force: true });
      return operation;
    } catch (error) {
      if (committed) {
        if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
        if (hadTarget && oldTarget && existsSync(oldTarget)) renameSync(oldTarget, targetPath);
        if (beforeRecord) this.catalog.restoreRecord(beforeRecord);
        else if (adoptedRecordId) this.catalog.stopManaging(adoptedRecordId);
      }
      const message = error instanceof Error ? error.message : 'Unknown Skill operation error';
      this.appendOperation({
        id,
        type: hadTarget ? 'update' : 'install',
        status: 'failed',
        slug: request.slug,
        target: request.target,
        targetPath,
        startedAt,
        completedAt: Date.now(),
        hadTarget,
        beforeSnapshot,
        beforeRecord,
        error: message,
      });
      throw new Error(message);
    } finally {
      if (stagingRoot && existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  remove(request: RemoveSkillRequest): SkillOperationRecord {
    validateSlug(request.slug);
    const startedAt = Date.now();
    const id = randomUUID();
    const targetRoot = resolveTargetRoot(request.target);
    const targetPath = resolve(targetRoot, request.slug);
    assertContained(targetRoot, targetPath);
    if (!existsSync(targetPath)) throw new Error(`Skill does not exist: ${request.slug}`);

    const placementId = `${request.target.source}:${targetPath}`;
    const record = this.catalog.getRecordForPlacement(placementId);
    const beforeSnapshot = join(this.backupsRoot, id, 'before');
    mkdirSync(dirname(beforeSnapshot), { recursive: true });
    cpSync(targetPath, beforeSnapshot, { recursive: true, errorOnExist: true });
    const displaced = join(targetRoot, `.skill-manager-remove-${id}`);
    renameSync(targetPath, displaced);
    try {
      if (record) this.catalog.stopManaging(record.id);
      const operation: SkillOperationRecord = {
        id,
        type: 'remove',
        status: 'succeeded',
        slug: request.slug,
        target: request.target,
        targetPath,
        startedAt,
        completedAt: Date.now(),
        hadTarget: true,
        beforeSnapshot,
        recordId: record?.id,
        beforeRecord: record,
      };
      this.appendOperation(operation);
      rmSync(displaced, { recursive: true, force: true });
      return operation;
    } catch (error) {
      if (!existsSync(targetPath) && existsSync(displaced)) renameSync(displaced, targetPath);
      if (record) this.catalog.restoreRecord(record);
      const message = error instanceof Error ? error.message : 'Unknown Skill removal error';
      this.appendOperation({
        id, type: 'remove', status: 'failed', slug: request.slug,
        target: request.target, targetPath, startedAt, completedAt: Date.now(),
        hadTarget: true, beforeSnapshot, recordId: record?.id, beforeRecord: record,
        error: message,
      });
      throw new Error(message);
    }
  }

  restore(operationId: string): SkillOperationRecord {
    const original = this.listOperations().find(operation => operation.id === operationId);
    if (!original || original.status !== 'succeeded') throw new Error(`Restorable operation not found: ${operationId}`);
    const id = randomUUID();
    const startedAt = Date.now();
    const currentExists = existsSync(original.targetPath);

    if (original.type === 'adopt') {
      if (original.beforeRecord) this.catalog.restoreRecord(original.beforeRecord);
      else if (original.recordId) this.catalog.stopManaging(original.recordId);
      return this.appendRestore(original, id, startedAt, currentExists);
    }
    if (original.type === 'stop-managing' || original.type === 'metadata') {
      if (!original.beforeRecord) throw new Error(`Catalog backup is missing for operation: ${operationId}`);
      this.catalog.restoreRecord(original.beforeRecord);
      return this.appendRestore(original, id, startedAt, currentExists);
    }

    if (original.type === 'remove' && currentExists) {
      throw new Error(`Cannot restore ${original.slug}: target was created since the operation`);
    }
    if (original.type !== 'remove' && currentExists && original.afterHash) {
      const current = scanSkillRoot(dirname(original.targetPath), original.target.source)
        .find(item => item.slug === original.slug);
      if (!current?.contentHash || current.contentHash !== original.afterHash) {
        throw new Error(`Cannot restore ${original.slug}: target changed since the operation`);
      }
    }

    if (original.hadTarget) {
      if (!original.beforeSnapshot || !existsSync(original.beforeSnapshot)) {
        throw new Error(`Backup is missing for operation: ${operationId}`);
      }
      const targetRoot = dirname(original.targetPath);
      const stagingRoot = mkdtempSync(join(targetRoot, '.skill-manager-restore-'));
      const stagedSkill = join(stagingRoot, original.slug);
      cpSync(original.beforeSnapshot, stagedSkill, { recursive: true, errorOnExist: true });
      const displaced = join(targetRoot, `.skill-manager-displaced-${id}`);
      if (currentExists) renameSync(original.targetPath, displaced);
      try {
        renameSync(stagedSkill, original.targetPath);
        if (existsSync(displaced)) rmSync(displaced, { recursive: true, force: true });
      } catch (error) {
        if (existsSync(original.targetPath)) rmSync(original.targetPath, { recursive: true, force: true });
        if (existsSync(displaced)) renameSync(displaced, original.targetPath);
        throw error;
      } finally {
        rmSync(stagingRoot, { recursive: true, force: true });
      }
      if (original.beforeRecord) this.catalog.restoreRecord(original.beforeRecord);
      else if (original.recordId) this.catalog.stopManaging(original.recordId);
    } else if (currentExists) {
      rmSync(original.targetPath, { recursive: true });
      const record = original.recordId ? this.catalog.getRecord(original.recordId) : undefined;
      if (record) this.catalog.stopManaging(record.id);
    }

    return this.appendRestore(original, id, startedAt, currentExists);
  }

  private appendRestore(
    original: SkillOperationRecord,
    id: string,
    startedAt: number,
    currentExists: boolean,
  ): SkillOperationRecord {
    const restore: SkillOperationRecord = {
      id,
      type: 'restore',
      status: 'succeeded',
      slug: original.slug,
      target: original.target,
      targetPath: original.targetPath,
      startedAt,
      completedAt: Date.now(),
      hadTarget: currentExists,
      restoredOperationId: original.id,
    };
    this.appendOperation(restore);
    return restore;
  }

  private appendOperation(operation: SkillOperationRecord): void {
    mkdirSync(dirname(this.operationsPath), { recursive: true });
    appendFileSync(this.operationsPath, `${JSON.stringify(operation)}\n`, { mode: 0o600 });
  }
}
