import { randomUUID } from 'crypto';
import {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import type {
  SkillCatalogData,
  SkillInventory,
  SkillOrigin,
  SkillPlacement,
  SkillRecord,
} from './types.ts';

const EMPTY_CATALOG: SkillCatalogData = { version: 1, records: [] };

function isCatalogData(value: unknown): value is SkillCatalogData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SkillCatalogData>;
  return candidate.version === 1 && Array.isArray(candidate.records);
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

export class SkillCatalogStore {
  private readonly catalogPath: string;
  private readonly baselinesRoot: string;

  constructor(dataRoot: string) {
    this.catalogPath = join(dataRoot, 'skills', 'catalog.json');
    this.baselinesRoot = join(dataRoot, 'skills', 'baselines');
  }

  load(): SkillCatalogData {
    if (!existsSync(this.catalogPath)) return { ...EMPTY_CATALOG, records: [] };
    const parsed: unknown = JSON.parse(readFileSync(this.catalogPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !('version' in parsed) && Array.isArray((parsed as { records?: unknown }).records)) {
      const migrated: SkillCatalogData = {
        version: 1,
        records: (parsed as { records: SkillRecord[] }).records,
      };
      writeJsonAtomic(this.catalogPath, migrated);
      return migrated;
    }
    if (!isCatalogData(parsed)) {
      throw new Error(`Unsupported or invalid Skill catalog: ${this.catalogPath}`);
    }
    return parsed;
  }

  getRecord(id: string): SkillRecord | undefined {
    return this.load().records.find(record => record.id === id);
  }

  getRecordForPlacement(placementId: string): SkillRecord | undefined {
    return this.load().records.find(record => record.placementId === placementId);
  }

  adopt(placement: SkillPlacement, origin: SkillOrigin = { type: 'unknown' }): SkillRecord {
    if (placement.status !== 'valid' || !placement.skill || !placement.contentHash) {
      throw new Error(`Cannot adopt invalid Skill placement: ${placement.path}`);
    }

    const catalog = this.load();
    const now = Date.now();
    const existing = catalog.records.find(record => record.placementId === placement.id);
    const recordId = existing?.id ?? randomUUID();
    const baselineSnapshot = join(this.baselinesRoot, recordId, placement.contentHash);
    if (!existsSync(baselineSnapshot)) {
      mkdirSync(dirname(baselineSnapshot), { recursive: true });
      const temporarySnapshot = `${baselineSnapshot}.${randomUUID()}.tmp`;
      cpSync(placement.path, temporarySnapshot, { recursive: true, errorOnExist: true });
      renameSync(temporarySnapshot, baselineSnapshot);
    }
    const record: SkillRecord = existing
      ? {
          ...existing,
          slug: placement.slug,
          baselineHash: placement.contentHash,
          baselineSnapshot,
          origin,
          updatedAt: now,
        }
      : {
          id: recordId,
          slug: placement.slug,
          placementId: placement.id,
          baselineHash: placement.contentHash,
          baselineSnapshot,
          origin,
          managedAt: now,
          updatedAt: now,
        };

    catalog.records = existing
      ? catalog.records.map(item => item.id === record.id ? record : item)
      : [...catalog.records, record];
    writeJsonAtomic(this.catalogPath, catalog);
    return record;
  }

  stopManaging(recordId: string): void {
    const catalog = this.load();
    const records = catalog.records.filter(record => record.id !== recordId);
    if (records.length === catalog.records.length) return;
    writeJsonAtomic(this.catalogPath, { ...catalog, records });
  }

  restoreRecord(record: SkillRecord): void {
    const catalog = this.load();
    const records = catalog.records.filter(item => item.id !== record.id && item.placementId !== record.placementId);
    writeJsonAtomic(this.catalogPath, { ...catalog, records: [...records, record] });
  }

  updateMetadata(
    recordId: string,
    updates: { favorite?: boolean; tags?: string[] },
  ): SkillRecord {
    const catalog = this.load();
    const current = catalog.records.find(record => record.id === recordId);
    if (!current) throw new Error(`Managed Skill record not found: ${recordId}`);
    const tags = updates.tags === undefined
      ? current.tags
      : Array.from(new Set(updates.tags.map(tag => tag.trim()).filter(Boolean))).slice(0, 20);
    const updated: SkillRecord = {
      ...current,
      favorite: updates.favorite ?? current.favorite,
      tags,
      updatedAt: Date.now(),
    };
    writeJsonAtomic(this.catalogPath, {
      ...catalog,
      records: catalog.records.map(record => record.id === recordId ? updated : record),
    });
    return updated;
  }

  updateOrigin(recordId: string, origin: SkillOrigin): SkillRecord {
    const catalog = this.load();
    const current = catalog.records.find(record => record.id === recordId);
    if (!current) throw new Error(`Managed Skill record not found: ${recordId}`);
    const updated: SkillRecord = { ...current, origin, updatedAt: Date.now() };
    writeJsonAtomic(this.catalogPath, {
      ...catalog,
      records: catalog.records.map(record => record.id === recordId ? updated : record),
    });
    return updated;
  }

  annotate(inventory: SkillInventory): SkillInventory {
    const records = this.load().records;
    const recordsByPlacement = new Map(records.map(record => [record.placementId, record] as const));
    const presentIds = new Set(inventory.placements.map(placement => placement.id));
    const missingPlacements: SkillPlacement[] = records.flatMap(record => {
      if (presentIds.has(record.placementId)) return [];
      const separator = record.placementId.indexOf(':');
      const source = record.placementId.slice(0, separator);
      if (separator < 0 || (source !== 'global' && source !== 'workspace' && source !== 'project')) return [];
      const path = record.placementId.slice(separator + 1);
      return [{
        id: record.placementId,
        slug: record.slug,
        source,
        path,
        status: 'missing',
        diagnostics: [{
          path,
          message: 'Managed Skill directory is missing',
          severity: 'error',
          suggestion: 'Reinstall from the recorded source or stop managing this record',
        }],
        effective: false,
        shadowed: false,
        conflict: false,
        ownership: 'managed',
        recordId: record.id,
        record,
      }];
    });
    const annotatedPlacements: SkillPlacement[] = inventory.placements.map(placement => {
      const record = recordsByPlacement.get(placement.id);
      return {
        ...placement,
        ownership: record ? 'managed' : 'external',
        recordId: record?.id,
        record,
        modified: record
          ? placement.contentHash !== record.baselineHash
          : undefined,
      };
    });
    return {
      ...inventory,
      placements: [...annotatedPlacements, ...missingPlacements],
    };
  }
}
