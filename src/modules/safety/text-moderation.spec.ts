import { scanText } from './text-moderation';

const rules = [
  { key: 'scam_money', config: { terms: ['gift card', 'western union', 'send money'], action: 'warn' as const, score: 0.6, signal: 'scam' as const } },
  { key: 'off_platform', config: { pattern: '(whats\\s?app|telegram)', action: 'warn' as const, score: 0.3, signal: 'off_platform_payment' as const } },
  { key: 'threat', config: { terms: ['i will hurt you'], action: 'hide' as const, score: 0.9, signal: 'violence' as const } },
];

describe('scanText', () => {
  it('allows ordinary messages', () => {
    expect(scanText('Want to grab coffee on Saturday?', rules)).toEqual({ action: 'allow', score: 0, signals: [], matchedRules: [] });
  });
  it('matches whole phrases case-insensitively and combines scores', () => {
    const r = scanText('Can you SEND MONEY via WhatsApp?', rules);
    expect(r.action).toBe('warn');
    expect(r.matchedRules).toEqual(['scam_money', 'off_platform']);
    expect(r.score).toBeCloseTo(0.72, 3);
  });
  it('does not match inside other words', () => {
    expect(scanText('My giftcardigan is cozy', [{ key: 'k', config: { terms: ['gift card'], action: 'warn', score: 1, signal: 'scam' } }]).action).toBe('allow');
  });
  it('lets hide win over warn', () => {
    expect(scanText('send money or I will hurt you', rules).action).toBe('hide');
  });
  it('ignores invalid admin regexes', () => {
    expect(scanText('hello', [{ key: 'bad', config: { pattern: '(', action: 'hide', score: 1, signal: 'spam' } }]).action).toBe('allow');
  });
});
