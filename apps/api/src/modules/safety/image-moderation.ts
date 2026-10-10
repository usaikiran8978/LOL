import { DetectModerationLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

export interface ImageLabels {
  labels: Array<{ name: string; parent: string | null; confidence: number }>;
}

/** Image moderation provider abstraction. Decisions (thresholds) live in admin settings, not in adapters. */
export interface ImageModerationProvider {
  readonly name: string;
  analyze(storageKey: string): Promise<ImageLabels>;
}

export const IMAGE_MODERATION = Symbol('IMAGE_MODERATION');

/** AWS Rekognition DetectModerationLabels reading the object directly from the media bucket. */
export class RekognitionImageModeration implements ImageModerationProvider {
  readonly name = 'rekognition';
  private readonly client: RekognitionClient;

  constructor(private readonly bucket: string, region: string) {
    this.client = new RekognitionClient({ region });
  }

  async analyze(storageKey: string): Promise<ImageLabels> {
    const r = await this.client.send(new DetectModerationLabelsCommand({ Image: { S3Object: { Bucket: this.bucket, Name: storageKey } }, MinConfidence: 50 }));
    return { labels: (r.ModerationLabels ?? []).map((l) => ({ name: l.Name ?? '', parent: l.ParentName || null, confidence: (l.Confidence ?? 0) / 100 })) };
  }
}

export interface ImagePolicy {
  rejectLabels: string[];   // top-level or child label names that reject at >= rejectConfidence
  reviewLabels: string[];   // labels that send to human review at >= reviewConfidence
  rejectConfidence: number;
  reviewConfidence: number;
}

/** Pure decision from provider labels + admin policy (unit-tested). */
export function decideImage(labels: ImageLabels, p: ImagePolicy): 'approved' | 'rejected' | 'needs_review' {
  const hit = (names: string[], min: number) => labels.labels.some((l) => l.confidence >= min && (names.includes(l.name) || (l.parent !== null && names.includes(l.parent))));
  if (hit(p.rejectLabels, p.rejectConfidence)) return 'rejected';
  if (hit(p.reviewLabels, p.reviewConfidence) || hit(p.rejectLabels, p.reviewConfidence)) return 'needs_review';
  return 'approved';
}
