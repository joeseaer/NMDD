import { createNewMindMapDocument } from './defaults';
import { createUuidV7 } from './ids';
import { createOrderKeyBetween } from './orderKey';
import type {
  DocumentId,
  MindMapDocumentV1,
  SheetId,
  ThemeId,
  TopicId,
} from './types';

export type NewMindMapEntityKind = 'document' | 'sheet' | 'root-topic' | 'theme';

export interface CreateMindMapBlockDocumentOptions {
  readonly title?: string;
  readonly sheetTitle?: string;
  readonly rootTitle?: string;
  readonly locale?: string;
  readonly idFactory?: (kind: NewMindMapEntityKind) => string;
}

export const createMindMapBlockDocument = (
  options: CreateMindMapBlockDocumentOptions = {},
): MindMapDocumentV1 => {
  const idFactory = options.idFactory ?? (() => createUuidV7());
  return createNewMindMapDocument({
    documentId: idFactory('document') as DocumentId,
    sheetId: idFactory('sheet') as SheetId,
    rootTopicId: idFactory('root-topic') as TopicId,
    themeId: idFactory('theme') as ThemeId,
    sheetOrderKey: createOrderKeyBetween(),
    title: options.title ?? '思维导图',
    sheetTitle: options.sheetTitle ?? '画布 1',
    rootTitle: options.rootTitle ?? '中心主题',
    ...(options.locale ? { locale: options.locale } : {}),
  });
};

