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
  it('locks an anchor definition shared by another service',()=>{
    const d=createProject('services:\n  a:\n    image: redis:7.4\n    environment: &shared\n      MODE: original\n  b:\n    image: redis:7.4\n    environment: *shared\n');
    expect(()=>patchProject(d,[{path:['services','a','environment','MODE'],value:'new'}])).toThrow(/source|원문/);
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
  it('undo restores the original source set and a literal empty original stays an existing file', async () => {
    const {changeProject}=await import('./document');const {inputFor}=await import('./api');
    const d=createProject('services: {}');d.files=[{path:'C:/empty.yml',original:'',source:d.source}];
    const next=changeProject(d,'services: {redis: {image: redis:7.4}}');next.files=[{...d.files[0],source:next.source}];
    expect(undoProject(next).files[0].source).toBe(d.source);
    expect(inputFor(d,{}).files[0].original).toBe('');
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
  it('restores the bundled Redis healthcheck and public defaults without saving arbitrary commands', async () => {
    const {addComponent}=await import('./catalog');
    const saved=safeDraft(addComponent(createProject(),{template:'redis'}));
    const redis=readProject(restoreDraft(saved).source).services[0];
    expect(redis.healthcheck?.test).toEqual(['CMD','redis-cli','ping']);
    expect(redis.command).toEqual(['redis-server','--appendonly','yes']);
  });
  it('persists connection references without copying their values and restores tracked renames',async()=>{
    const {addComponent}=await import('./catalog');const {proposeConnection,applyConnection,renameService}=await import('./connections');
    let d=addComponent(addComponent(createProject(),{name:'api',image:'example/api:1'}),{template:'mysql'});d=applyConnection(d,proposeConnection(d,'api','mysql'));
    d=patchProject(d,[{path:['services','mysql','environment','MYSQL_PASSWORD'],value:'never-persist-this'}]);
    const saved=safeDraft(d);expect(JSON.stringify(saved)).not.toContain('never-persist-this');
    const restored=restoreDraft(saved);expect(restored.connections).toHaveLength(1);
    const renamed=renameService(restored,'mysql','database');expect(readProject(renamed.source).services[0].environment.DB_HOST).toBe('database');
  });
});
