import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import { marked } from 'marked'
import TurndownService from 'turndown'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Link as LinkIcon,
  Highlighter,
  Eraser,
} from 'lucide-react'
import { useKnowledgeFiles } from '@/api/knowledge'

interface Props {
  value: string
  onChange: (nextMarkdown: string) => void
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
})

turndown.addRule('highlight', {
  filter: ['mark'],
  replacement: (content) => `<mark>${content}</mark>`,
})

turndown.addRule('coloredSpan', {
  filter: (node) => node.nodeName === 'SPAN' && !!(node as HTMLElement).style?.color,
  replacement: (content, node) => `<span style="color:${(node as HTMLElement).style.color}">${content}</span>`,
})

function mdToHtml(markdown: string): string {
  return marked.parse(markdown, { breaks: true }) as string
}

function htmlToMd(html: string): string {
  return turndown.turndown(html)
}

export default function MarkdownWysiwygEditor({ value, onChange }: Props) {
  const [textColor, setTextColor] = useState('#1f2937')
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [linkMode, setLinkMode] = useState<'file' | 'url'>('file')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkFilePath, setLinkFilePath] = useState('')
  const { data: knowledgeFiles = [] } = useKnowledgeFiles()
  const initialHtml = useMemo(() => mdToHtml(value), [value])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        orderedList: { keepMarks: true },
        bulletList: { keepMarks: true },
      }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Link.configure({ openOnClick: false }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class:
          'min-h-[20rem] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 focus:outline-none prose prose-sm max-w-none',
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(htmlToMd(current.getHTML()))
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = htmlToMd(editor.getHTML())
    if (current !== value) {
      editor.commands.setContent(mdToHtml(value), { emitUpdate: false })
    }
  }, [editor, value])

  function openLinkDialog() {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = (previousUrl || '').trim()
    const hasFile = knowledgeFiles.some((f) => f.path === url)
    if (hasFile) {
      setLinkMode('file')
      setLinkFilePath(url)
      setLinkUrl('')
    } else {
      setLinkMode('url')
      setLinkUrl(url)
      if (!linkFilePath && knowledgeFiles.length) setLinkFilePath(knowledgeFiles[0].path)
    }
    if (!url && knowledgeFiles.length && !linkFilePath) {
      setLinkFilePath(knowledgeFiles[0].path)
    }
    setShowLinkDialog(true)
  }

  function applyLink() {
    if (!editor) return
    const href = linkMode === 'file' ? linkFilePath.trim() : linkUrl.trim()
    if (!href) return
    editor.chain().focus().setLink({ href }).run()
    setShowLinkDialog(false)
  }

  if (!editor) return null

  function applyColor(color: string) {
    setTextColor(color)
    // Apply color to selected text; if cursor-only, apply to the next typed text.
    editor.chain().focus().setColor(color).run()
  }

  function ToolbarButton({
    title,
    active = false,
    onClick,
    children,
  }: {
    title: string
    active?: boolean
    onClick: () => void
    children: ReactNode
  }) {
    return (
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={onClick}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
          active
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
        }`}
      >
        {children}
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
        <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={15} />
        </ToolbarButton>
        <ToolbarButton title="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </ToolbarButton>
        <ToolbarButton title="Indent list item" onClick={() => editor.chain().focus().sinkListItem('listItem').run()}>
          <IndentIncrease size={15} />
        </ToolbarButton>
        <ToolbarButton title="Outdent list item" onClick={() => editor.chain().focus().liftListItem('listItem').run()}>
          <IndentDecrease size={15} />
        </ToolbarButton>
        <ToolbarButton title="Insert/edit link" active={editor.isActive('link')} onClick={openLinkDialog}>
          <LinkIcon size={15} />
        </ToolbarButton>
        <ToolbarButton
          title="Highlight"
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
        >
          <Highlighter size={15} />
        </ToolbarButton>
        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600">
          <span className="inline-block h-3 w-3 rounded-full border border-gray-300" style={{ backgroundColor: textColor }} />
          <input
            type="color"
            value={textColor}
            onChange={(e) => {
              applyColor(e.target.value)
            }}
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
            title="Text color"
          />
        </label>
        <ToolbarButton title="Clear text color" onClick={() => editor.chain().focus().unsetColor().run()}>
          <Eraser size={15} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      {showLinkDialog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">Insert link</h3>
            <p className="mt-1 text-xs text-gray-500">Link selected text to a handbook file or external URL.</p>

            <div className="mt-3 flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="link-mode"
                  checked={linkMode === 'file'}
                  onChange={() => setLinkMode('file')}
                />
                Handbook file
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="link-mode"
                  checked={linkMode === 'url'}
                  onChange={() => setLinkMode('url')}
                />
                URL
              </label>
            </div>

            {linkMode === 'file' ? (
              <div className="mt-3">
                <select
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={linkFilePath}
                  onChange={(e) => setLinkFilePath(e.target.value)}
                >
                  {!knowledgeFiles.length && <option value="">No handbook files</option>}
                  {knowledgeFiles.map((f) => (
                    <option key={f.path} value={f.path}>{f.title} ({f.path})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-3">
                <input
                  type="url"
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  editor.chain().focus().unsetLink().run()
                  setShowLinkDialog(false)
                }}
              >
                Remove link
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => setShowLinkDialog(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  disabled={linkMode === 'file' ? !linkFilePath : !linkUrl.trim()}
                  onClick={applyLink}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
