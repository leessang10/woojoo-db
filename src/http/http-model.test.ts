import { describe, expect, it } from 'vitest';
import { blankSpec, buildOutgoing, normalizeSpec, paramsFromUrl, parseCurl, requestTitle, resolve, sameSpec, shellWords, specFromOutgoing, toCurl, urlWithParams, variableMap } from './model';

describe('variables', () => {
  it('resolves environment values and reports unknown names without re-expanding values', () => {
    const missing = new Set<string>();
    const values = variableMap([{ key: 'host', value: 'api.dev', enabled: true }, { key: 'loop', value: '{{host}}', enabled: true }, { key: 'off', value: 'x', enabled: false }]);
    expect(resolve('https://{{host}}/{{ loop }}/{{off}}/{{nope}}', values, missing)).toBe('https://api.dev/{{host}}/{{off}}/{{nope}}');
    expect([...missing]).toEqual(['off', 'nope']);
    expect(resolve('{{$uuid}}', new Map())).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('query params', () => {
  it('reads params from the URL and keeps disabled rows from the table', () => {
    const params = paramsFromUrl('https://x.dev/a?page=1&q={{term}}&flag#top', [{ key: 'debug', value: '1', enabled: false }, { key: 'old', value: '', enabled: true }]);
    expect(params).toEqual([
      { key: 'page', value: '1', enabled: true }, { key: 'q', value: '{{term}}', enabled: true }, { key: 'flag', value: '', enabled: true },
      { key: 'debug', value: '1', enabled: false },
    ]);
    expect(urlWithParams('https://x.dev/a?old=1#top', params)).toBe('https://x.dev/a?page=1&q={{term}}&flag#top');
    expect(urlWithParams('https://x.dev/a?x=1', [])).toBe('https://x.dev/a');
  });
});

describe('building requests', () => {
  it('applies variables, auth and default content types', () => {
    const spec = normalizeSpec({
      method: 'post', url: '{{base}}/users',
      headers: [{ key: 'X-Trace', value: '{{trace}}', enabled: true }, { key: 'X-Off', value: '1', enabled: false }],
      body: { kind: 'json', text: '{"name":"{{name}}"}', form: [] },
      auth: { ...blankSpec().auth, kind: 'basic', username: 'kim', password: '비밀' },
    });
    const { outgoing, missing } = buildOutgoing(spec, [{ key: 'base', value: 'http://localhost:8080', enabled: true }, { key: 'name', value: 'woojoo', enabled: true }], { requestId: 'r1', name: 'Create' });
    expect(missing).toEqual(['trace']);
    expect(outgoing.method).toBe('POST');
    expect(outgoing.url).toBe('http://localhost:8080/users');
    expect(outgoing.headers).toEqual([['X-Trace', '{{trace}}'], ['Authorization', `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('kim:비밀')))}`], ['Content-Type', 'application/json']]);
    expect(outgoing.body).toEqual({ kind: 'text', text: '{"name":"woojoo"}' });
    expect(outgoing.requestId).toBe('r1');
  });
  it('keeps an explicit Authorization header and encodes forms and API keys', () => {
    const spec = normalizeSpec({
      url: 'https://x.dev/search?a=1', headers: [{ key: 'authorization', value: 'Token abc', enabled: true }],
      auth: { ...blankSpec().auth, kind: 'bearer', token: 'ignored' },
      body: { kind: 'form', text: '', form: [{ key: 'q', value: 'a b&c', enabled: true }] },
    });
    const { outgoing } = buildOutgoing(spec, []);
    expect(outgoing.headers).toEqual([['authorization', 'Token abc'], ['Content-Type', 'application/x-www-form-urlencoded']]);
    expect(outgoing.body).toEqual({ kind: 'text', text: 'q=a+b%26c' });
    const keyed = buildOutgoing(normalizeSpec({ url: 'https://x.dev/s?a=1', auth: { ...blankSpec().auth, kind: 'apiKey', key: 'api key', value: 'v/1', in: 'query' } }), []);
    expect(keyed.outgoing.url).toBe('https://x.dev/s?a=1&api%20key=v%2F1');
  });
});

describe('cURL', () => {
  it('splits shell words with quotes and continuations', () => {
    expect(shellWords(`curl 'a b' "c \\"d\\"" e\\ f \\\n -H x`)).toEqual(['curl', 'a b', 'c "d"', 'e f', '-H', 'x']);
    expect(shellWords('curl ^\r\n  "https://x.dev"')).toEqual(['curl', 'https://x.dev']);
  });
  it('imports a browser "Copy as cURL" command', () => {
    const spec = parseCurl(`curl 'https://api.x.dev/users?page=2' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  --data-raw '{"name":"kim"}' \\
  --compressed -k`);
    expect(spec.method).toBe('POST');
    expect(spec.url).toBe('https://api.x.dev/users?page=2');
    expect(spec.params).toEqual([{ key: 'page', value: '2', enabled: true }]);
    // The JSON body type adds Content-Type itself, so the duplicate header is dropped.
    expect(spec.headers).toEqual([{ key: 'accept', value: 'application/json', enabled: true }]);
    expect(spec.body).toEqual({ kind: 'json', text: '{\n  "name": "kim"\n}', form: [] });
    expect(spec.options.verifyTls).toBe(false);
  });
  it('imports forms, files, basic auth and -G', () => {
    const form = parseCurl('curl -u admin:pw -d a=1 -d b=x%20y https://x.dev/f');
    expect(form.method).toBe('POST');
    expect(form.auth).toMatchObject({ kind: 'basic', username: 'admin', password: 'pw' });
    expect(form.body).toEqual({ kind: 'form', text: '', form: [{ key: 'a', value: '1', enabled: true }, { key: 'b', value: 'x y', enabled: true }] });
    const upload = parseCurl('curl -XPUT https://x.dev/up -F name=doc -F file=@/tmp/a.png;type=image/png');
    expect(upload.method).toBe('PUT');
    expect(upload.body.form).toEqual([{ key: 'name', value: 'doc', enabled: true, file: false }, { key: 'file', value: '/tmp/a.png', enabled: true, file: true }]);
    expect(parseCurl('curl -G https://x.dev/s -d q=1').url).toBe('https://x.dev/s?q=1');
    expect(() => parseCurl('wget https://x.dev')).toThrow();
  });
  it('round-trips an outgoing request through cURL', () => {
    const { outgoing } = buildOutgoing(normalizeSpec({ method: 'PATCH', url: "https://x.dev/it's", body: { kind: 'json', text: '{"a":1}', form: [] } }), []);
    const curl = toCurl(outgoing);
    expect(curl).toContain(`'https://x.dev/it'\\''s'`);
    const back = parseCurl(curl);
    expect(back.method).toBe('PATCH');
    expect(back.url).toBe("https://x.dev/it's");
    expect(back.body.kind).toBe('json');
  });
});

describe('history and tabs', () => {
  it('rebuilds a spec from a sent request', () => {
    const spec = specFromOutgoing({ requestId: null, name: '', method: 'POST', url: 'https://x.dev/a?b=1', headers: [['Content-Type', 'application/json']], body: { kind: 'text', text: '{}' }, timeoutMs: 5000, followRedirects: false, verifyTls: true });
    expect(spec.params).toEqual([{ key: 'b', value: '1', enabled: true }]);
    expect(spec.body.kind).toBe('json');
    expect(spec.options).toEqual({ timeoutMs: 5000, followRedirects: false, verifyTls: true });
  });
  it('names unsaved requests by path and compares specs', () => {
    expect(requestTitle({ ...blankSpec(), url: 'https://api.x.dev/v1/users?x=1' })).toBe('/v1/users');
    expect(requestTitle({ ...blankSpec(), url: 'localhost:8080' })).toBe('localhost:8080');
    expect(sameSpec(blankSpec(), normalizeSpec({}))).toBe(true);
    expect(sameSpec(blankSpec(), { ...blankSpec(), url: 'x' })).toBe(false);
  });
});
