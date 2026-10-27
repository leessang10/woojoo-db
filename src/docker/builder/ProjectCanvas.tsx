import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, Database, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectDraft, ProjectView } from "./types";
import type { Snapshot } from "../model";
import { statusLabel } from "../model";
type ComponentNode = Node<
  {
    title: string;
    image: string;
    networks: string[];
    ports: string[];
    runtime: string;
    issueCount: number;
    language: string;
    kind: string;
  },
  "component"
>;
function Component({ data, selected }: NodeProps<ComponentNode>) {
  const tr = (ko: string, en: string) => (data.language === "ko" ? ko : en);
  return (
    <div
      className={`builder-node ${selected ? "selected" : ""}`}
      data-testid={`builder-service-${data.title}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="builder-node-title">
        {data.kind === "service" ? (
          <Box size={17} />
        ) : data.kind === "network" ? (
          <Network size={17} />
        ) : (
          <Database size={17} />
        )}
        <strong>{data.title}</strong>
        {data.issueCount > 0 && (
          <span className="builder-badge">! {data.issueCount}</span>
        )}
      </div>
      <code>{data.image}</code>
      <div className="builder-badges">
        {data.networks.map((n) => (
          <span key={n}>◈ {n}</span>
        ))}
      </div>
      {data.ports.map((p, i) => (
        <small key={i}>{p}</small>
      ))}
      <footer>
        {data.runtime || tr("미실행 · 초안", "Not running · draft")}
      </footer>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { component: Component };
interface Props {
  draft: ProjectDraft;
  view: ProjectView;
  snapshot: Snapshot | null;
  language: string;
  theme: string;
  selected: string;
  layer: string;
  filter: string;
  list: boolean;
  issues: Record<string, number>;
  onSelect: (id: string) => void;
  onConnect: (source: string, target: string) => void;
  onPosition: (key: string, position: { x: number; y: number }) => void;
}
export function ProjectCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
function Canvas({
  draft,
  view,
  snapshot,
  language,
  theme,
  selected,
  layer,
  filter,
  list,
  issues,
  onSelect,
  onConnect,
  onPosition,
}: Props) {
  const tr = (ko: string, en: string) => (language === "ko" ? ko : en);
  const initial = useMemo(() => {
    const nodes: ComponentNode[] = view.services.map((s, i) => ({
      id: s.key,
      type: "component",
      position: draft.positions[s.key] ?? {
        x: 50 + (i % 3) * 320,
        y: 50 + Math.floor(i / 3) * 240,
      },
      selected: selected === s.key,
      data: {
        title: s.key,
        image: s.image || `build: ${s.build?.context ?? "—"}`,
        networks: s.networks,
        ports: s.ports.map(
          (p) =>
            `${p.hostIp ?? "0.0.0.0"}:${p.published ?? "—"} → ${p.target}/${p.protocol}`,
        ),
        runtime:
          (snapshot?.context === draft.context
            ? snapshot.containers.filter(
                (c) => c.project === draft.name && c.service === s.key,
              )
            : []
          )
            ?.map((c) => statusLabel(c, language))
            .join(" · ") ?? "",
        issueCount: issues[s.key] ?? 0,
        language,
        kind: "service",
      },
    }));
    if (layer === "networks" || layer === "volumes")
      for (const [i, r] of view[layer].entries())
        nodes.push({
          id: `${layer}:${r.key}`,
          type: "component",
          position: draft.positions[`${layer}:${r.key}`] ?? {
            x: 50 + i * 320,
            y: 80 + Math.ceil(view.services.length / 3) * 240,
          },
          selected: selected === `${layer}:${r.key}`,
          data: {
            title: r.key,
            image: r.external
              ? tr("외부에서 관리", "External")
              : tr("프로젝트에서 관리", "Project managed"),
            networks: [],
            ports: [],
            runtime: " ",
            issueCount: 0,
            language,
            kind: layer === "networks" ? "network" : "volume",
          },
        });
    return nodes;
  }, [
    view,
    draft.positions,
    draft.context,
    draft.name,
    snapshot,
    language,
    selected,
    layer,
    issues,
  ]);
  const [nodes, setNodes, onNodesChange] =
    useNodesState<ComponentNode>(initial);
  useEffect(() => setNodes(initial), [initial, setNodes]);
  const edges: Edge[] =
    layer === "connections"
      ? draft.connections.map((c) => ({
          id: c.id,
          source: c.consumer,
          target: c.provider,
          label: `${tr("서비스 연결", "Service connection")} · ${c.origin === "browser" ? "browser" : c.endpoint}`,
          type: "smoothstep",
        }))
      : layer === "startup"
        ? view.services.flatMap((s) =>
            Object.entries(s.depends).map(([key, d]) => ({
              id: `${s.key}:${key}`,
              source: key,
              target: s.key,
              label: d.condition.replace("service_", ""),
              type: "smoothstep",
            })),
          )
        : layer === "networks"
          ? view.services.flatMap((s) =>
              s.networks.map((n) => ({
                id: `${s.key}:${n}`,
                source: s.key,
                target: `networks:${n}`,
                label: tr("참여", "Membership"),
                type: "smoothstep",
              })),
            )
          : view.services.flatMap((s) =>
              s.mounts
                .filter((m) => m.type === "volume" && m.source)
                .map((m, i) => ({
                  id: `${s.key}:${m.source}:${i}`,
                  source: s.key,
                  target: `volumes:${m.source}`,
                  label: `${m.target} · ${m.readOnly ? "RO" : "RW"}`,
                  type: "smoothstep",
                })),
            );
  const shown = nodes.filter(
      (n) =>
        !filter ||
        `${n.data.title} ${n.data.image} ${n.data.networks}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    ),
    ids = new Set(shown.map((n) => n.id));
  return (
    <div className="builder-canvas">
      {shown.length < nodes.length && (
        <div className="builder-filter-note">
          {nodes.length - shown.length} {tr("개 숨김", "hidden")}
        </div>
      )}
      {list ? (
        <div className="builder-component-list">
          {shown.map((n) => (
            <Button
              key={n.id}
              variant="outline"
              onClick={() => onSelect(n.id)}
              aria-pressed={selected === n.id}
            >
              <strong>{n.data.title}</strong>
              <code>{n.data.image}</code>
              <small>{n.data.networks.join(" · ")}</small>
              <small>{n.data.runtime || tr("미실행", "Not running")}</small>
            </Button>
          ))}
        </div>
      ) : (
        <ReactFlow
          nodes={shown}
          edges={edges.filter((e) => ids.has(e.source) && ids.has(e.target))}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onSelect(n.id)}
          onNodeDragStop={(_, n) => onPosition(n.id, n.position)}
          onConnect={(c) => {
            if (
              c.source &&
              c.target &&
              !c.source.includes(":") &&
              !c.target.includes(":")
            )
              onConnect(c.source, c.target);
          }}
          onPaneClick={() => onSelect("")}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.8}
          colorMode={theme === "dark" ? "dark" : "light"}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  );
}
