import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildCivitaiGenerationData, embedCivitaiMetadataInWebp } from './civitai-metadata';

const webpChunks = (input: Buffer) => {
  const chunks: Array<{ fourcc: string; data: Buffer }> = [];
  let offset = 12;
  while (offset + 8 <= input.length) {
    const size = input.readUInt32LE(offset + 4);
    chunks.push({
      fourcc: input.toString('ascii', offset, offset + 4),
      data: input.subarray(offset + 8, offset + 8 + size),
    });
    offset += 8 + size + (size % 2);
  }
  return chunks;
};

const decodeUnicodeUserComment = (exif: Buffer) => {
  const prefix = Buffer.from('UNICODE\0', 'ascii');
  const start = exif.indexOf(prefix);
  expect(start).toBeGreaterThanOrEqual(0);
  const utf16Be = Buffer.from(exif.subarray(start + prefix.length));
  for (let index = 0; index < utf16Be.length; index += 2) {
    const byte = utf16Be[index];
    utf16Be[index] = utf16Be[index + 1];
    utf16Be[index + 1] = byte;
  }
  return utf16Be.toString('utf16le');
};

describe('Civitai generation metadata', () => {
  it('builds Automatic1111-compatible generation text from a saved message', () => {
    const result = buildCivitaiGenerationData({
      text: 'display prompt',
      prompt: 'original prompt',
      generationPrompt: 'portrait, lumière café',
      model: 'checkpoints\\realistic-model.safetensors',
      width: 896,
      height: 1152,
      steps: 8,
      cfg: 1.1,
      seed: 4242,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      generationParams: JSON.stringify({ negativePrompt: 'blurry, low quality' }),
    }, { width: 1792, height: 2304 });

    expect(result).toBe([
      'portrait, lumière café',
      'Negative prompt: blurry, low quality',
      'Steps: 8, Sampler: dpmpp_2m, Schedule type: karras, CFG scale: 1.1, Seed: 4242, Size: 1792x2304, Model: realistic-model, Tool: ComfyUI, Technique: txt2img, Version: ComfyUI',
    ].join('\n'));
  });

  it('adds a linked Civitai resource and uses its AutoV2 hash', () => {
    const result = buildCivitaiGenerationData({
      prompt: 'portrait',
      model: 'intorealism_zitV70.safetensors',
      generationParams: JSON.stringify({ modelHash: 'OLDHASH' }),
    }, undefined, {
      modelName: 'IntoRealism',
      versionName: 'ZIT v7.0',
      air: 'urn:air:zimageturbo:checkpoint:civitai:1609320@3081104',
      autoV2: '62EF7640AB',
    });

    expect(result).toContain('Model hash: 62EF7640AB');
    expect(result).toContain('Tool: ComfyUI, Technique: txt2img, Version: ComfyUI');
    expect(result).toContain('Civitai resources: [{"modelName":"IntoRealism","versionName":"ZIT v7.0","air":"urn:air:zimageturbo:checkpoint:civitai:1609320@3081104"}]');
  });

  it('adds one Unicode EXIF comment without recompressing the WebP bitstream', async () => {
    const source = await sharp({
      create: { width: 37, height: 29, channels: 3, background: '#b34c7d' },
    }).webp({ quality: 85 }).toBuffer();
    const generationData = 'portrait, lumière café\nSteps: 8, Seed: 4242, Size: 37x29';

    const first = embedCivitaiMetadataInWebp(source, generationData, { width: 37, height: 29 });
    const second = embedCivitaiMetadataInWebp(first, generationData, { width: 37, height: 29 });
    const sourceChunks = webpChunks(source);
    const outputChunks = webpChunks(second);
    const sourceBitstream = sourceChunks.find(chunk => ['VP8 ', 'VP8L'].includes(chunk.fourcc));
    const outputBitstream = outputChunks.find(chunk => ['VP8 ', 'VP8L'].includes(chunk.fourcc));
    const exifChunks = outputChunks.filter(chunk => chunk.fourcc === 'EXIF');

    expect(outputChunks[0].fourcc).toBe('VP8X');
    expect(outputChunks[0].data[0] & 0x08).toBe(0x08);
    expect(outputBitstream?.data.equals(sourceBitstream!.data)).toBe(true);
    expect(exifChunks).toHaveLength(1);
    expect(decodeUnicodeUserComment(exifChunks[0].data)).toBe(generationData);
    await expect(sharp(second).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 37,
      height: 29,
    });
  });
});
