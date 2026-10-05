"use client"

import { useEffect } from "react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  maxLength,
  compact,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  maxLength?: number
  compact?: boolean
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: placeholder || "Write something...",
      }),
    ],
    content: value || "<p></p>",
    immediatelyRender: false,
    filterTransaction: (transaction) => {
      if (maxLength == null || !transaction.docChanged) return true
      return transaction.doc.textContent.length <= maxLength
    },
    onUpdate: ({ editor: instance }) => {
      // Inject <br> into empty paragraphs so hitting "Enter" preserves the gap on the frontend
      let html = instance.getHTML();
      html = html.replace(/<p([^>]*)><\/p>/g, '<p$1><br></p>');
      onChange(html);
    },
    parseOptions: {
      preserveWhitespace: "full",
    },
    editorProps: {
      attributes: {
        class: `tiptap prose max-w-none rounded-b-lg border border-[#D9D9D1] px-3 py-2 text-sm outline-none focus:border-[#7B3010] whitespace-pre-wrap ${
          compact ? "min-h-[3.25rem] max-h-[4.5rem] overflow-y-auto" : "min-h-[120px]"
        }`,
      },
      handlePaste: (view, event) => {
        if (maxLength == null) return false
        const pasted = event.clipboardData?.getData("text/plain") ?? ""
        if (!pasted) return false
        const { from, to } = view.state.selection
        const current = view.state.doc.textContent.length
        const selected = Math.max(0, to - from)
        if (current - selected + pasted.length <= maxLength) return false
        event.preventDefault()
        const allowed = Math.max(0, maxLength - (current - selected))
        if (allowed > 0) {
          const truncated = pasted.slice(0, allowed)
          view.dispatch(view.state.tr.insertText(truncated))
        }
        return true
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    
    const currentHtml = editor.getHTML();
    const currentHtmlWithBr = currentHtml.replace(/<p([^>]*)><\/p>/g, '<p$1><br></p>');
    
    if (currentHtml !== value && currentHtmlWithBr !== value) {
      editor.commands.setContent(value || "<p></p>", { emitUpdate: false })
    }
  }, [editor, value])

  if (!editor) return null

  const charCount = editor.state.doc.textContent.length

  return (
    <div>
      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          color: #9ca3af;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .tiptap p {
          min-height: 1.25rem;
        }
      `}</style>
      <div className="flex flex-wrap gap-2 rounded-t-lg border border-b-0 border-[#D9D9D1] bg-[#FFFBF3] p-2 text-xs">
        <button type="button" onClick={() => editor.chain().focus().setParagraph().run()} className={`rounded px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors ${editor.isActive("paragraph") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          P
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`rounded cursor-pointer px-2 py-1 hover:bg-gray-50 transition-colors ${editor.isActive("heading", { level: 2 }) ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          H2
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={`rounded cursor-pointer px-2 py-1 hover:bg-gray-50 transition-colors ${editor.isActive("heading", { level: 3 }) ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          H3
        </button>
        <div className="w-px bg-[#D9D9D1] mx-1 my-1"></div>
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={`rounded px-2 py-1 cursor-pointer  hover:bg-gray-50 transition-colors ${editor.isActive("bold") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          Bold
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={`rounded px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors ${editor.isActive("italic") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          Italic
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={`rounded px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors ${editor.isActive("strike") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          Strike
        </button>
        <div className="w-px bg-[#D9D9D1] mx-1 my-1"></div>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={`rounded px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors ${editor.isActive("bulletList") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          Bullets
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`rounded px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors ${editor.isActive("orderedList") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          Numbered
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={`rounded px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors ${editor.isActive("blockquote") ? "bg-[#7B3010] text-white hover:bg-[#7B3010]" : "bg-white"}`}>
          Quote
        </button>
        <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()} className="rounded px-2 py-1 cursor-pointer bg-white hover:bg-gray-50 transition-colors">
          Divider
        </button>
        <div className="w-px bg-[#D9D9D1] cursor-pointer mx-1 my-1"></div>
        <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className="rounded px-2 py-1 bg-white hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          Undo
        </button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className="rounded px-2 py-1 bg-white hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          Redo
        </button>
      </div>
      <EditorContent editor={editor} />
      {maxLength != null ? (
        <p className={`mt-1 text-right text-[11px] ${charCount >= maxLength ? "text-red-600" : "text-[#646464]"}`}>
          {charCount} / {maxLength} characters
        </p>
      ) : null}
    </div>
  )
}
