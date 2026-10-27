import { describe, expect, it } from 'vitest';
import { createProject, patchProject, readProject, undoProject, redoProject } from './document';
import { safeDraft, restoreDraft } from './persistence';

describe('project source documents', () => {
  it('preserves comments, extensions and interpolation when editing an unrelated field', () => {
    const draft = createProject('# original\nx-owned: {magic: yes}\nservices:\n  api:\n    image: example:1 # pin\n    environment:\n      TOKEN: ${TOKEN:?required}\n');
    const next = patchProject(draft, [{ path: ['services', 'api', 'restart'], value: 'unless-stopped' }]);
    expect(next.source).toContain('# original'); expect(next.source).toContain('# pin');
    expect(next.source).toContain('x-owned: { magic: yes }'); expect(next.source).toContain('${TOKEN:?required}');
    expect(readProject(next.source).services[0].restart).toBe('unless-stopped');
    expect(undoProject(next).source).toBe(draft.source); expect(redoProject(undoProject(next)).source).toBe(next.source);
  });
  it('locks inherited services instead of silently expanding shared anchors', () => {
    const source = 'x-base: &base\n  image: redis:7.4\nservices:\n  redis:\n    <<: *base\n';
    expect(readProject(source).services[0].editable).toBe(false);
    expect(() => patchProject(createProject(source), [{ path: ['services', 'redis', 'image'], value: 'redis:8' }])).toThrow(/source|원문/i);
  });
  it('exposes malformed YAML issues without throwing away the document', () => {
    const view = readProject('services:\n  api:\n    image: [invalid\n');
    expect(view.issues.some(i => i.severity === 'error')).toBe(true);
  });
  it('reads long syntax ports, networks and mounts without conflating published ports', () => {
    const view = readProject('services:\n  api:\n    image: api:1\n    ports:\n      - target: 3000\n        published: "8080"\n        host_ip: "127.0.0.1"\n        protocol: tcp\n    volumes:\n      - type: volume\n        source: shared\n        target: /uploads\n        read_only: true\nvolumes:\n  shared: {}\n');
    expect(view.services[0].ports[0]).toMatchObject({target: 3000, published: '8080', hostIp: '127.0.0.1'});
    expect(view.services[0].mounts[0]).toMatchObject({type: 'volume', source: 'shared', target: '/uploads', readOnly: true});
    expect(view.services[0].networks).toEqual(['default']);
  });
});

describe('safe draft restoration', () => {
  it('never persists arbitrary values or raw YAML, but restores safe structure', () => {
    const draft = createProject('services:\n  api:\n    image: api:1\n    command: echo secret-command\n    environment:\n      OPAQUE: secret-environment\n    build:\n      context: .\n      args:\n        OPAQUE: secret-build\n    labels:\n      custom: secret-label\n    ports: ["127.0.0.1:8080:3000"]\n');
    const saved = safeDraft(draft); const json = JSON.stringify(saved);
    for (const secret of ['secret-command', 'secret-environment', 'secret-build', 'secret-label']) expect(json).not.toContain(secret);
    expect(json).not.toContain('source":');
    const restored = restoreDraft(saved); const view = readProject(restored.source);
    expect(view.services[0].key).toBe('api'); expect(view.services[0].ports[0].target).toBe(3000);
    expect(restored.needsInput).toBe(true);
  });
  it('stores imported file identities without copying their contents', () => {
    const draft = createProject('services: {api: {image: "private:1", command: "secret"}}');
    draft.files = [{path: 'C:/app/compose.yml', original: draft.source, source: draft.source}];
    const saved = safeDraft(draft);
    expect(JSON.stringify(saved)).not.toContain('secret'); expect(saved.files).toEqual(['C:/app/compose.yml']);
  });
});
