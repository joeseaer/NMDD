import { describe, expect, it } from 'vitest';

import { validateMindMapDocument } from '../domain/validation';
import type {
  Asset,
  AssetId,
  CommandId,
  ImageId,
  SheetId,
  TopicId,
  TopicImage,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import {
  planCreateImageCommand,
  planDeleteImageCommand,
  planResetImageSizeCommand,
  planUpdateImageCommand,
} from '../ui/imagePlanning';
import { CommandValidationError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateImageCommand,
  type UpdateImageCommand,
} from './types';

const IDS = {
  asset: '018f0000-0000-7000-8000-00000000d101' as AssetId,
  image: '018f0000-0000-7000-8000-00000000d102' as ImageId,
  sharedImage: '018f0000-0000-7000-8000-00000000d103' as ImageId,
  createCommand: '018f0000-0000-7000-8000-00000000d104' as CommandId,
  updateCommand: '018f0000-0000-7000-8000-00000000d105' as CommandId,
  resetCommand: '018f0000-0000-7000-8000-00000000d106' as CommandId,
  deleteCommand: '018f0000-0000-7000-8000-00000000d107' as CommandId,
};

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const existingImage = Object.values(sheet.images)[0];
  return { document, existingImage, sheet, sheetId };
};

const asset = (): Asset => ({
  id: IDS.asset,
  fileName: 'command-image.webp',
  mimeType: 'image/webp',
  byteSize: 12_345,
  sha256: 'b'.repeat(64),
  source: { kind: 'managed', objectKey: 'mindmaps/command-image.webp' },
  intrinsicSize: { width: 1_024, height: 768 },
});

const image = (topicId: TopicId): TopicImage => ({
  id: IDS.image,
  topicId,
  assetId: IDS.asset,
  orderKey: 'z',
  role: 'inline',
  placement: { side: 'top', align: 'center', offset: { x: 0, y: 4 } },
  size: { width: 512, height: 384 },
});

describe('local image commands', () => {
  it('creates, fully updates, resets, and replays one atomic image history without invalid states', () => {
    const { document, existingImage, sheetId } = setup();
    const original = structuredClone(document);
    const create = planCreateImageCommand({
      document,
      sheetId,
      asset: asset(),
      image: image(existingImage.topicId),
      commandId: IDS.createCommand,
    });
    const created = executeMindMapCommand(document, create);
    expect(created.document.assets[IDS.asset]).toEqual(asset());
    expect(created.document.sheets[sheetId].images[IDS.image]).toEqual(image(existingImage.topicId));

    const current = created.document.sheets[sheetId].images[IDS.image];
    const update = planUpdateImageCommand({
      document: created.document,
      sheetId,
      commandId: IDS.updateCommand,
      image: {
        ...current,
        placement: { ...current.placement, side: 'bottom', offset: { x: 0, y: 12 } },
        size: { width: 360, height: 240 },
        crop: { x: 24, y: 16, width: 900, height: 700 },
      },
    });
    const updated = executeMindMapCommand(created.document, update);
    expect(updated.document.sheets[sheetId].images[IDS.image]).toMatchObject({
      id: IDS.image,
      topicId: existingImage.topicId,
      placement: { side: 'bottom' },
      size: { width: 360, height: 240 },
    });

    const reset = planResetImageSizeCommand({
      document: updated.document,
      sheetId,
      imageId: IDS.image,
      commandId: IDS.resetCommand,
    });
    const resetExecution = executeMindMapCommand(updated.document, reset);
    expect(resetExecution.document.sheets[sheetId].images[IDS.image]).toMatchObject({
      size: { width: 1_024, height: 768 },
    });
    expect(resetExecution.document.sheets[sheetId].images[IDS.image].crop).toBeUndefined();
    expect(validateMindMapDocument(resetExecution.document).valid).toBe(true);

    const history = new PatchCommandHistory();
    history.record(created.applied);
    history.record(updated.applied);
    history.record(resetExecution.applied);
    let cursor = resetExecution.document;
    for (let index = 0; index < 3; index += 1) cursor = history.undo(cursor)!.document;
    expect(cursor).toEqual(original);
    for (let index = 0; index < 3; index += 1) cursor = history.redo(cursor)!.document;
    expect(cursor).toEqual(resetExecution.document);
  });

  it('deletes an image, prunes its orphan Asset, cleans slide overrides, and undoes exactly', () => {
    const { document, existingImage, sheetId } = setup();
    const deck = Object.values(document.presentations)[0];
    const slide = Object.values(deck.slides)[0];
    slide.imageOverrides = {
      [existingImage.id]: { position: { xRatio: 0.4, yRatio: 0.6 } },
    };
    const before = structuredClone(document);
    const command = planDeleteImageCommand({
      document,
      sheetId,
      imageId: existingImage.id,
      commandId: IDS.deleteCommand,
    });
    expect(command.payload.pruneAssetId).toBe(existingImage.assetId);
    expect(() => executeMindMapCommand(document, {
      ...command,
      payload: { imageId: existingImage.id },
    })).toThrow(/must prune orphan Image Asset/);

    const execution = executeMindMapCommand(document, command);
    expect(execution.document.sheets[sheetId].images[existingImage.id]).toBeUndefined();
    expect(execution.document.assets[existingImage.assetId]).toBeUndefined();
    expect(Object.values(execution.document.presentations)[0]
      .slides[slide.id].imageOverrides).toBeUndefined();
    expect(validateMindMapDocument(execution.document).valid).toBe(true);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    const undone = history.undo(execution.document)!;
    expect(undone.document).toEqual(before);
    expect(history.redo(undone.document)!.document).toEqual(execution.document);
  });

  it('retains a shared Asset and rejects a forged prune while another image references it', () => {
    const { document, existingImage, sheet, sheetId } = setup();
    const otherTopicId = Object.keys(sheet.topics)
      .find((topicId) => topicId !== existingImage.topicId)! as TopicId;
    sheet.images[IDS.sharedImage] = {
      ...existingImage,
      id: IDS.sharedImage,
      topicId: otherTopicId,
    };
    const command = planDeleteImageCommand({ document, sheetId, imageId: existingImage.id });
    expect(command.payload.pruneAssetId).toBeUndefined();
    const forged = {
      ...command,
      payload: { ...command.payload, pruneAssetId: existingImage.assetId },
    };
    expect(() => executeMindMapCommand(document, forged)).toThrow(CommandValidationError);

    const execution = executeMindMapCommand(document, command);
    expect(execution.document.assets[existingImage.assetId]).toBeDefined();
    expect(execution.document.sheets[sheetId].images[IDS.sharedImage]).toBeDefined();
    expect(validateMindMapDocument(execution.document).valid).toBe(true);
  });

  it('rejects malformed command payloads and immutable Topic ownership changes before apply', () => {
    const { document, existingImage, sheet, sheetId } = setup();
    const malformedCreate: CreateImageCommand = {
      commandId: IDS.createCommand,
      type: MIND_MAP_COMMAND_TYPES.createImage,
      sheetId,
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp: '2026-07-21T00:00:00.000Z',
      payload: {
        asset: { ...asset(), mimeType: 'text/plain' },
        image: image(existingImage.topicId),
      },
    };
    expect(() => executeMindMapCommand(document, malformedCreate))
      .toThrow(CommandValidationError);

    const otherTopicId = Object.keys(sheet.topics)
      .find((topicId) => topicId !== existingImage.topicId)! as TopicId;
    const ownershipChange: UpdateImageCommand = {
      commandId: IDS.updateCommand,
      type: MIND_MAP_COMMAND_TYPES.updateImage,
      sheetId,
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp: '2026-07-21T00:00:00.000Z',
      payload: { image: { ...existingImage, topicId: otherTopicId } },
    };
    expect(() => executeMindMapCommand(document, ownershipChange))
      .toThrow(/immutable Topic ownership/);

    const assetOwnershipChange: UpdateImageCommand = {
      ...ownershipChange,
      payload: {
        image: { ...existingImage, assetId: IDS.asset },
      },
    };
    expect(() => executeMindMapCommand(document, assetOwnershipChange))
      .toThrow(/immutable Asset ownership/);
  });
});
