import {
  MIND_MAP_COMMAND_TYPES,
  type CreateImageCommand,
  type DeleteImageCommand,
  type UpdateImageCommand,
} from '../commands/types';
import {
  CORE_MIND_MAP_COMMAND_REGISTRY,
  documentReferencesAsset,
} from '../commands/registry';
import { createEntityId } from '../domain/ids';
import type {
  Asset,
  CommandId,
  ImageId,
  MindMapDocumentV1,
  SheetId,
  TopicImage,
} from '../domain/types';

interface ImagePlanningInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

const commandMetadata = (input: ImagePlanningInput) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-local-image',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

const getSheet = (input: ImagePlanningInput) => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  return sheet;
};

const cloneAsset = (asset: Asset): Asset => structuredClone(asset);
const cloneImage = (image: TopicImage): TopicImage => structuredClone(image);

export interface PlanCreateImageInput extends ImagePlanningInput {
  /** Upload/import boundary owns and injects this complete, preallocated entity. */
  readonly asset: Asset;
  /** UI owns and injects this complete, preallocated sheet-local entity. */
  readonly image: TopicImage;
}

/** Plans one atomic Asset + TopicImage insertion without mutating its inputs. */
export const planCreateImageCommand = (
  input: PlanCreateImageInput,
): CreateImageCommand => {
  const command: CreateImageCommand = {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.createImage,
    payload: {
      asset: cloneAsset(input.asset),
      image: cloneImage(input.image),
    },
  };
  CORE_MIND_MAP_COMMAND_REGISTRY.get(MIND_MAP_COMMAND_TYPES.createImage).validate(
    { document: input.document, sheetId: input.sheetId },
    command,
  );
  return command;
};

export interface PlanUpdateImageInput extends ImagePlanningInput {
  /** A deliberate full replacement; ID, Topic, and Asset ownership remain immutable. */
  readonly image: TopicImage;
}

export const planUpdateImageCommand = (
  input: PlanUpdateImageInput,
): UpdateImageCommand => {
  const command: UpdateImageCommand = {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.updateImage,
    payload: { image: cloneImage(input.image) },
  };
  CORE_MIND_MAP_COMMAND_REGISTRY.get(MIND_MAP_COMMAND_TYPES.updateImage).validate(
    { document: input.document, sheetId: input.sheetId },
    command,
  );
  return command;
};

export interface PlanResetImageSizeInput extends ImagePlanningInput {
  readonly imageId: ImageId;
}

/** XMind Reset Size: restore intrinsic dimensions and remove any crop. */
export const planResetImageSizeCommand = (
  input: PlanResetImageSizeInput,
): UpdateImageCommand => {
  const sheet = getSheet(input);
  const current = sheet.images[input.imageId];
  if (!current) throw new Error(`Topic image ${input.imageId} does not exist.`);
  const asset = input.document.assets[current.assetId];
  if (!asset) throw new Error(`Image Asset ${current.assetId} does not exist.`);
  if (!asset.intrinsicSize) {
    throw new Error(`Image Asset ${asset.id} has no intrinsicSize to restore.`);
  }
  const replacement = cloneImage(current);
  replacement.size = { ...asset.intrinsicSize };
  delete replacement.crop;
  return planUpdateImageCommand({ ...input, image: replacement });
};

export interface PlanDeleteImageInput extends ImagePlanningInput {
  readonly imageId: ImageId;
}

/**
 * Removes one TopicImage. The planner requests Asset pruning only after
 * proving no other canonical reference (including canvas background) exists.
 */
export const planDeleteImageCommand = (
  input: PlanDeleteImageInput,
): DeleteImageCommand => {
  const sheet = getSheet(input);
  const image = sheet.images[input.imageId];
  if (!image) throw new Error(`Topic image ${input.imageId} does not exist.`);
  if (!input.document.assets[image.assetId]) {
    throw new Error(`Image Asset ${image.assetId} does not exist.`);
  }
  const pruneAsset = !documentReferencesAsset(input.document, image.assetId, {
    ignoreImageId: image.id,
  });
  const command: DeleteImageCommand = {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteImage,
    payload: {
      imageId: image.id,
      ...(pruneAsset ? { pruneAssetId: image.assetId } : {}),
    },
  };
  CORE_MIND_MAP_COMMAND_REGISTRY.get(MIND_MAP_COMMAND_TYPES.deleteImage).validate(
    { document: input.document, sheetId: input.sheetId },
    command,
  );
  return command;
};
