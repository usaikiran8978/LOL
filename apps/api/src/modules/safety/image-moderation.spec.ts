import { decideImage } from './image-moderation';

const policy = { rejectLabels: ['Explicit Nudity', 'Violence'], reviewLabels: ['Suggestive'], rejectConfidence: 0.9, reviewConfidence: 0.6 };

describe('decideImage', () => {
  it('rejects high-confidence prohibited labels, including via parent label', () => {
    expect(decideImage({ labels: [{ name: 'Graphic Violence', parent: 'Violence', confidence: 0.95 }] }, policy)).toBe('rejected');
  });
  it('routes borderline content to human review', () => {
    expect(decideImage({ labels: [{ name: 'Explicit Nudity', parent: null, confidence: 0.7 }] }, policy)).toBe('needs_review');
    expect(decideImage({ labels: [{ name: 'Suggestive', parent: null, confidence: 0.65 }] }, policy)).toBe('needs_review');
  });
  it('approves clean images', () => {
    expect(decideImage({ labels: [] }, policy)).toBe('approved');
  });
});
