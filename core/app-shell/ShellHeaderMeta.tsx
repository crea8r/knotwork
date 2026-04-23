import { Bot, BookOpen, FileText, FolderKanban, FolderOpen, GitBranch, Hash, MessageSquare, PlayCircle } from 'lucide-react'

export type ShellHeaderIconKind =
  | 'project'
  | 'channel'
  | 'objective'
  | 'workflow'
  | 'run'
  | 'knowledge'
  | 'asset-file'
  | 'asset-folder'
  | 'agent'

export function renderShellHeaderIcon(kind?: ShellHeaderIconKind | null) {
  switch (kind) {
    case 'project':
      return <FolderKanban size={15} />
    case 'objective':
      return <Hash size={15} />
    case 'workflow':
      return <GitBranch size={15} />
    case 'run':
      return <PlayCircle size={15} />
    case 'knowledge':
      return <BookOpen size={15} />
    case 'asset-file':
      return <FileText size={15} />
    case 'asset-folder':
      return <FolderOpen size={15} />
    case 'agent':
      return <Bot size={15} />
    case 'channel':
    default:
      return <MessageSquare size={15} />
  }
}
