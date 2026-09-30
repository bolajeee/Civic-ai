export interface ClassificationCategory {
  id: string;
  slug: string;
  label: string;
}

export interface ImageClassification {
  categorySlug: string;
  confidence: number;
  evidence: string;
  modelVersion: string;
}

export class ClassificationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'ClassificationError';
  }
}

const OPENAI_CHAT_COMPLETIONS_URL =
  'https://api.openai.com/v1/chat/completions';
const UNSURE_CATEGORY = 'UNSURE';
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function supportedClassificationImageTypes(): string[] {
  return [...SUPPORTED_IMAGE_TYPES];
}

export function isSupportedClassificationImageType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has(mimeType);
}

export function isClassificationEnabled(): boolean {
  return (
    process.env.AI_CLASSIFICATION_ENABLED?.trim().toLowerCase() === 'true' &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

export function classificationModel(): string {
  return process.env.OPENAI_CLASSIFICATION_MODEL?.trim() || 'gpt-6-luna';
}

export function classificationConfidenceThreshold(): number {
  const configured = Number(process.env.AI_CLASSIFICATION_MIN_CONFIDENCE);
  if (!Number.isFinite(configured)) return 0.65;
  return Math.min(1, Math.max(0, configured));
}

/** Classifies one photo; the citizen-selected category remains canonical. */
export async function classifyReportImage(input: {
  image: Buffer;
  mimeType: string;
  model: string;
  categories: ClassificationCategory[];
}): Promise<ImageClassification> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new ClassificationError('OPENAI_API_KEY_MISSING', false);
  if (!isSupportedClassificationImageType(input.mimeType)) {
    throw new ClassificationError('UNSUPPORTED_IMAGE_TYPE', false);
  }
  if (input.categories.length === 0) {
    throw new ClassificationError('NO_CATEGORIES_CONFIGURED', false);
  }

  const slugs = [...new Set(input.categories.map((category) => category.slug))];
  const allowedSlugs = [...slugs, UNSURE_CATEGORY];
  const dataUrl =
    'data:' + input.mimeType + ';base64,' + input.image.toString('base64');

  let response: Response;
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: input.model,
        reasoning_effort: 'none',
        max_completion_tokens: 120,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'civic_report_image_classification',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                category_slug: {
                  type: 'string',
                  enum: allowedSlugs,
                  description:
                    'The single best matching civic category, or UNSURE.',
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: 'Confidence between zero and one.',
                },
                evidence: {
                  type: 'string',
                  description:
                    'One short sentence describing only visible evidence.',
                },
              },
              required: ['category_slug', 'confidence', 'evidence'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              "Classify the visible civic infrastructure issue in the photo using only the supplied categories. If the image is unclear, unrelated, or does not show enough evidence, choose UNSURE. Do not infer severity, cause, location, or people's identities. Keep evidence to one short sentence.",
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Categories: ' +
                  input.categories
                    .map((category) => category.slug + ' = ' + category.label)
                    .join('; '),
              },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' },
              },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new ClassificationError('OPENAI_CONNECTION_FAILED', true);
  }

  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500;
    throw new ClassificationError('OPENAI_HTTP_' + response.status, retryable);
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: Array<{
      message?: {
        content?: string | null;
        refusal?: string | null;
      };
    }>;
  };
  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ClassificationError('OPENAI_REFUSED', false);
  }
  if (!message?.content) {
    throw new ClassificationError('OPENAI_EMPTY_RESPONSE', true);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content);
  } catch {
    throw new ClassificationError('OPENAI_INVALID_JSON', true);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ClassificationError('OPENAI_INVALID_RESULT', true);
  }

  const result = parsed as Record<string, unknown>;
  const categorySlug = result.category_slug;
  const confidence = result.confidence;
  const evidence = result.evidence;
  if (
    typeof categorySlug !== 'string' ||
    !allowedSlugs.includes(categorySlug) ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    typeof evidence !== 'string'
  ) {
    throw new ClassificationError('OPENAI_INVALID_RESULT', true);
  }

  return {
    categorySlug,
    confidence,
    evidence: evidence.slice(0, 300),
    modelVersion: payload.model ?? input.model,
  };
}
