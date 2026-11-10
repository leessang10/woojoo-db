import { describe, expect, it } from 'vitest';
import { buildOutgoing, variablesIn } from './model';
import { API_TEMPLATES, looksLive, pickJson, templateFields, templateVariables, uniqueName } from './templates';

const specText = (spec: unknown) => JSON.stringify(spec);

describe('API templates', () => {
  it('defines every variable its requests use in its environment', () => {
    for (const template of API_TEMPLATES) {
      const keys = new Set(templateVariables(template, {}).map(v => v.key));
      const used = template.requests.flatMap(r => variablesIn(specText(r.spec))).filter(name => !name.startsWith('$'));
      const fetched = template.steps.flatMap(step => step.fetch ? variablesIn(specText(step.fetch.request)) : []);
      const undefinedNames = [...used, ...fetched].filter(name => !keys.has(name));
      expect(undefinedNames, template.id).toEqual([]);
    }
  });

  it('builds sendable requests once keys are filled', () => {
    for (const template of API_TEMPLATES) {
      const values = Object.fromEntries(templateFields(template).map(field => [field.key, field.value ?? 'x']));
      // Blank-but-defined values resolve to empty strings, so nothing is reported missing.
      for (const request of template.requests) {
        const { outgoing, missing } = buildOutgoing(request.spec, templateVariables(template, values));
        expect(outgoing.url, `${template.id} ${request.name}`).toMatch(/^https:\/\/api(-m\.sandbox\.paypal|\.stripe|\.tosspayments)\.com\//);
        expect(missing, `${template.id} ${request.name}`).toEqual([]);
        expect(outgoing.headers.some(([key]) => key === 'Authorization')).toBe(true);
      }
    }
  });

  it('sends Toss confirm amount as a JSON number', () => {
    const toss = API_TEMPLATES.find(t => t.id === 'tosspayments')!;
    const { outgoing } = buildOutgoing(toss.requests[0].spec, templateVariables(toss, { tossPaymentKey: 'pk', tossOrderId: 'o1', tossAmount: '15000' }));
    expect(outgoing.body.kind === 'text' && JSON.parse(outgoing.body.text)).toEqual({ paymentKey: 'pk', orderId: 'o1', amount: 15000 });
  });

  it('flags live keys and picks fetched tokens', () => {
    const stripeKey = API_TEMPLATES.find(t => t.id === 'stripe')!.steps[1].fields![0];
    expect(looksLive(stripeKey, 'sk_live_123')).toBe(true);
    expect(looksLive(stripeKey, 'sk_test_123')).toBe(false);
    expect(pickJson('{"access_token":"A21","expires_in":32400}', 'access_token')).toBe('A21');
    expect(pickJson('not json', 'access_token')).toBeNull();
    expect(uniqueName('Stripe', ['Stripe', 'Stripe 2'])).toBe('Stripe 3');
  });
});
