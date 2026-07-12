# Document editor clipboard core

This directory is deliberately independent of React and editor instances. It
classifies and normalizes clipboard content; the Tiptap extension owns the final
conversion to/from ProseMirror `Slice` objects.

## Public entry points

- `captureClipboardPayload(dataTransfer)` captures MIME types, exact plain text,
  URI lists, ordered files, and a conservative source classification.
- `parseClipboardPayload(payload, { plain, codeContext })` is the main paste
  decision. It returns exact `text`, normalized `html`, source evidence, and
  diagnostics. `plain` is the `Ctrl/Cmd+Shift+V` contract.
- `normalizeClipboardHtml(html, options)` normalizes Office, Google Docs/Sheets,
  Notion, ChatGPT/Codex, VS Code/terminal, and generic HTML before a DOMPurify
  allowlist is applied.
- `parsePlainText(text, options)` detects Markdown/GFM, TSV, a single URL, source
  code, and conservative math. External Markdown always uses `html: false`.
- `createClipboardCopyPayload(fragment)` cleans runtime attributes, regenerates
  sync/database entity IDs coherently, and returns Markdown/plain fallbacks.
- `cloneFragmentForPaste(fragment)` is available when an already-parsed internal
  fragment needs a second collision-safe ID refresh.

## ProseMirror integration contract

1. In a raw `paste` DOM handler, call `captureClipboardPayload` and retain it as
   a one-shot token. Do not insert content there.
2. In `clipboardTextParser(text, $context, plain, view)`, call
   `parseClipboardPayload`. Pass `plain` unchanged and set `codeContext` when
   `$context.parent.type.spec.code` is true.
3. For `plain` or `codeContext`, construct the `Slice` from `result.text`, not
   from `result.html`. This is what preserves literal tabs and guarantees that
   Markdown/math-looking text stays text. Inside a code node, insert a text
   fragment directly. Outside code, split newlines into schema paragraphs and
   retain the active marks if desired.
4. For rich results, parse `result.html` with
   `DOMParser.fromSchema(view.state.schema).parseSlice(..., { context: $context })`.
   If parsing throws or yields no usable content, fall back to `result.text`.
5. `handlePaste` should only coordinate ordered file placeholders/uploads and
   mixed file+text insertion. A plain-paste token must never insert files.
6. Add `application/x-nmdd-document-fragment` to internal copy events. Without
   that explicit marker, foreign `data-*` attributes are intentionally treated
   as untrusted and stripped.
7. In `transformCopied`, serialize `slice.content.toJSON()`, call
   `prepareFragmentForClipboard`, and rebuild the fragment with the current
   schema. In `clipboardTextSerializer`, pass `slice.content.toJSON()` to
   `serializeClipboardText` so plain clipboard output is stable Markdown.

One paste should result in one `replaceSelection` transaction. Async upload
completion should update placeholder nodes by their own generated upload IDs,
never by the user's later cursor position.
