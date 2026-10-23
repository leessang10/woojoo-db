// Ported from Orbit (github.com/leessang10/aws-gui): collects the inventory the infrastructure map draws.
export type RecordData = Record<string, any>;
export type Inventory = {
  account: string;
  profile: string;
  region: string;
  collectedAt: string;
  items: Record<string, RecordData[]>;
  details: Record<string, RecordData>;
  warnings: string[];
};
export type InfraNode = {
  id: string;
  kind: string;
  name: string;
  subtitle: string;
  parent?: string;
  raw: RecordData;
};
export type InfraEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
};
export type InfraGraph = {
  nodes: InfraNode[];
  edges: InfraEdge[];
  warnings: string[];
};
type Read = (
  kind: string,
  resource?: string,
  nextToken?: string,
) => Promise<RecordData>;
const lists: Record<string, string> = {
  vpcs: "Vpcs",
  subnets: "Subnets",
  instances: "Reservations",
  databases: "DBInstances",
  loadBalancers: "LoadBalancers",
  targetGroups: "TargetGroups",
  buckets: "Buckets",
};
export async function collectTopology(
  read: Read,
  context: Pick<Inventory, "account" | "profile" | "region">,
  active: () => boolean,
  progress: (value: string) => void,
  includeRelationships = true,
): Promise<Inventory> {
  const result: Inventory = {
    ...context,
    collectedAt: "",
    items: {},
    details: {},
    warnings: [],
  };
  const check = () => {
    if (!active()) throw new Error("Collection cancelled");
  };
  for (const [kind, key] of Object.entries(lists)) {
    check();
    progress(kind);
    const rows: RecordData[] = [];
    result.items[kind] = rows;
    const seen = new Set<string>();
    let token: string | undefined;
    try {
      for (let page = 0; page < 5; page++) {
        check();
        const data = await read(kind, undefined, token);
        check();
        const batch = Array.isArray(data[key]) ? data[key] : [];
        rows.push(
          ...(kind === "instances"
            ? batch.flatMap((r) => r.Instances ?? [])
            : batch),
        );
        token = data.NextToken;
        if (!token) break;
        if (seen.has(token)) {
          result.warnings.push(`${kind}: repeated pagination cursor`);
          break;
        }
        seen.add(token);
        if (page === 4)
          result.warnings.push(`${kind}: collection limited to 5 pages`);
      }
    } catch (error) {
      check();
      result.warnings.push(`${kind}: ${String(error)}`);
    }
  }
  result.collectedAt = new Date().toISOString();
  return includeRelationships
    ? hydrateTopology(result, read, active, progress)
    : result;
}
export async function hydrateTopology(
  inventory: Inventory,
  read: Read,
  active: () => boolean,
  progress: (value: string) => void,
): Promise<Inventory> {
  const result = {
    ...inventory,
    details: { ...inventory.details },
    warnings: [...inventory.warnings],
  };
  const context = result;
  const check = () => {
    if (!active()) throw new Error("Collection cancelled");
  };
  const jobs: [string, string][] = [
    ...result.items.targetGroups.map(
      (r) => ["targets", r.TargetGroupArn] as [string, string],
    ),
    ...result.items.loadBalancers.map(
      (r) => ["lbAttributes", r.LoadBalancerArn] as [string, string],
    ),
    ...result.items.buckets.map(
      (r) => ["bucketLocation", r.Name] as [string, string],
    ),
  ];
  if (jobs.length > 200)
    result.warnings.push("Relationship collection limited to 200 resources");
  // Two workers leave a CLI slot available for the rest of the app.
  const queue = jobs.slice(0, 200);
  async function worker() {
    while (queue.length) {
      check();
      const [kind, resource] = queue.shift()!;
      progress(`${kind}: ${resource}`);
      try {
        const data = await read(kind, resource);
        check();
        result.details[`${kind}:${resource}`] = data;
        if (
          kind === "bucketLocation" &&
          bucketRegion(data) === context.region
        ) {
          result.details[`bucketNotifications:${resource}`] = await read(
            "bucketNotifications",
            resource,
          );
          check();
        }
      } catch (error) {
        check();
        result.warnings.push(`${kind}/${resource}: ${String(error)}`);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  check();
  result.collectedAt = new Date().toISOString();
  return result;
}
export function bucketRegion(data: RecordData) {
  return data.LocationConstraint === "EU"
    ? "eu-west-1"
    : data.LocationConstraint || "us-east-1";
}
const name = (r: RecordData, fallback: string) =>
  r.Tags?.find((t: RecordData) => t.Key === "Name")?.Value || fallback;
export function buildTopology(inv: Inventory): InfraGraph {
  const nodes = new Map<string, InfraNode>();
  const omitted = new Set<string>();
  const edges: InfraEdge[] = [];
  const edgeIds = new Set<string>();
  const add = (
    id: string,
    kind: string,
    title: string,
    subtitle: string,
    raw: RecordData,
    parent?: string,
  ) => {
    if (!nodes.has(id) && nodes.size >= 1000) {
      omitted.add(id);
      return id;
    }
    if (!nodes.has(id))
      nodes.set(id, { id, kind, name: title, subtitle, raw, parent });
    return id;
  };
  const edge = (source: string, target: string, relation: string) => {
    const id = JSON.stringify([source, target, relation]);
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      edges.push({ id, source, target, relation });
    }
  };
  const rows = (key: string) => inv.items[key] ?? [];
  for (const r of rows("vpcs"))
    add(r.VpcId, "vpc", name(r, r.VpcId), r.CidrBlock ?? "", r);
  for (const r of rows("subnets"))
    add(
      r.SubnetId,
      "subnet",
      name(r, r.SubnetId),
      `${r.AvailabilityZone} · ${r.CidrBlock}`,
      r,
      r.VpcId,
    );
  for (const r of rows("instances"))
    add(
      r.InstanceId,
      "ec2",
      name(r, r.InstanceId),
      `${r.InstanceType} · ${r.State?.Name ?? ""}`,
      r,
      r.SubnetId || r.VpcId,
    );
  for (const r of rows("databases"))
    add(
      r.DBInstanceArn || `rds:${r.DBInstanceIdentifier}`,
      "rds",
      r.DBInstanceIdentifier,
      `${r.Engine} · ${r.DBInstanceClass} · ${r.DBInstanceStatus}`,
      r,
      r.DBSubnetGroup?.VpcId,
    );
  for (const r of rows("loadBalancers"))
    add(
      r.LoadBalancerArn,
      "elb",
      r.LoadBalancerName,
      `${r.Type} · ${r.Scheme}`,
      r,
      r.VpcId,
    );
  for (const r of rows("targetGroups")) {
    add(
      r.TargetGroupArn,
      "target",
      r.TargetGroupName,
      `${r.Protocol}:${r.Port} · ${r.TargetType}`,
      r,
      r.VpcId,
    );
    for (const lb of r.LoadBalancerArns ?? []) {
      if (!nodes.has(lb))
        add(
          lb,
          "elb",
          lb.split("/").slice(-2).join("/"),
          "Referenced",
          { arn: lb },
          r.VpcId,
        );
      edge(lb, r.TargetGroupArn, "associated");
    }
    for (const health of inv.details[`targets:${r.TargetGroupArn}`]
      ?.TargetHealthDescriptions ?? []) {
      const t = health.Target;
      let target = t.Id;
      if (r.TargetType === "ip") {
        // An IP is only resolved to an instance in this target group's VPC.
        const matches = rows("instances").filter(
          (i) =>
            i.VpcId === r.VpcId &&
            (i.PrivateIpAddress === t.Id ||
              i.NetworkInterfaces?.some((n: RecordData) =>
                n.PrivateIpAddresses?.some(
                  (p: RecordData) => p.PrivateIpAddress === t.Id,
                ),
              )),
        );
        target =
          matches.length === 1
            ? matches[0].InstanceId
            : `ip:${r.TargetGroupArn}:${t.Id}`;
      }
      if (!nodes.has(target))
        add(
          target,
          r.TargetType === "ip" ? "ip" : "targetResource",
          t.Id,
          r.TargetType,
          t,
        );
      edge(
        r.TargetGroupArn,
        target,
        `${t.Port ?? ""} · ${health.TargetHealth?.State ?? "unknown"}`,
      );
    }
  }
  for (const r of rows("buckets")) {
    const loc = inv.details[`bucketLocation:${r.Name}`];
    if (loc && bucketRegion(loc) !== inv.region) continue;
    const id = `s3:${r.Name}`;
    add(id, "s3", r.Name, loc ? bucketRegion(loc) : "Region unverified", r);
    const notification = inv.details[`bucketNotifications:${r.Name}`] ?? {};
    for (const [field, arnField, kind] of [
      ["LambdaFunctionConfigurations", "LambdaFunctionArn", "lambda"],
      ["QueueConfigurations", "QueueArn", "sqs"],
      ["TopicConfigurations", "TopicArn", "sns"],
    ])
      for (const n of notification[field] ?? []) {
        const arn = n[arnField];
        if (!arn) continue;
        add(arn, kind, arn.split(":").pop()!, "Notification destination", {
          arn,
        });
        edge(id, arn, (n.Events ?? []).join(", "));
      }
    if (notification.EventBridgeConfiguration) {
      const bus = `eventbridge:${inv.region}`;
      add(bus, "events", "EventBridge", "Default event bus", {});
      edge(id, bus, "events");
    }
  }
  for (const r of rows("loadBalancers")) {
    const attrs = Object.fromEntries(
      (inv.details[`lbAttributes:${r.LoadBalancerArn}`]?.Attributes ?? []).map(
        (a: RecordData) => [a.Key, a.Value],
      ),
    );
    if (
      attrs["access_logs.s3.enabled"] === "true" &&
      attrs["access_logs.s3.bucket"]
    ) {
      const bucket = attrs["access_logs.s3.bucket"];
      add(`s3:${bucket}`, "s3", bucket, "Log destination", { Name: bucket });
      edge(r.LoadBalancerArn, `s3:${bucket}`, "access logs");
    }
  }
  // Missing permission must not produce a false containment relationship.
  for (const n of nodes.values())
    if (n.parent && !nodes.has(n.parent)) n.parent = undefined;
  return {
    nodes: [...nodes.values()],
    edges: edges.filter((e) => nodes.has(e.source) && nodes.has(e.target)),
    warnings: omitted.size
      ? [`Diagram limited to 1000 nodes; ${omitted.size} nodes omitted`]
      : [],
  };
}
