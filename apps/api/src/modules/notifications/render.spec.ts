import { inQuietHours, placeholders, render, undeclared } from './render';

describe('notification rendering', () => {
  it('fills placeholders and blanks unknown ones', () => {
    expect(render('Hi {{ name }}, {{code}} {{missing}}', { name: 'Asha', code: 123456 })).toBe('Hi Asha, 123456 ');
  });
  it('escapes HTML when asked', () => {
    expect(render('<b>{{name}}</b>', { name: '<script>' }, { html: true })).toBe('<b>&lt;script&gt;</b>');
  });
  it('finds placeholders and undeclared variables', () => {
    expect(placeholders('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(undeclared([{ body: '{{a}}', title: '{{z}}' }], ['a'])).toEqual(['z']);
  });
});

describe('inQuietHours', () => {
  it('handles windows that cross midnight in the user timezone', () => {
    // 23:30 in Kolkata = 18:00 UTC
    const r = inQuietHours(new Date('2026-10-08T18:00:00Z'), '22:00', '07:00', 'Asia/Kolkata');
    expect(r.quiet).toBe(true);
    expect(r.endsAt!.toISOString()).toBe('2026-10-09T01:30:00.000Z'); // 07:00 IST
    expect(inQuietHours(new Date('2026-10-08T06:00:00Z'), '22:00', '07:00', 'Asia/Kolkata').quiet).toBe(false); // 11:30 IST
  });
});
