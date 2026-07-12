import type { DocumentFragmentJson } from '../schema/documentSchema';
import {
  cloneFragmentForPaste,
  stripFragmentRuntimeAttributes,
  type CloneFragmentOptions,
  type FragmentIdMaps,
} from '../schema/cloneFragment';
import { serializeToMarkdown } from '../serialization/toMarkdown';
import { serializeToPlainText } from '../serialization/toPlainText';

export interface ClipboardCopyPayload<T extends DocumentFragmentJson> {
  fragment: T;
  markdown: string;
  plainText: string;
  idMaps: FragmentIdMaps;
}

export const prepareFragmentForClipboard = <T extends DocumentFragmentJson>(
  fragment: T,
  options: CloneFragmentOptions = {},
) => {
  const cloned = cloneFragmentForPaste(fragment, options);
  return {
    fragment: stripFragmentRuntimeAttributes(cloned.fragment, { preserveSyncIds: true }),
    idMaps: cloned.idMaps,
  };
};

/** Produces the fragment used for HTML clipboard serialization plus stable
 * Markdown/plain fallbacks. ProseMirror's DOMSerializer remains the integration
 * layer responsible for turning `fragment` into text/html. */
export const createClipboardCopyPayload = <T extends DocumentFragmentJson>(
  fragment: T,
  options: CloneFragmentOptions = {},
): ClipboardCopyPayload<T> => {
  const prepared = prepareFragmentForClipboard(fragment, options);
  return {
    fragment: prepared.fragment,
    markdown: serializeToMarkdown(prepared.fragment),
    plainText: serializeToPlainText(prepared.fragment),
    idMaps: prepared.idMaps,
  };
};

export const serializeClipboardText = (fragment: DocumentFragmentJson): string => (
  serializeToMarkdown(stripFragmentRuntimeAttributes(fragment))
);
