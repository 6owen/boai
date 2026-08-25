import { Worker } from 'node:worker_threads'
import type { SkillUsageRange, SkillUsageStats } from '@craft-agent/shared/skills'
import type {
  SkillUsageWorkerRequest,
  SkillUsageWorkerResponse,
} from './skill-usage-worker-protocol'

interface PendingRequest {
  resolve: (stats: SkillUsageStats) => void
  reject: (error: Error) => void
}

/** Long-lived worker client so repeated range changes reuse caches and startup work. */
export class SkillUsageWorkerClient {
  private worker: Worker | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private nextRequestId = 1

  constructor(private readonly workerPath: string | URL) {
    this.startWorker()
  }

  getStats(workspaceRootPath: string, range: SkillUsageRange): Promise<SkillUsageStats> {
    const worker = this.worker ?? this.startWorker()
    const id = this.nextRequestId++
    const request: SkillUsageWorkerRequest = { id, workspaceRootPath, range }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(request)
    })
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.rejectPending(new Error('Skill usage worker stopped'))
    if (worker) await worker.terminate()
  }

  private startWorker(): Worker {
    const worker = new Worker(this.workerPath)
    worker.unref()
    worker.on('message', (response: SkillUsageWorkerResponse) => {
      const request = this.pending.get(response.id)
      if (!request) return
      this.pending.delete(response.id)
      if (response.ok) request.resolve(response.stats)
      else request.reject(new Error(response.error))
    })
    worker.on('error', (error) => {
      if (this.worker === worker) this.worker = null
      this.rejectPending(error instanceof Error ? error : new Error(String(error)))
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = null
      this.rejectPending(new Error(`Skill usage worker exited with code ${code}`))
    })
    this.worker = worker
    return worker
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}
