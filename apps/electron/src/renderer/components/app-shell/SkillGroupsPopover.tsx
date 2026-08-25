import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Folder, Folders, Pencil, Plus, Trash2, X } from 'lucide-react'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { normalizeSkillGroupName, type SkillGroup } from '@/hooks/useSkillCollections'

interface SkillGroupsPopoverProps {
  groups: readonly SkillGroup[]
  groupCounts: Readonly<Record<string, number>>
  onCreateGroup: (name: string) => void
  onRenameGroup: (groupId: string, name: string) => void
  onDeleteGroup: (groupId: string) => void
}

export function SkillGroupsPopover({
  groups,
  groupCounts,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: SkillGroupsPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [createName, setCreateName] = React.useState('')
  const [editingId, setEditingId] = React.useState<string>()
  const [editName, setEditName] = React.useState('')
  const createInputRef = React.useRef<HTMLInputElement>(null)
  const editInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (creating) createInputRef.current?.focus()
  }, [creating])

  React.useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  const closeCreate = () => {
    setCreating(false)
    setCreateName('')
  }

  const submitCreate = () => {
    const name = normalizeSkillGroupName(createName)
    if (!name || groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return
    onCreateGroup(name)
    closeCreate()
  }

  const submitRename = () => {
    if (!editingId) return
    const name = normalizeSkillGroupName(editName)
    if (!name || groups.some(group => (
      group.id !== editingId
      && group.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    ))) return
    onRenameGroup(editingId, name)
    setEditingId(undefined)
    setEditName('')
  }

  const startCreating = () => {
    setEditingId(undefined)
    setEditName('')
    setCreating(true)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          closeCreate()
          setEditingId(undefined)
          setEditName('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <HeaderIconButton
          icon={<Folders className="h-4 w-4" />}
          tooltip={t('skillsGroups.manage')}
          aria-label={t('skillsGroups.manage')}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[280px] overflow-hidden rounded-[8px] bg-background p-0 text-foreground shadow-modal-small"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex h-10 items-center justify-between border-b border-border/50 px-3">
          <span className="text-xs font-medium text-muted-foreground">{t('skillsGroups.title')}</span>
          <button
            type="button"
            aria-label={t('skillsGroups.newGroup')}
            title={t('skillsGroups.newGroup')}
            onClick={startCreating}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {creating && (
            <form
              className="mb-1 flex items-center gap-1 rounded-[7px] bg-foreground/[0.025] p-1"
              onSubmit={(event) => {
                event.preventDefault()
                submitCreate()
              }}
            >
              <Input
                ref={createInputRef}
                value={createName}
                maxLength={40}
                aria-label={t('skillsGroups.newGroupPlaceholder')}
                placeholder={t('skillsGroups.newGroupPlaceholder')}
                onChange={event => setCreateName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeCreate()
                }}
                className="h-8 min-w-0 flex-1 text-sm"
              />
              <GroupEditButton
                label={t('common.save')}
                type="submit"
                disabled={!normalizeSkillGroupName(createName)}
              >
                <Check className="h-3.5 w-3.5" />
              </GroupEditButton>
              <GroupEditButton label={t('common.cancel')} onClick={closeCreate}>
                <X className="h-3.5 w-3.5" />
              </GroupEditButton>
            </form>
          )}

          {groups.length === 0 && !creating ? (
            <button
              type="button"
              onClick={startCreating}
              className="flex w-full flex-col items-center gap-2 rounded-[7px] px-4 py-7 text-center text-muted-foreground transition-colors hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Folders className="h-5 w-5" />
              <span className="text-xs">{t('skillsGroups.empty')}</span>
            </button>
          ) : groups.map(group => (
            <div
              key={group.id}
              className="group flex min-h-9 items-center gap-2 rounded-[6px] px-2 transition-colors hover:bg-foreground/[0.04] focus-within:bg-foreground/[0.04]"
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {editingId === group.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1 py-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submitRename()
                  }}
                >
                  <Input
                    ref={editInputRef}
                    value={editName}
                    maxLength={40}
                    aria-label={t('skillsGroups.rename')}
                    onChange={event => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditingId(undefined)
                        setEditName('')
                      }
                    }}
                    className="h-7 min-w-0 flex-1 text-sm"
                  />
                  <GroupEditButton
                    label={t('common.save')}
                    type="submit"
                    disabled={!normalizeSkillGroupName(editName)}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </GroupEditButton>
                  <GroupEditButton
                    label={t('common.cancel')}
                    onClick={() => {
                      setEditingId(undefined)
                      setEditName('')
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </GroupEditButton>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{group.name}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground/70">
                    {groupCounts[group.id] ?? 0}
                  </span>
                  <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <GroupEditButton
                      label={t('skillsGroups.rename')}
                      onClick={() => {
                        setCreating(false)
                        setEditingId(group.id)
                        setEditName(group.name)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </GroupEditButton>
                    <GroupEditButton
                      label={t('skillsGroups.delete')}
                      destructive
                      onClick={() => onDeleteGroup(group.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </GroupEditButton>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GroupEditButton({
  label,
  destructive = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
        destructive
          ? 'hover:bg-destructive/10 hover:text-destructive'
          : 'hover:bg-foreground/[0.06] hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}
