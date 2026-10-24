import { describe, expect, it } from 'vitest';
import { cells, mergeRows, tabKey } from './model';
import { matchesProduction } from '../settings';
import { layoutTopology } from './topology-layout';
import { buildTopology, collectTopology, type Inventory } from './topology-data';

describe('progressive topology collection', () => {
  it('publishes independent pages and relationship results before completion', async () => {
    const snapshots: Inventory[] = [];
    const result = await collectTopology(async (kind, _resource, token) => {
      if (kind === 'vpcs') return token ? { Vpcs: [{ VpcId: 'vpc-2' }] } : { Vpcs: [{ VpcId: 'vpc-1' }], NextToken: 'next' };
      if (kind === 'buckets') return { Buckets: [{ Name: 'assets' }] };
      if (kind === 'bucketLocation') return { LocationConstraint: 'ap-northeast-2' };
      if (kind === 'bucketNotifications') {
        expect(snapshots.at(-1)?.details['bucketLocation:assets']).toBeDefined();
        return { EventBridgeConfiguration: {} };
      }
      return {};
    }, { account: '', profile: 'p', region: 'ap-northeast-2' }, () => true, () => {}, true, snapshot => {
      snapshots.push(snapshot);
      expect(() => layoutTopology(buildTopology(snapshot), 'simple')).not.toThrow();
    });
    expect(snapshots[0].items.vpcs).toHaveLength(1);
    expect(snapshots[0].items.buckets).toBeUndefined();
    expect(snapshots[0].details).toEqual({});
    expect(result.items.vpcs).toHaveLength(2);
    expect(snapshots.at(-1)?.details['bucketNotifications:assets']).toEqual({ EventBridgeConfiguration: {} });
  });
});

describe('AWS model', () => {
  it('formats list cells and keys tabs by scope', () => {
    expect(cells('ec2', { InstanceId: 'i-1', Tags: [{ Key: 'Name', Value: 'web' }], State: { Name: 'running' } }, 'en').slice(0, 2)).toEqual(['web', 'running']);
    expect(tabKey({ kind: 'resources', profile: 'a', region: 'r', service: 'ec2' })).not.toEqual(tabKey({ kind: 'resources', profile: 'b', region: 'r', service: 'ec2' }));
    expect(matchesProduction('team-prod', 'prod, live')).toBe(true);
    expect(matchesProduction('LIVE_us', 'prod, live')).toBe(true);
    expect(matchesProduction('team-prod', '')).toBe(false);
    expect(matchesProduction('product-dev', 'prod')).toBe(false);
  });
  it('merges pages without duplicates', () => {
    expect(mergeRows([{ id: 1 }], [{ id: 1 }, { id: 2 }], row => String(row.id))).toHaveLength(2);
  });
});

describe('topology layout', () => {
  it('places groups before children and wraps children inside them', () => {
    const graph = buildTopology({ account: '', profile: 'p', region: 'r', collectedAt: '', warnings: [], details: {}, items: {
      vpcs: [{ VpcId: 'vpc-1' }], subnets: [{ SubnetId: 'subnet-1', VpcId: 'vpc-1' }],
      instances: [{ InstanceId: 'i-1', SubnetId: 'subnet-1' }, { InstanceId: 'i-2', SubnetId: 'subnet-1' }],
      databases: [], loadBalancers: [], targetGroups: [], buckets: [],
    } });
    const positions = layoutTopology(graph, 'simple');
    expect(positions.map(p => p.id).slice(0, 2)).toEqual(['vpc-1', 'subnet-1']);
    const subnet = positions.find(p => p.id === 'subnet-1')!;
    for (const id of ['i-1', 'i-2']) {
      const node = positions.find(p => p.id === id)!;
      expect(node.x).toBeGreaterThanOrEqual(0); expect(node.y).toBeGreaterThan(0);
      expect(node.x + node.width).toBeLessThanOrEqual(subnet.width); expect(node.y + node.height).toBeLessThanOrEqual(subnet.height);
    }
  });
});
