import { ComfyHistoryEntry, ComfyHistoryImage } from '../types';

export interface ResolvedComfyHistoryImage extends ComfyHistoryImage {
  nodeId: string;
}

const isUsableImage = (image: ComfyHistoryImage | undefined): image is ComfyHistoryImage => (
  Boolean(image?.filename)
);

export const resolveComfyHistoryImage = (
  history: ComfyHistoryEntry,
  preferredNodeId?: string
): ResolvedComfyHistoryImage | undefined => {
  const candidates = Object.entries(history.outputs || {}).flatMap(([nodeId, output]) => (
    (output.images || [])
      .filter(isUsableImage)
      .map(image => ({ ...image, nodeId }))
  ));

  if (!candidates.length) return undefined;

  const preferred = preferredNodeId
    ? candidates.filter(candidate => candidate.nodeId === preferredNodeId)
    : [];

  return preferred.find(candidate => candidate.type === 'output')
    || preferred[0]
    || candidates.find(candidate => candidate.type === 'output')
    || candidates[0];
};
