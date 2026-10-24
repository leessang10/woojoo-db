import { describe, expect, it } from 'vitest';
import { composeTopology, generateCompose, newService } from './compose';
describe('Compose wizard', () => {
  it('quotes values and escapes interpolation without dropping equals in environment values', () => {
    const service = { ...newService('custom'), name: 'api', image: 'example:v1', environment: 'TOKEN=a=b$secret\nFLAG=true', ports: '8080:80', volumes: 'data:/data', command: 'echo "$hello"' };
    const result = JSON.parse(generateCompose('my-app', [service]));
    expect(result.services.api.environment).toEqual({ TOKEN: 'a=b$$secret', FLAG: 'true' });
    expect(result.services.api.ports).toEqual(['127.0.0.1:8080:80']);
    expect(result.volumes).toEqual({ data: {} });
    expect(result.services.api.command).toBe('echo "$$hello"');
  });
  it('rejects duplicate service names and invalid input before saving', () => {
    const service = newService('redis');
    expect(() => generateCompose('app', [service, service])).toThrow();
    expect(() => generateCompose('../app', [service])).toThrow();
    expect(() => generateCompose('app', [{ ...service, ports: '70000:80' }])).toThrow();
  });
  it('templates provide persistent storage and a healthcheck', () => {
    const result = JSON.parse(generateCompose('app', [newService('postgres')]));
    expect(result.services.postgres.healthcheck.test).toContain('pg_isready -U postgres');
    expect(result.services.postgres.volumes).toContain('postgres-data:/var/lib/postgresql/data');
  });
  it('previews image, port, storage and dependency relationships without inventing runtime health', () => {
    const graph = composeTopology([{ name: 'api', image: 'app:v1', build: false, ports: ['8080:80'], volumes: ['data:/data'], depends: ['db'], profiles: [] }, { name: 'db', image: 'postgres:16', build: false, ports: [], volumes: [], depends: [], profiles: [] }]);
    expect(graph.edges.map(e => e.label)).toEqual(['image', 'port', '/data', 'depends_on', 'image']);
    expect(graph.nodes.every(n => n.container === undefined)).toBe(true);
  });
  it('distinguishes bind mounts and shares a named volume across different container paths', () => {
    const base = { image: 'app', build: false, ports: [], volumes: [], depends: [], profiles: [] };
    const graph = composeTopology([{ ...base, name: 'a', mounts: [{ kind: 'volume', source: 'data', target: '/a' }, { kind: 'bind', source: '/host', target: '/files' }] }, { ...base, name: 'b', mounts: [{ kind: 'volume', source: 'data', target: '/b' }] }]);
    expect(graph.nodes.filter(n => n.kind === 'volume')).toHaveLength(1);
    expect(graph.nodes.filter(n => n.kind === 'bind')).toHaveLength(1);
    expect(graph.edges.some(e => e.label === '/b')).toBe(true);
  });
});
