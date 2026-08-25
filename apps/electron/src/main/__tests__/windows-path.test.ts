import { describe, expect, it } from 'bun:test'
import {
  getCommonWindowsPathEntries,
  mergeWindowsPath,
  parseWindowsRegistryPath,
} from '../windows-path'

describe('Windows executable PATH', () => {
  it('includes Git for Windows and user-level package-manager locations', () => {
    const entries = getCommonWindowsPathEntries({
      ProgramFiles: 'D:\\Programs',
      'ProgramFiles(x86)': 'D:\\Programs x86',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\test',
      ChocolateyInstall: 'C:\\ProgramData\\chocolatey',
    }, () => true)

    expect(entries).toContain('D:\\Programs\\Git\\cmd')
    expect(entries).toContain('D:\\Programs x86\\Git\\cmd')
    expect(entries).toContain('C:\\Users\\test\\AppData\\Local\\Programs\\Git\\cmd')
    expect(entries).toContain('C:\\Users\\test\\scoop\\shims')
    expect(entries).toContain('C:\\ProgramData\\chocolatey\\bin')
  })

  it('reads and expands the Path value returned by reg.exe', () => {
    const output = [
      'HKEY_CURRENT_USER\\Environment',
      '    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;D:\\Tools\\Git\\cmd',
    ].join('\r\n')

    expect(parseWindowsRegistryPath(output, { USERPROFILE: 'C:\\Users\\test' })).toBe(
      'C:\\Users\\test\\bin;D:\\Tools\\Git\\cmd',
    )
  })

  it('merges PATH entries without case-insensitive duplicates', () => {
    expect(mergeWindowsPath(
      'C:\\Windows\\System32;D:\\Tools\\Git\\cmd',
      ['d:\\tools\\git\\cmd', 'C:\\Program Files\\Git\\cmd'],
    )).toBe(
      'C:\\Windows\\System32;D:\\Tools\\Git\\cmd;C:\\Program Files\\Git\\cmd',
    )
  })
})
