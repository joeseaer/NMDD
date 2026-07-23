import { createMindMapSheet } from '../domain/defaults';
import { createEntityId } from '../domain/ids';
import type {
  CommandId,
  AdvancedLayoutSpec,
  MindMapDocumentV1,
  OrderKey,
  ResolvedBranchLayoutSpec,
  SheetId,
  TopicId,
} from '../domain/types';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateSheetCommand,
  type DeleteSheetCommand,
  type RenameSheetCommand,
  type ReorderSheetCommand,
  type UpdateSheetLayoutCommand,
} from '../commands/types';
import { createAvailableOrderKey } from './commandPlanning';

interface SheetPlannerMetadata {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly timestamp?: string;
}

const metadata = (input: SheetPlannerMetadata) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: 'mindmap-v2-sheet-bar',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

export interface PlanCreateSheetInput extends SheetPlannerMetadata {
  readonly title?: string;
  readonly rootTitle?: string;
  readonly newSheetId?: SheetId;
  readonly rootTopicId?: TopicId;
  readonly orderKey?: OrderKey;
}

export const planCreateSheetCommand = (
  input: PlanCreateSheetInput,
): CreateSheetCommand => {
  const sourceSheet = input.document.sheets[input.sheetId];
  if (!sourceSheet) throw new Error(`Source sheet ${input.sheetId} does not exist.`);
  const sheetId = input.newSheetId ?? createEntityId<'Sheet'>();
  const rootTopicId = input.rootTopicId ?? createEntityId<'Topic'>();
  const orderKey = input.orderKey ?? createAvailableOrderKey(
    Object.values(input.document.sheets).map((sheet) => sheet.orderKey),
  );
  return {
    ...metadata(input),
    type: MIND_MAP_COMMAND_TYPES.createSheet,
    payload: {
      sheet: createMindMapSheet({
        id: sheetId,
        rootTopicId,
        themeId: sourceSheet.themeId,
        orderKey,
        title: input.title ?? '新画布',
        rootTitle: input.rootTitle ?? '中心主题',
      }),
    },
  };
};

export const planRenameSheetCommand = (
  input: SheetPlannerMetadata & { readonly title: string },
): RenameSheetCommand => ({
  ...metadata(input),
  type: MIND_MAP_COMMAND_TYPES.renameSheet,
  payload: { title: input.title },
});

export const planReorderSheetCommand = (
  input: SheetPlannerMetadata & { readonly orderKey: OrderKey },
): ReorderSheetCommand => ({
  ...metadata(input),
  type: MIND_MAP_COMMAND_TYPES.reorderSheet,
  payload: { orderKey: input.orderKey },
});

export interface PlanUpdateSheetLayoutInput extends SheetPlannerMetadata {
  readonly defaultBranchLayout: ResolvedBranchLayoutSpec;
  readonly advancedLayout?: AdvancedLayoutSpec;
}

export const planUpdateSheetLayoutCommand = (
  input: PlanUpdateSheetLayoutInput,
): UpdateSheetLayoutCommand => ({
  ...metadata(input),
  type: MIND_MAP_COMMAND_TYPES.updateSheetLayout,
  payload: {
    defaultBranchLayout: {
      ...input.defaultBranchLayout,
      ...(input.defaultBranchLayout.spacing
        ? { spacing: { ...input.defaultBranchLayout.spacing } }
        : {}),
      ...(input.defaultBranchLayout.options
        ? { options: { ...input.defaultBranchLayout.options } }
        : {}),
    },
    ...(input.advancedLayout
      ? { advancedLayout: { ...input.advancedLayout } }
      : {}),
  },
});

export const planDeleteSheetCommand = (
  input: SheetPlannerMetadata,
): DeleteSheetCommand => ({
  ...metadata(input),
  type: MIND_MAP_COMMAND_TYPES.deleteSheet,
  payload: {},
});
