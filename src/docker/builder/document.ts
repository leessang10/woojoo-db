import { isAlias, isMap, isSeq, isScalar, parseDocument, visit } from "yaml";
import type {
  DraftFrame,
  Mount,
  Patch,
  Port,
  ProjectDraft,
  ProjectView,
  Resource,
  ServiceView,
} from "./types";

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function sharedNode(node: unknown): boolean {
  let shared = false;
  if (node)
    visit(node as Parameters<typeof visit>[0], (_k, n) => {
      if (
        isAlias(n) ||
        (n && typeof n === "object" && "anchor" in n && n.anchor) ||
        (isMap(n) && n.items.some((p) => String(p.key) === "<<"))
      )
        shared = true;
    });
  return shared;
}
export function createProject(
  source = "services: {}\nnetworks:\n  default: {}\n",
): ProjectDraft {
  return {
    id: uid(),
    name: "my-project",
    context: "",
    source,
    revision: 0,
    files: [],
    profiles: [],
    connections: [],
    positions: {},
    past: [],
    future: [],
    needsInput: false,
  };
}
export function environment(value: unknown): Record<string, string | null> {
  if (Array.isArray(value))
    return Object.fromEntries(
      value.map((v) => {
        const s = String(v),
          i = s.indexOf("=");
        return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)];
      }),
    );
  return Object.fromEntries(
    Object.entries(record(value)).map(([k, v]) => [
      k,
      v == null ? null : String(v),
    ]),
  );
}
function port(value: unknown): Port {
  if (typeof value === "object") {
    const r = record(value);
    return {
      target: Number(r.target),
      published: r.published == null ? undefined : String(r.published),
      hostIp: typeof r.host_ip === "string" ? r.host_ip : undefined,
      protocol: String(r.protocol ?? "tcp"),
      raw: value,
    };
  }
  const [s, protocol = "tcp"] = String(value).split("/");
  const match = s.match(
    /^(?:(\[[^\]]+\]|[^:]+):)?(?:(\d+(?:-\d+)?):)?(\d+(?:-\d+)?)$/,
  );
  if (!match)
    return {
      target: NaN,
      protocol,
      raw: value,
      sourceOnly: String(value).includes("${"),
    };
  const parts = s.replace(/\[[^\]]+\]/, "IPV6").split(":");
  return {
    target: Number(match[3]),
    published: parts.length === 2 ? match[1] : match[2],
    hostIp: parts.length === 3 ? match[1]?.replace(/^\[|\]$/g, "") : undefined,
    protocol,
    raw: value,
    sourceOnly: match[3].includes("-"),
  };
}
function mount(value: unknown): Mount {
  if (typeof value === "object") {
    const r = record(value);
    return {
      type: String(r.type ?? "volume"),
      source: String(r.source ?? ""),
      target: String(r.target ?? ""),
      readOnly: r.read_only === true,
      raw: value,
    };
  }
  const s = String(value);
  const m = s.match(/^((?:[a-zA-Z]:[\\/])?[^:]*):([^:]+)(?::(.*))?$/);
  const source = m?.[1] ?? "",
    target = m?.[2] ?? s;
  return {
    type:
      !source || !/^[./~\\]|^[A-Za-z]:[\\/]/.test(source) ? "volume" : "bind",
    source,
    target,
    readOnly: (m?.[3] ?? "").split(",").includes("ro"),
    raw: value,
  };
}
function resources(value: unknown): Resource[] {
  return Object.entries(record(value)).map(([key, v]) => {
    const r = record(v);
    return {
      key,
      external: r.external === true || typeof r.external === "object",
      name: typeof r.name === "string" ? r.name : undefined,
      driver: typeof r.driver === "string" ? r.driver : undefined,
      internal: r.internal === true,
    };
  });
}
export function readProject(source: string): ProjectView {
  const doc = parseDocument(source, { merge: true, keepSourceTokens: true });
  const issues: ProjectView["issues"] = doc.errors.map((e) => ({
    code: "yaml",
    severity: "error",
    field: "source",
    message: e.message,
  }));
  let obj: Record<string, unknown> = {};
  try {
    obj = record(doc.toJS({ maxAliasCount: 100 }));
  } catch (e) {
    issues.push({ code: "yaml", severity: "error", message: String(e) });
  }
  const rootLocked = !!obj.include || !isMap(doc.contents);
  const services: ServiceView[] = Object.entries(record(obj.services)).map(
    ([key, value]) => {
      const raw = record(value);
      const node = doc.getIn(["services", key], true);
      const shared =
        sharedNode(node) ||
        isAlias(doc.get("services", true)) ||
        !!(doc.get("services", true) as { anchor?: string })?.anchor;
      const editable =
        !rootLocked &&
        !shared &&
        !raw.extends &&
        !raw.network_mode &&
        isMap(node);
      const deps = Array.isArray(raw.depends_on)
        ? Object.fromEntries(
            raw.depends_on.map((v) => [
              String(v),
              { condition: "service_started" },
            ]),
          )
        : Object.fromEntries(
            Object.entries(record(raw.depends_on)).map(([k, v]) => [
              k,
              {
                ...record(v),
                condition: record(v).condition ?? "service_started",
              },
            ]),
          );
      const envFiles = Array.isArray(raw.env_file)
        ? raw.env_file
        : raw.env_file
          ? [raw.env_file]
          : [];
      return {
        key,
        raw,
        image: String(raw.image ?? ""),
        build: raw.build
          ? typeof raw.build === "string"
            ? { context: raw.build }
            : record(raw.build)
          : undefined,
        environment: environment(raw.environment),
        envFiles: envFiles.map((v) =>
          typeof v === "string" ? v : String(record(v).path ?? ""),
        ),
        ports: (Array.isArray(raw.ports) ? raw.ports : []).map(port),
        networks: raw.network_mode
          ? []
          : Array.isArray(raw.networks)
            ? raw.networks.map(String)
            : raw.networks
              ? Object.keys(record(raw.networks))
              : ["default"],
        mounts: [
          ...(Array.isArray(raw.volumes) ? raw.volumes : []).map(mount),
          ...(Array.isArray(raw.tmpfs)
            ? raw.tmpfs
            : raw.tmpfs
              ? [raw.tmpfs]
              : []
          ).map((v) => ({
            type: "tmpfs",
            source: "",
            target: String(v),
            readOnly: false,
            raw: v,
          })),
        ],
        depends: deps as ServiceView["depends"],
        healthcheck: raw.healthcheck ? record(raw.healthcheck) : undefined,
        restart: String(raw.restart ?? "no"),
        command: raw.command,
        profiles: Array.isArray(raw.profiles) ? raw.profiles.map(String) : [],
        editable: !!editable,
        lockReason: editable
          ? undefined
          : "Shared aliases, include/extends or special network mode: edit source / 원문에서 수정",
      };
    },
  );
  const networks = resources(obj.networks);
  if (
    services.some((s) => s.networks.includes("default")) &&
    !networks.some((n) => n.key === "default")
  )
    networks.unshift({ key: "default", external: false });
  return {
    services,
    networks,
    volumes: resources(obj.volumes),
    issues,
    editable: !rootLocked && !doc.errors.length,
  };
}
export function frame(d: ProjectDraft): DraftFrame {
  return {
    source: d.source,
    connections: structuredClone(d.connections),
    files: structuredClone(d.files),
  };
}
export function changeProject(
  d: ProjectDraft,
  source: string,
  connections = d.connections,
): ProjectDraft {
  return {
    ...d,
    source,
    connections,
    revision: d.revision + 1,
    past: [...d.past.slice(-49), frame(d)],
    future: [],
  };
}
export function patchProject(
  draft: ProjectDraft,
  patches: Patch[],
  connections = draft.connections,
): ProjectDraft {
  if (draft.files.length > 1)
    throw new Error("Multiple source files: edit each source / 원문에서 수정");
  const doc = parseDocument(draft.source, {
    merge: true,
    keepSourceTokens: true,
  });
  if (doc.errors.length)
    throw new Error("Fix YAML errors in source / 원문 오류를 수정하세요");
  const view = readProject(draft.source);
  for (const p of patches) {
    const service =
      p.path[0] === "services"
        ? view.services.find((s) => s.key === p.path[1])
        : undefined;
    if (!view.editable || service?.editable === false)
      throw new Error(service?.lockReason ?? "Edit source / 원문에서 수정");
    for (let length = 1; length <= p.path.length; length++) {
      const n = doc.getIn(p.path.slice(0, length), true);
      if (
        isAlias(n) ||
        (n && typeof n === "object" && "anchor" in n && n.anchor)
      )
        throw new Error(
          "Shared definition: edit source / 공유 정의는 원문에서 수정",
        );
    }
    if (sharedNode(doc.getIn(p.path.slice(0, 2), true)))
      throw new Error(
        "Shared definition: edit source / 공유 정의는 원문에서 수정",
      );
    // Nested edits to list syntax env/depends/networks need a map, but retain untouched sibling nodes.
    if (p.path.length > 3 && p.path[0] === "services") {
      const parent = p.path.slice(0, 3),
        n = doc.getIn(parent, true);
      if (p.path[2] === "build" && isScalar(n) && typeof n.value === "string")
        doc.setIn(parent, doc.createNode({ context: n.value }));
      const args = doc.getIn(p.path.slice(0, 4), true);
      if (p.path[2] === "build" && p.path[3] === "args" && isSeq(args))
        doc.setIn(
          p.path.slice(0, 4),
          doc.createNode(environment(args.toJSON())),
        );
      if (isSeq(n)) {
        const field = p.path[2];
        if (field === "environment")
          doc.setIn(parent, doc.createNode(service?.environment ?? {}));
        if (field === "depends_on")
          doc.setIn(parent, doc.createNode(service?.depends ?? {}));
        if (field === "networks")
          doc.setIn(
            parent,
            doc.createNode(
              Object.fromEntries((service?.networks ?? []).map((k) => [k, {}])),
            ),
          );
      }
    }
    if (p.remove) doc.deleteIn(p.path);
    else doc.setIn(p.path, doc.createNode(p.value));
  }
  const tracked = structuredClone(connections);
  for (const connection of tracked)
    for (const mapping of connection.mappings) {
      const ref = mapping.reference;
      if (!ref) continue;
      const consumerPath = [
        "services",
        connection.consumer,
        ...(connection.injection === "build"
          ? ["build", "args"]
          : ["environment"]),
        mapping.key,
      ];
      const owned = connection.owned.find(
        (o) => JSON.stringify(o.path) === JSON.stringify(consumerPath),
      );
      if (!owned || doc.getIn(consumerPath) !== owned.value) {
        mapping.reference = undefined;
        continue;
      }
      let next: unknown;
      if (ref.field === "environment")
        next = doc.getIn(["services", ref.service, "environment", ref.key!]);
      else if (ref.field === "host") next = ref.service;
      else if (
        patches.some(
          (p) =>
            p.path[0] === "services" &&
            p.path[1] === ref.service &&
            ["ports", "expose"].includes(String(p.path[2])),
        )
      ) {
        const provider = readProject(doc.toString()).services.find(
          (s) => s.key === ref.service,
        );
        next =
          provider?.ports[0]?.target ??
          (provider?.raw.expose as unknown[])?.[0];
      }
      if (next !== undefined && String(next) !== String(owned.value)) {
        doc.setIn(consumerPath, String(next));
        mapping.value = String(next);
        owned.value = String(next);
      }
    }
  return changeProject(draft, doc.toString(), tracked);
}
export function undoProject(d: ProjectDraft): ProjectDraft {
  const last = d.past.at(-1);
  return last
    ? {
        ...d,
        ...last,
        revision: d.revision + 1,
        past: d.past.slice(0, -1),
        future: [frame(d), ...d.future],
      }
    : d;
}
export function redoProject(d: ProjectDraft): ProjectDraft {
  const next = d.future[0];
  return next
    ? {
        ...d,
        ...next,
        revision: d.revision + 1,
        past: [...d.past, frame(d)],
        future: d.future.slice(1),
      }
    : d;
}
