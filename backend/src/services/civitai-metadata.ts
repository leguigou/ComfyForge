import path from 'path';

export interface CivitaiGenerationSource {
  text?: unknown;
  prompt?: unknown;
  generationPrompt?: unknown;
  model?: unknown;
  width?: unknown;
  height?: unknown;
  steps?: unknown;
  cfg?: unknown;
  seed?: unknown;
  sampler?: unknown;
  scheduler?: unknown;
  generationParams?: unknown;
}

export interface CivitaiResourceMetadata {
  modelName?: string;
  versionName?: string;
  air?: string;
  autoV2?: string;
  sha256?: string;
}

type WebpChunk = {
  fourcc: string;
  bytes: Buffer;
  data: Buffer;
};

const parseGenerationParams = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const firstString = (...values: unknown[]) => values.find(value => (
  typeof value === 'string' && value.trim()
)) as string | undefined;

const firstFiniteNumber = (...values: unknown[]) => values.find(value => (
  typeof value === 'number' && Number.isFinite(value)
)) as number | undefined;

const metadataValue = (value: string) => (
  /[,\n\r]/.test(value) ? JSON.stringify(value) : value
);

const modelDisplayName = (value: string) => {
  const filename = path.basename(value.replace(/\\/g, '/'));
  const extension = path.extname(filename);
  return extension ? filename.slice(0, -extension.length) : filename;
};

export const buildCivitaiGenerationData = (
  source: CivitaiGenerationSource,
  actualSize?: { width?: number; height?: number },
  resource?: CivitaiResourceMetadata,
) => {
  const stored = parseGenerationParams(source.generationParams);
  const prompt = firstString(source.generationPrompt, source.prompt, source.text)?.trim();
  if (!prompt) return '';

  const negativePrompt = firstString(stored.negativePrompt)?.trim();
  const steps = firstFiniteNumber(source.steps, stored.steps);
  const sampler = firstString(source.sampler, stored.sampler)?.trim();
  const scheduler = firstString(source.scheduler, stored.scheduler)?.trim();
  const cfg = firstFiniteNumber(source.cfg, stored.cfg);
  const seed = firstFiniteNumber(source.seed, stored.seed);
  const width = firstFiniteNumber(actualSize?.width, source.width, stored.width);
  const height = firstFiniteNumber(actualSize?.height, source.height, stored.height);
  const model = firstString(source.model, stored.comfyModel)?.trim();
  const modelHash = firstString(resource?.autoV2, stored.modelHash)?.trim();

  const details: string[] = [];
  if (steps !== undefined) details.push(`Steps: ${steps}`);
  if (sampler) details.push(`Sampler: ${metadataValue(sampler)}`);
  if (scheduler) details.push(`Schedule type: ${metadataValue(scheduler)}`);
  if (cfg !== undefined) details.push(`CFG scale: ${cfg}`);
  if (seed !== undefined) details.push(`Seed: ${seed}`);
  if (width !== undefined && height !== undefined) details.push(`Size: ${width}x${height}`);
  if (model) details.push(`Model: ${metadataValue(modelDisplayName(model))}`);
  if (modelHash) details.push(`Model hash: ${metadataValue(modelHash)}`);
  details.push('Tool: ComfyUI');
  details.push('Technique: txt2img');
  details.push('Version: ComfyUI');
  if (resource?.air) details.push(`Civitai resources: ${JSON.stringify([{
    modelName: resource.modelName,
    versionName: resource.versionName,
    air: resource.air,
  }])}`);

  const lines = [prompt];
  if (negativePrompt) lines.push(`Negative prompt: ${negativePrompt}`);
  if (details.length) lines.push(details.join(', '));
  return lines.join('\n');
};

const utf16Be = (value: string) => {
  const encoded = Buffer.from(value, 'utf16le');
  for (let index = 0; index < encoded.length; index += 2) {
    const byte = encoded[index];
    encoded[index] = encoded[index + 1];
    encoded[index + 1] = byte;
  }
  return encoded;
};

// Matches piexif.helper.UserComment.dump(value, encoding="unicode"), used by
// Civitai-compatible ComfyUI image saver nodes for JPEG and WebP files.
const createExifUserComment = (value: string) => {
  const comment = Buffer.concat([Buffer.from('UNICODE\0', 'ascii'), utf16Be(value)]);
  const ifd0Offset = 8;
  const exifIfdOffset = 26;
  const commentOffset = 44;
  const tiff = Buffer.alloc(commentOffset + comment.length);

  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0Offset, 4);

  tiff.writeUInt16LE(1, ifd0Offset);
  tiff.writeUInt16LE(0x8769, ifd0Offset + 2); // ExifIFDPointer
  tiff.writeUInt16LE(4, ifd0Offset + 4); // LONG
  tiff.writeUInt32LE(1, ifd0Offset + 6);
  tiff.writeUInt32LE(exifIfdOffset, ifd0Offset + 10);
  tiff.writeUInt32LE(0, ifd0Offset + 14);

  tiff.writeUInt16LE(1, exifIfdOffset);
  tiff.writeUInt16LE(0x9286, exifIfdOffset + 2); // UserComment
  tiff.writeUInt16LE(7, exifIfdOffset + 4); // UNDEFINED
  tiff.writeUInt32LE(comment.length, exifIfdOffset + 6);
  tiff.writeUInt32LE(commentOffset, exifIfdOffset + 10);
  tiff.writeUInt32LE(0, exifIfdOffset + 14);
  comment.copy(tiff, commentOffset);

  return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
};

const parseWebpChunks = (input: Buffer): WebpChunk[] => {
  if (
    input.length < 12
    || input.toString('ascii', 0, 4) !== 'RIFF'
    || input.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('Invalid WebP image');
  }

  const declaredLength = input.readUInt32LE(4) + 8;
  if (declaredLength > input.length) throw new Error('Truncated WebP image');

  const chunks: WebpChunk[] = [];
  let offset = 12;
  while (offset + 8 <= declaredLength) {
    const size = input.readUInt32LE(offset + 4);
    const paddedSize = size + (size % 2);
    const end = offset + 8 + paddedSize;
    if (end > declaredLength) throw new Error('Truncated WebP chunk');
    chunks.push({
      fourcc: input.toString('ascii', offset, offset + 4),
      bytes: input.subarray(offset, end),
      data: input.subarray(offset + 8, offset + 8 + size),
    });
    offset = end;
  }
  if (offset !== declaredLength) throw new Error('Invalid WebP chunk alignment');
  return chunks;
};

const makeChunk = (fourcc: string, data: Buffer) => {
  const padding = data.length % 2;
  const chunk = Buffer.alloc(8 + data.length + padding);
  chunk.write(fourcc, 0, 4, 'ascii');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
};

const writeUInt24LE = (target: Buffer, value: number, offset: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
};

const createVp8xChunk = (chunks: WebpChunk[], width: number, height: number) => {
  if (
    !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
    || width > 0x1000000 || height > 0x1000000
  ) {
    throw new Error('Invalid WebP dimensions');
  }
  const data = Buffer.alloc(10);
  const lossless = chunks.find(chunk => chunk.fourcc === 'VP8L');
  const losslessHasAlpha = Boolean(lossless && lossless.data.length >= 5 && (lossless.data[4] & 0x10));
  data[0] = 0x08 | (losslessHasAlpha ? 0x10 : 0); // EXIF and optional alpha flags
  writeUInt24LE(data, width - 1, 4);
  writeUInt24LE(data, height - 1, 7);
  return makeChunk('VP8X', data);
};

/** Add/replace EXIF generation data without recompressing the WebP pixels. */
export const embedCivitaiMetadataInWebp = (
  input: Buffer,
  generationData: string,
  dimensions: { width: number; height: number },
) => {
  if (!generationData.trim()) return input;
  const parsedChunks = parseWebpChunks(input);
  const outputChunks: Buffer[] = [];
  const vp8x = parsedChunks.find(chunk => chunk.fourcc === 'VP8X');

  if (vp8x) {
    if (vp8x.data.length < 10) throw new Error('Invalid VP8X chunk');
    const updatedVp8x = Buffer.from(vp8x.bytes);
    updatedVp8x[8] |= 0x08;
    outputChunks.push(updatedVp8x);
  } else {
    outputChunks.push(createVp8xChunk(parsedChunks, dimensions.width, dimensions.height));
  }

  for (const chunk of parsedChunks) {
    if (chunk.fourcc === 'VP8X' || chunk.fourcc === 'EXIF') continue;
    outputChunks.push(chunk.bytes);
  }
  outputChunks.push(makeChunk('EXIF', createExifUserComment(generationData)));

  const output = Buffer.concat([Buffer.alloc(12), ...outputChunks]);
  output.write('RIFF', 0, 4, 'ascii');
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WEBP', 8, 4, 'ascii');
  return output;
};
