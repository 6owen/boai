import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { InstalledSkillAgent, LoadedSkill, SkillAgentPlacement } from './types.ts'

interface AgentDefinition {
  id: string
  name: string
  globalRoot: (home: string, config: string) => string
  projectRoot: string
  detectedBy: (home: string, config: string) => string[]
  readableRoots?: (home: string, config: string) => Array<{
    path: string
    sourceAgentId: string
  }>
}

const homeRoot = (relative: string) => (home: string) => join(home, relative)
const configRoot = (relative: string) => (_home: string, config: string) => join(config, relative)
const homeDetection = (...relative: string[]) => (home: string) => relative.map(path => join(home, path))
const configDetection = (...relative: string[]) => (_home: string, config: string) => relative.map(path => join(config, path))

const sharedSkills = homeRoot('.agents/skills')
const claudeSkills = (home: string) => join(
  process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'),
  'skills',
)
const codexSkills = (home: string) => join(
  process.env.CODEX_HOME?.trim() || join(home, '.codex'),
  'skills',
)

const AGENTS: AgentDefinition[] = [
  { id: 'aider-desk', name: 'AiderDesk', globalRoot: homeRoot('.aider-desk/skills'), projectRoot: '.aider-desk/skills', detectedBy: homeDetection('.aider-desk') },
  { id: 'amp', name: 'Amp', globalRoot: configRoot('agents/skills'), projectRoot: '.agents/skills', detectedBy: configDetection('amp') },
  { id: 'antigravity', name: 'Antigravity', globalRoot: homeRoot('.gemini/antigravity/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.gemini/antigravity') },
  { id: 'antigravity-cli', name: 'Antigravity CLI', globalRoot: homeRoot('.gemini/antigravity-cli/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.gemini/antigravity-cli') },
  { id: 'astrbot', name: 'AstrBot', globalRoot: homeRoot('.astrbot/data/skills'), projectRoot: 'data/skills', detectedBy: homeDetection('.astrbot') },
  { id: 'autohand-code', name: 'Autohand Code CLI', globalRoot: homeRoot('.autohand/skills'), projectRoot: '.autohand/skills', detectedBy: homeDetection('.autohand') },
  { id: 'augment', name: 'Augment', globalRoot: homeRoot('.augment/skills'), projectRoot: '.augment/skills', detectedBy: homeDetection('.augment') },
  { id: 'bob', name: 'IBM Bob', globalRoot: homeRoot('.bob/skills'), projectRoot: '.bob/skills', detectedBy: homeDetection('.bob') },
  { id: 'claude-code', name: 'Claude Code', globalRoot: claudeSkills, projectRoot: '.claude/skills', detectedBy: homeDetection('.claude') },
  { id: 'openclaw', name: 'OpenClaw', globalRoot: (home) => join(home, existsSync(join(home, '.openclaw')) ? '.openclaw/skills' : existsSync(join(home, '.clawdbot')) ? '.clawdbot/skills' : '.moltbot/skills'), projectRoot: 'skills', detectedBy: homeDetection('.openclaw', '.clawdbot', '.moltbot') },
  { id: 'cline', name: 'Cline', globalRoot: sharedSkills, projectRoot: '.agents/skills', detectedBy: homeDetection('.cline') },
  { id: 'codearts-agent', name: 'CodeArts Agent', globalRoot: homeRoot('.codeartsdoer/skills'), projectRoot: '.codeartsdoer/skills', detectedBy: homeDetection('.codeartsdoer') },
  { id: 'codebuddy', name: 'CodeBuddy', globalRoot: homeRoot('.codebuddy/skills'), projectRoot: '.codebuddy/skills', detectedBy: homeDetection('.codebuddy') },
  { id: 'codemaker', name: 'Codemaker', globalRoot: homeRoot('.codemaker/skills'), projectRoot: '.codemaker/skills', detectedBy: homeDetection('.codemaker') },
  { id: 'codestudio', name: 'Code Studio', globalRoot: homeRoot('.codestudio/skills'), projectRoot: '.codestudio/skills', detectedBy: homeDetection('.codestudio') },
  { id: 'codex', name: 'Codex', globalRoot: codexSkills, projectRoot: '.agents/skills', detectedBy: homeDetection('.codex'), readableRoots: (home) => [{ path: sharedSkills(home), sourceAgentId: 'codex' }] },
  { id: 'command-code', name: 'Command Code', globalRoot: homeRoot('.commandcode/skills'), projectRoot: '.commandcode/skills', detectedBy: homeDetection('.commandcode') },
  { id: 'continue', name: 'Continue', globalRoot: homeRoot('.continue/skills'), projectRoot: '.continue/skills', detectedBy: homeDetection('.continue') },
  { id: 'cortex', name: 'Cortex Code', globalRoot: homeRoot('.snowflake/cortex/skills'), projectRoot: '.cortex/skills', detectedBy: homeDetection('.snowflake/cortex') },
  { id: 'crush', name: 'Crush', globalRoot: configRoot('crush/skills'), projectRoot: '.crush/skills', detectedBy: configDetection('crush') },
  { id: 'cursor', name: 'Cursor', globalRoot: homeRoot('.cursor/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.cursor'), readableRoots: (home) => [{ path: claudeSkills(home), sourceAgentId: 'claude-code' }] },
  { id: 'deepagents', name: 'Deep Agents', globalRoot: homeRoot('.deepagents/agent/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.deepagents') },
  { id: 'devin', name: 'Devin for Terminal', globalRoot: configRoot('devin/skills'), projectRoot: '.devin/skills', detectedBy: configDetection('devin') },
  { id: 'dexto', name: 'Dexto', globalRoot: sharedSkills, projectRoot: '.agents/skills', detectedBy: homeDetection('.dexto') },
  { id: 'droid', name: 'Droid', globalRoot: homeRoot('.factory/skills'), projectRoot: '.factory/skills', detectedBy: homeDetection('.factory') },
  { id: 'firebender', name: 'Firebender', globalRoot: homeRoot('.firebender/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.firebender') },
  { id: 'forgecode', name: 'ForgeCode', globalRoot: homeRoot('.forge/skills'), projectRoot: '.forge/skills', detectedBy: homeDetection('.forge') },
  { id: 'gemini-cli', name: 'Gemini CLI', globalRoot: homeRoot('.gemini/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.gemini') },
  { id: 'github-copilot', name: 'GitHub Copilot', globalRoot: homeRoot('.copilot/skills'), projectRoot: '.agents/skills', detectedBy: homeDetection('.copilot'), readableRoots: (home) => [{ path: claudeSkills(home), sourceAgentId: 'claude-code' }] },
  { id: 'goose', name: 'Goose', globalRoot: configRoot('goose/skills'), projectRoot: '.goose/skills', detectedBy: configDetection('goose') },
  { id: 'grok', name: 'Grok Build', globalRoot: homeRoot('.grok/skills'), projectRoot: '.grok/skills', detectedBy: homeDetection('.grok') },
  { id: 'hermes-agent', name: 'Hermes Agent', globalRoot: homeRoot('.hermes/skills'), projectRoot: '.hermes/skills', detectedBy: homeDetection('.hermes') },
  { id: 'inference-sh', name: 'inference.sh', globalRoot: homeRoot('.inferencesh/skills'), projectRoot: '.inferencesh/skills', detectedBy: homeDetection('.inferencesh') },
  { id: 'jazz', name: 'Jazz', globalRoot: homeRoot('.jazz/skills'), projectRoot: '.jazz/skills', detectedBy: homeDetection('.jazz') },
  { id: 'junie', name: 'Junie', globalRoot: homeRoot('.junie/skills'), projectRoot: '.junie/skills', detectedBy: homeDetection('.junie') },
  { id: 'iflow-cli', name: 'iFlow CLI', globalRoot: homeRoot('.iflow/skills'), projectRoot: '.iflow/skills', detectedBy: homeDetection('.iflow') },
  { id: 'kilo', name: 'Kilo Code', globalRoot: homeRoot('.kilocode/skills'), projectRoot: '.kilocode/skills', detectedBy: homeDetection('.kilocode') },
  { id: 'kimchi', name: 'Kimchi', globalRoot: configRoot('kimchi/harness/skills'), projectRoot: '.kimchi/skills', detectedBy: configDetection('kimchi') },
  { id: 'kimi-code-cli', name: 'Kimi Code CLI', globalRoot: sharedSkills, projectRoot: '.agents/skills', detectedBy: homeDetection('.kimi-code', '.kimi') },
  { id: 'kiro-cli', name: 'Kiro CLI', globalRoot: homeRoot('.kiro/skills'), projectRoot: '.kiro/skills', detectedBy: homeDetection('.kiro') },
  { id: 'kode', name: 'Kode', globalRoot: homeRoot('.kode/skills'), projectRoot: '.kode/skills', detectedBy: homeDetection('.kode') },
  { id: 'lingma', name: 'Lingma', globalRoot: homeRoot('.lingma/skills'), projectRoot: '.lingma/skills', detectedBy: homeDetection('.lingma') },
  { id: 'loaf', name: 'Loaf', globalRoot: sharedSkills, projectRoot: '.agents/skills', detectedBy: homeDetection('.loaf') },
  { id: 'mcpjam', name: 'MCPJam', globalRoot: homeRoot('.mcpjam/skills'), projectRoot: '.mcpjam/skills', detectedBy: homeDetection('.mcpjam') },
  { id: 'minimax-code', name: 'MiniMax Code', globalRoot: homeRoot('.minimax/skills'), projectRoot: '.minimax/skills', detectedBy: homeDetection('.minimax') },
  { id: 'mistral-vibe', name: 'Mistral Vibe', globalRoot: homeRoot('.vibe/skills'), projectRoot: '.vibe/skills', detectedBy: homeDetection('.vibe') },
  { id: 'moxby', name: 'Moxby', globalRoot: homeRoot('.moxby/skills'), projectRoot: '.moxby/skills', detectedBy: homeDetection('.moxby') },
  { id: 'mux', name: 'Mux', globalRoot: homeRoot('.mux/skills'), projectRoot: '.mux/skills', detectedBy: homeDetection('.mux') },
  { id: 'opencode', name: 'OpenCode', globalRoot: configRoot('opencode/skills'), projectRoot: '.agents/skills', detectedBy: configDetection('opencode'), readableRoots: (home) => [{ path: claudeSkills(home), sourceAgentId: 'claude-code' }, { path: sharedSkills(home), sourceAgentId: 'codex' }] },
  { id: 'openhands', name: 'OpenHands', globalRoot: homeRoot('.openhands/skills'), projectRoot: '.openhands/skills', detectedBy: homeDetection('.openhands') },
  { id: 'ona', name: 'Ona', globalRoot: homeRoot('.ona/skills'), projectRoot: '.ona/skills', detectedBy: homeDetection('.ona') },
  { id: 'pi', name: 'Pi', globalRoot: homeRoot('.pi/agent/skills'), projectRoot: '.pi/skills', detectedBy: homeDetection('.pi/agent') },
  { id: 'qoder', name: 'Qoder', globalRoot: homeRoot('.qoder/skills'), projectRoot: '.qoder/skills', detectedBy: homeDetection('.qoder') },
  { id: 'qoder-cn', name: 'Qoder CN', globalRoot: homeRoot('.qoder-cn/skills'), projectRoot: '.qoder/skills', detectedBy: homeDetection('.qoder-cn') },
  { id: 'qwen-code', name: 'Qwen Code', globalRoot: homeRoot('.qwen/skills'), projectRoot: '.qwen/skills', detectedBy: homeDetection('.qwen') },
  { id: 'reasonix', name: 'Reasonix', globalRoot: homeRoot('.reasonix/skills'), projectRoot: '.reasonix/skills', detectedBy: homeDetection('.reasonix') },
  { id: 'rovodev', name: 'Rovo Dev', globalRoot: homeRoot('.rovodev/skills'), projectRoot: '.rovodev/skills', detectedBy: homeDetection('.rovodev') },
  { id: 'roo', name: 'Roo Code', globalRoot: homeRoot('.roo/skills'), projectRoot: '.roo/skills', detectedBy: homeDetection('.roo') },
  { id: 'tabnine-cli', name: 'Tabnine CLI', globalRoot: homeRoot('.tabnine/agent/skills'), projectRoot: '.tabnine/agent/skills', detectedBy: homeDetection('.tabnine') },
  { id: 'terramind', name: 'Terramind', globalRoot: homeRoot('.terramind/skills'), projectRoot: '.terramind/skills', detectedBy: homeDetection('.terramind') },
  { id: 'tinycloud', name: 'Tinycloud', globalRoot: homeRoot('.tinycloud/skills'), projectRoot: '.tinycloud/skills', detectedBy: homeDetection('.tinycloud') },
  { id: 'trae', name: 'Trae', globalRoot: homeRoot('.trae/skills'), projectRoot: '.trae/skills', detectedBy: homeDetection('.trae') },
  { id: 'trae-cn', name: 'Trae CN', globalRoot: homeRoot('.trae-cn/skills'), projectRoot: '.trae/skills', detectedBy: homeDetection('.trae-cn') },
  { id: 'warp', name: 'Warp', globalRoot: sharedSkills, projectRoot: '.agents/skills', detectedBy: homeDetection('.warp') },
  { id: 'windsurf', name: 'Windsurf', globalRoot: homeRoot('.codeium/windsurf/skills'), projectRoot: '.windsurf/skills', detectedBy: homeDetection('.codeium/windsurf') },
  { id: 'zed', name: 'Zed', globalRoot: sharedSkills, projectRoot: '.agents/skills', detectedBy: configDetection('zed') },
  { id: 'zcode', name: 'ZCode', globalRoot: homeRoot('.zcode/skills'), projectRoot: '.zcode/skills', detectedBy: homeDetection('.zcode') },
  { id: 'zencoder', name: 'Zencoder', globalRoot: homeRoot('.zencoder/skills'), projectRoot: '.zencoder/skills', detectedBy: homeDetection('.zencoder') },
  { id: 'zenflow', name: 'Zenflow', globalRoot: homeRoot('.zencoder/skills'), projectRoot: '.zencoder/skills', detectedBy: homeDetection('.zencoder') },
  { id: 'neovate', name: 'Neovate', globalRoot: homeRoot('.neovate/skills'), projectRoot: '.neovate/skills', detectedBy: homeDetection('.neovate') },
  { id: 'pochi', name: 'Pochi', globalRoot: homeRoot('.pochi/skills'), projectRoot: '.pochi/skills', detectedBy: homeDetection('.pochi') },
  { id: 'adal', name: 'AdaL', globalRoot: homeRoot('.adal/skills'), projectRoot: '.adal/skills', detectedBy: homeDetection('.adal') },
]

function normalizedSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
}

function isSameSkillAt(root: string, skill: LoadedSkill): boolean {
  const candidates = new Set([
    skill.slug,
    normalizedSkillName(skill.metadata.name),
  ])
  const sourceFile = join(skill.path, 'SKILL.md')
  let sourceContent: string | undefined

  return [...candidates].some(name => {
    if (!name) return false
    const candidateFile = join(root, name, 'SKILL.md')
    if (!existsSync(candidateFile)) return false
    try {
      if (realpathSync(candidateFile) === realpathSync(sourceFile)) return true
      sourceContent ??= readFileSync(sourceFile, 'utf8')
      return readFileSync(candidateFile, 'utf8') === sourceContent
    } catch {
      return false
    }
  })
}

function isInstalled(agent: AgentDefinition, home: string, config: string): boolean {
  return agent.detectedBy(home, config).some(existsSync)
}

export interface SkillAgentPlacementOptions {
  homeDir?: string
  configDir?: string
}

/** Detect Agent applications from their standard local configuration roots. */
export function detectInstalledSkillAgents(
  options: SkillAgentPlacementOptions = {},
): InstalledSkillAgent[] {
  const home = options.homeDir ?? homedir()
  const config = options.configDir ?? process.env.XDG_CONFIG_HOME?.trim() ?? join(home, '.config')

  const hasRuntimeFootprint = (path: string): boolean => {
    if (!existsSync(path)) return false
    try {
      if (!statSync(path).isDirectory()) return true
      return readdirSync(path).some(name => name !== 'skills' && name !== '.DS_Store')
    } catch {
      return false
    }
  }

  return AGENTS
    .filter(agent => agent.detectedBy(home, config).some(hasRuntimeFootprint))
    .map(agent => ({ agentId: agent.id, agentName: agent.name }))
}

/** Annotate skills with the installed Agents that can actually read each skill. */
export function annotateSkillAgentPlacements(
  skills: LoadedSkill[],
  projectRoot?: string,
  options: SkillAgentPlacementOptions = {},
): LoadedSkill[] {
  const home = options.homeDir ?? homedir()
  const config = options.configDir ?? process.env.XDG_CONFIG_HOME?.trim() ?? join(home, '.config')

  return skills.map(skill => {
    // Workspace skills are private to Craft and are not installed into an
    // external Agent's global or project skills directory.
    if (skill.source === 'workspace' || skill.source === 'plugin') return { ...skill, agentPlacements: [] }

    const placements: SkillAgentPlacement[] = []
    for (const agent of AGENTS) {
      if (!isInstalled(agent, home, config)) continue
      const directRoot = skill.source === 'project' && projectRoot
        ? join(projectRoot, agent.projectRoot)
        : agent.globalRoot(home, config)
      if (isSameSkillAt(directRoot, skill)) {
        placements.push({ agentId: agent.id, agentName: agent.name })
        continue
      }
      if (skill.source !== 'global') continue
      const inherited = agent.readableRoots?.(home, config)
        .find(readable => isSameSkillAt(readable.path, skill))
      if (inherited) {
        placements.push({
          agentId: agent.id,
          agentName: agent.name,
          isInherited: true,
          inheritedFromAgentId: inherited.sourceAgentId,
        })
      }
    }
    return { ...skill, agentPlacements: placements }
  })
}
