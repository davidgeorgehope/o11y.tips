import { generateImage, generateJSON } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../../config.js';
import { generateId } from '../../utils/hash.js';
import type { ImageSpec, ContentOutline, GenerationContext, GeneratedContent } from './types.js';

const logger = createLogger('generation:images');

export interface GeneratedImageResult {
  id: string;
  type: ImageSpec['type'];
  prompt: string;
  altText: string;
  filename: string;
  filePath: string;
  width: number;
  height: number;
  mimeType: string;
}

export async function generateImages(
  context: GenerationContext,
  outline: ContentOutline,
  content: GeneratedContent
): Promise<GeneratedImageResult[]> {
  logger.debug('Planning image generation', { title: content.title });

  // Plan what images to generate
  const imageSpecs = await planImages(outline, content);

  if (imageSpecs.length === 0) {
    logger.debug('No images planned');
    return [];
  }

  const results: GeneratedImageResult[] = [];

  for (const spec of imageSpecs) {
    try {
      const result = await generateSingleImage(spec, context, content);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      logger.error('Failed to generate image', { spec, error });
    }
  }

  logger.debug('Image generation complete', { count: results.length });
  return results;
}

async function planImages(
  outline: ContentOutline,
  content: GeneratedContent
): Promise<ImageSpec[]> {
  const prompt = `Plan images for this article.

Title: ${content.title}
Description: ${content.description}

Sections:
${outline.sections.map(s => `- ${s.heading} (${s.type})`).join('\n')}

Determine what images would enhance this article. Consider:
1. Hero image for the article
2. Diagrams for complex concepts
3. Inline illustrations for key sections

Respond with JSON:
{
  "images": [
    {
      "type": "<'hero' | 'inline' | 'diagram'>",
      "prompt": "<detailed image generation prompt>",
      "altText": "<accessibility alt text>",
      "placement": "<where in the article>",
      "aspectRatio": "<'16:9' | '4:3' | '1:1'>"
    },
    ...
  ]
}

Guidelines:
- Hero image: Conceptual, professional, represents the main topic
- Diagrams: Technical, clear, educational
- Inline: Supportive, contextual

Maximum 3 images total. Quality over quantity.`;

  try {
    const response = await generateJSON<{ images: ImageSpec[] }>(prompt, {
      model: 'gemini-flash',
      temperature: 0.5,
    });

    return response.content.images || [];
  } catch (error) {
    logger.error('Failed to plan images', { error });
    // Return at least a hero image
    return [{
      type: 'hero',
      prompt: `Professional technical illustration for article: ${content.title}. Modern, clean design, blue and purple gradient, abstract tech elements.`,
      altText: content.title,
      placement: 'header',
      aspectRatio: '16:9',
    }];
  }
}

async function generateSingleImage(
  spec: ImageSpec,
  context: GenerationContext,
  content: GeneratedContent
): Promise<GeneratedImageResult | null> {
  logger.debug('Generating image', { type: spec.type, placement: spec.placement });

  // Enhance the prompt for better results
  const enhancedPrompt = enhanceImagePrompt(spec, content);

  const images = await generateImage(enhancedPrompt, {
    aspectRatio: spec.aspectRatio,
    numberOfImages: 1,
  });

  if (images.length === 0) {
    logger.warn('No images returned from generation');
    return null;
  }

  const image = images[0];
  const id = generateId();
  const filename = `${content.slug}-${spec.type}-${id}.png`;

  // Ensure output directory exists
  const outputDir = join(config.paths.output, 'images', context.nicheId);
  await mkdir(outputDir, { recursive: true });

  const filePath = join(outputDir, filename);

  // Save the image
  await writeFile(filePath, image.data);

  // Get image dimensions (PNG header parsing)
  const { width, height } = getPngDimensions(image.data);

  return {
    id,
    type: spec.type,
    prompt: spec.prompt,
    altText: spec.altText,
    filename,
    filePath,
    width,
    height,
    mimeType: image.mimeType,
  };
}

function enhanceImagePrompt(spec: ImageSpec, content: GeneratedContent): string {
  const styleGuide = {
    hero: 'Professional, modern, clean design with subtle gradients. Tech-focused aesthetic. No text in image.',
    diagram: 'Clear technical diagram with labeled components. White or light background. Professional infographic style.',
    inline: 'Supportive illustration that aids understanding. Clean, minimal style. Educational focus.',
  };

  return `${spec.prompt}

Style: ${styleGuide[spec.type]}
Context: Technical article about ${content.title}
Requirements: High quality, professional, suitable for web article`;
}

function getPngDimensions(buffer: Buffer): { width: number; height: number } {
  // PNG header: 8 byte signature, then IHDR chunk
  // IHDR starts at byte 8, chunk type at 12-15 is "IHDR"
  // Width is at bytes 16-19, height at 20-23 (big endian)

  if (buffer.length < 24) {
    return { width: 0, height: 0 };
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  return { width, height };
}
