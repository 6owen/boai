import { parentPort } from 'node:worker_threads'
import { computeSkillUsageStats } from '@craft-agent/server-core/services/skill-usage-stats'
import type {
  SkillUsageWorkerRequest,
  SkillUsageWorkerResponse,
} from './skill-usage-worker-protocol'

const port = parentPort
if (!port) {
  throw new Error('Skill usage worker must run in a worker thread')
}

port.on('message', (request: SkillUsageWorkerRequest) => {
  let response: SkillUsageWorkerResponse
  try {
    response = {
      id: request.id,
      ok: true,
      stats: computeSkillUsageStats(request.workspaceRootPath, request.range),
    }
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  port.postMessage(response)
})
