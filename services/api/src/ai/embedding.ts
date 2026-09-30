export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingSource {
  categoryLabel: string;
  description: string | null;
  address: string | null;
  visualEvidence: string | null;
}

export interface EmbeddingResult {
  vector: number[];
  modelVersion: string;
}

export class EmbeddingError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'EmbeddingError';
  }
}

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export function isEmbeddingEnabled(): boolean {
  return (
    process.env.AI_EMBEDDINGS_ENABLED?.trim().toLowerCase() === 'true' &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

export function embeddingModel(): string {
  return (
    process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small'
  );
}

/**
 * Composes the text that represents a report. Labelled lines keep the vector
 * anchored to fields rather than free prose, and empty fields are omitted so
 * two reports are not made "similar" by shared placeholders.
 */
export function buildEmbeddingText(source: EmbeddingSource): string {
  const lines = [
    ['Category', source.categoryLabel],
    ['Description', source.description],
    ['Location', source.address],
    ['Visible evidence', source.visualEvidence],
  ]
    .map(([label, value]) => [label, value?.trim()] as const)
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => label + ': ' + value);
  return lines.join('\n');
}

export async function generateEmbedding(input: {
  text: string;
  model: string;
}): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new EmbeddingError('OPENAI_API_KEY_MISSING', false);
  if (!input.text.trim()) throw new EmbeddingError('EMPTY_INPUT', false);

  let response: Response;
  try {
    response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
    });
  } catch {
    throw new EmbeddingError('OPENAI_CONNECTION_FAILED', true);
  }

  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500;
    throw new EmbeddingError('OPENAI_HTTP_' + response.status, retryable);
  }

  const payload = (await response.json()) as {
    model?: string;
    data?: Array<{ embedding?: unknown }>;
  };
  const vector = payload.data?.[0]?.embedding;
  if (
    !Array.isArray(vector) ||
    vector.length !== EMBEDDING_DIMENSIONS ||
    !vector.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new EmbeddingError('OPENAI_INVALID_RESULT', true);
  }

  return { vector: vector as number[], modelVersion: payload.model ?? input.model };
}
