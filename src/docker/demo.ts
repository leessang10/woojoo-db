import type { Snapshot } from './model';
export const demoSnapshot: Snapshot = {
  context: 'demo', complete: true, warnings: [],
  images: [{ id: 'pg16', name: 'postgres:16', project: '', detail: '248 MB' }, { id: 'api1', name: 'woojoo-api:dev', project: '', detail: '180 MB' }],
  volumes: [{ id: 'woojoo_data', name: 'woojoo_data', project: 'woojoo', detail: '/var/lib/docker/volumes/woojoo_data/_data' }],
  networks: [{ id: 'net1', name: 'woojoo_default', project: 'woojoo', detail: 'bridge' }],
  containers: [
    { id: 'db1', name: 'woojoo-db-1', imageId: 'pg16', image: 'postgres:16', project: 'woojoo', service: 'db', state: 'running', health: 'healthy', exitCode: 0, oom: false, error: '', finishedAt: '', restartCount: 0, healthOutput: 'accepting connections', networkMode: 'woojoo_default', ports: [{ privatePort: '5432/tcp', hostIp: '127.0.0.1', hostPort: '15432' }], mounts: [{ kind: 'volume', name: 'woojoo_data', source: '/var/lib/docker/volumes/woojoo_data/_data', target: '/var/lib/postgresql/data', rw: true }], networks: [{ id: 'net1', name: 'woojoo_default', ip: '172.18.0.2' }] },
    { id: 'api2', name: 'woojoo-api-1', imageId: 'api1', image: 'woojoo-api:dev', project: 'woojoo', service: 'api', state: 'running', health: '', exitCode: 0, oom: false, error: '', finishedAt: '', restartCount: 0, healthOutput: '', networkMode: 'woojoo_default', ports: [{ privatePort: '8080/tcp', hostIp: '0.0.0.0', hostPort: '8080' }], mounts: [{ kind: 'bind', name: '', source: 'C:\\projects\\woojoo\\uploads', target: '/app/uploads', rw: true }], networks: [{ id: 'net1', name: 'woojoo_default', ip: '172.18.0.3' }] },
  ],
};
