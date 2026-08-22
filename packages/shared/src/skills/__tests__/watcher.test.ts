import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillInventoryWatcher } from '../watcher.ts'

function waitForChange(run: (resolve: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Skill filesystem event')), 3_000)
    run(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

describe('SkillInventoryWatcher', () => {
  it('observes global, workspace, and project Skill trees', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-watcher-'))
    const roots = {
      globalSkillsRoot: join(root, 'global', 'skills'),
      workspaceRoot: join(root, 'workspace'),
      projectRoot: join(root, 'project'),
    }
    mkdirSync(roots.globalSkillsRoot, { recursive: true })
    mkdirSync(join(roots.workspaceRoot, 'skills'), { recursive: true })
    mkdirSync(join(roots.projectRoot, '.agents', 'skills'), { recursive: true })

    let resolveChange: (() => void) | undefined
    const watcher = new SkillInventoryWatcher(roots, () => resolveChange?.(), 20)
    try {
      for (const directory of [
        roots.globalSkillsRoot,
        join(roots.workspaceRoot, 'skills'),
        join(roots.projectRoot, '.agents', 'skills'),
      ]) {
        await waitForChange(resolve => {
          resolveChange = resolve
          writeFileSync(join(directory, `change-${Date.now()}.txt`), 'changed')
        })
      }
    } finally {
      watcher.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rebases onto a Skill directory created after the watcher starts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-watcher-create-'))
    const roots = { globalSkillsRoot: join(root, '.agents', 'skills'), workspaceRoot: join(root, 'workspace') }
    mkdirSync(roots.workspaceRoot, { recursive: true })
    let resolveChange: (() => void) | undefined
    const watcher = new SkillInventoryWatcher(roots, () => resolveChange?.(), 20)
    try {
      await waitForChange(resolve => {
        resolveChange = resolve
        mkdirSync(roots.globalSkillsRoot, { recursive: true })
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      await waitForChange(resolve => {
        resolveChange = resolve
        writeFileSync(join(roots.globalSkillsRoot, 'created.txt'), 'changed')
      })
    } finally {
      watcher.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
