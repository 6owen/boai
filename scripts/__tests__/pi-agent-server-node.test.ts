import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { buildPiAgentServer } from '../build-pi-agent-server.ts'

const tempDirs: string[] = []

function resolveSystemNode(): string {
  const command = process.platform === 'win32' ? 'where' : 'which'
  return execFileSync(command, ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Pi Agent Server Node runtime', () => {
  test('a fresh Node bundle completes the JSONL lifecycle', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'boai-pi-node-'))
    tempDirs.push(tempDir)
    const outfile = join(tempDir, 'pi-agent-server.mjs')
    await buildPiAgentServer({
      rootDir: join(import.meta.dir, '..', '..'),
      outfile,
    })

    const child = spawn(resolveSystemNode(), [outfile], {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stderr: string[] = []
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => stderr.push(chunk))

    const ready = new Promise<{ type: string; callbackPort: number }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Timed out waiting for PI ready event: ${stderr.join('')}`))
      }, 15_000)
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        const message = JSON.parse(line)
        if (message.type === 'ready') {
          clearTimeout(timeout)
          lines.close()
          resolve(message)
        }
      })
    })

    child.stdin.write(`${JSON.stringify({
      type: 'init',
      apiKey: '',
      model: 'anthropic/claude-sonnet-4-5',
      cwd: tempDir,
      thinkingLevel: 'off',
      workspaceRootPath: tempDir,
      sessionId: 'node-runtime-smoke',
      sessionPath: join(tempDir, 'session.jsonl'),
      workingDirectory: tempDir,
      plansFolderPath: join(tempDir, 'plans'),
    })}\n`)

    const message = await ready
    expect(message.type).toBe('ready')
    expect(message.callbackPort).toBeGreaterThan(0)

    child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
    const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve))
    expect(exitCode).toBe(0)
  }, 30_000)
})
