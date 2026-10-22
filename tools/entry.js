// Bündelt den TipTap-Editor in eine Datei (web/vendor/tiptap.js, global TT), damit die App offline ohne Build-Schritt läuft.
export { Editor, Node, mergeAttributes } from '@tiptap/core'
export { StarterKit } from '@tiptap/starter-kit'
export { Image } from '@tiptap/extension-image'
export { TableKit } from '@tiptap/extension-table'
export { TaskList, TaskItem } from '@tiptap/extension-list'
export { Placeholder, CharacterCount } from '@tiptap/extensions'
export { Mention } from '@tiptap/extension-mention'
