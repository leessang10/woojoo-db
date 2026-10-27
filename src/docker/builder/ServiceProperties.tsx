import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { desktop } from "../../api";
import { record } from "./document";
import { templateFor, redisSettings } from "./catalog";
import { pickPath } from "./api";
import type { Patch, ProjectView, ServiceView } from "./types";
import type { Snapshot } from "../model";

function Edit({
  value,
  onCommit,
  ...props
}: { value: string; onCommit: (value: string) => void } & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange"
>) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      {...props}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
export function ServiceProperties({
  service: s,
  view,
  language,
  onPatch,
  onRename,
  onConnect,
  onRemove,
  onClose,
}: {
  service: ServiceView;
  view: ProjectView;
  language: string;
  onPatch: (patches: Patch[]) => void;
  onRename: (name: string) => void;
  onConnect: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const tr = (ko: string, en: string) => (language === "ko" ? ko : en);
  const [show, setShow] = useState(false),
    [envKey, setEnvKey] = useState(""),
    [envValue, setEnvValue] = useState("");
  const patch = (field: string, value: unknown) =>
    onPatch([{ path: ["services", s.key, field], value }]);
  const mounts = (values: unknown[]) =>
    onPatch([
      { path: ["services", s.key, "volumes"], value: values },
      ...(s.raw.tmpfs
        ? [{ path: ["services", s.key, "tmpfs"], remove: true }]
        : []),
    ]);
  const template = templateFor(s.image);
  return (
    <section
      className="builder-properties"
      aria-label={tr("컴포넌트 설정", "Component settings")}
    >
      <header>
        <h2>{s.key}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {tr("닫기", "Close")}
        </Button>
      </header>
      {!s.editable && <p className="builder-warning">{s.lockReason}</p>}
      <fieldset disabled={!s.editable} className="builder-fields">
        <label>
          {tr("서비스 이름", "Service name")}
          <Edit value={s.key} onCommit={onRename} />
        </label>
        <label>
          {tr("이미지", "Image")}
          <Edit
            value={s.image}
            onCommit={(v) => patch("image", v)}
            placeholder={s.build ? "Dockerfile" : "repository:tag"}
          />
        </label>
        {template && (
          <small>
            {tr("템플릿 제안", "Template suggestion")} · {template.title} ·{" "}
            {template.checked}
          </small>
        )}
        {template?.id === "redis" && (
          <div className="builder-item">
            <label className="builder-check">
              <input
                type="checkbox"
                checked={!!s.environment.REDIS_PASSWORD}
                onChange={(e) =>
                  onPatch(
                    redisSettings(
                      s.key,
                      e.target.checked,
                      !String(JSON.stringify(s.command)).includes("no"),
                    ),
                  )
                }
              />
              {tr("비밀번호 인증 사용", "Use password authentication")}
            </label>
            <label className="builder-check">
              <input
                type="checkbox"
                checked={!String(JSON.stringify(s.command)).includes("no")}
                onChange={(e) =>
                  onPatch(
                    redisSettings(
                      s.key,
                      !!s.environment.REDIS_PASSWORD,
                      e.target.checked,
                    ),
                  )
                }
              />
              {tr("AOF로 데이터 보관", "Persist data with AOF")}
            </label>
            <small>
              {tr(
                "템플릿 명령과 준비 검사를 함께 변경합니다. 비밀번호는 프로젝트 변수에서 설정하세요.",
                "Updates template command and healthcheck together. Set the password in project variables.",
              )}
            </small>
          </div>
        )}
        <Button
          variant="outline"
          onClick={onConnect}
          disabled={view.services.length < 2}
        >
          {tr("연결 추가", "Add connection")}
        </Button>
        <details open>
          <summary>
            {tr("환경 변수", "Environment variables")}{" "}
            <small>{Object.keys(s.environment).length}</small>
          </summary>
          <div className="builder-fields">
            {s.envFiles.length > 0 && (
              <p className="builder-warning">
                env_file: {s.envFiles.join(", ")} ·{" "}
                {tr(
                  "아래 값이 우선 적용됩니다.",
                  "Explicit values below take precedence.",
                )}
              </p>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShow(!show)}>
              {show
                ? tr("값 숨기기", "Hide values")
                : tr("값 보기", "Reveal values")}
            </Button>
            {Object.entries(s.environment).map(([key, value]) => (
              <div className="builder-env-row" key={key}>
                <code title={key}>{key}</code>
                <Edit
                  type={show ? "text" : "password"}
                  aria-label={`${key} ${tr("환경 변수", "environment")}`}
                  value={value ?? ""}
                  onCommit={(v) =>
                    onPatch([
                      {
                        path: ["services", s.key, "environment", key],
                        value: v,
                      },
                    ])
                  }
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${key} ${tr("삭제", "Remove")}`}
                  onClick={() =>
                    onPatch([
                      {
                        path: ["services", s.key, "environment", key],
                        remove: true,
                      },
                    ])
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <div className="builder-env-row">
              <Input
                aria-label={tr("새 환경 변수 이름", "New variable name")}
                placeholder="KEY"
                value={envKey}
                onChange={(e) => setEnvKey(e.target.value)}
              />
              <Input
                aria-label={tr("새 환경 변수 값", "New variable value")}
                type={show ? "text" : "password"}
                placeholder={tr("값 또는 ${변수}", "Value or ${VARIABLE}")}
                value={envValue}
                onChange={(e) => setEnvValue(e.target.value)}
              />
              <Button
                size="sm"
                disabled={
                  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey) ||
                  envKey in s.environment
                }
                onClick={() => {
                  onPatch([
                    {
                      path: ["services", s.key, "environment", envKey],
                      value: envValue,
                    },
                  ]);
                  setEnvKey("");
                  setEnvValue("");
                }}
              >
                +
              </Button>
            </div>
            <small>
              {tr(
                "직접 수정한 값은 연결 제안이 자동으로 덮어쓰지 않습니다. 비밀값은 자동 복원에 저장되지 않습니다.",
                "Manual values are preserved. Unclassified values are excluded from automatic restoration.",
              )}
            </small>
          </div>
        </details>
        <details open>
          <summary>{tr("네트워크", "Networks")}</summary>
          <div className="builder-fields">
            {view.networks.map((n) => (
              <label className="builder-check" key={n.key}>
                <input
                  type="checkbox"
                  checked={s.networks.includes(n.key)}
                  onChange={(e) => {
                    const networks =
                      Array.isArray(s.raw.networks) || !s.raw.networks
                        ? Object.fromEntries(s.networks.map((k) => [k, {}]))
                        : { ...record(s.raw.networks) };
                    if (e.target.checked) networks[n.key] = {};
                    else delete networks[n.key];
                    patch("networks", networks);
                  }}
                />
                {n.key} {n.external && tr("· 외부에서 관리", "· external")}
              </label>
            ))}
          </div>
        </details>
        <details open>
          <summary>{tr("포트와 공개 범위", "Ports and exposure")}</summary>
          <div className="builder-fields">
            {s.ports.map((p, i) => {
              if (p.sourceOnly)
                return (
                  <div className="builder-item" key={i}>
                    <code>
                      {typeof p.raw === "string"
                        ? p.raw
                        : JSON.stringify(p.raw)}
                    </code>
                    <small>
                      {tr(
                        "범위·표현식은 원문에서 수정하세요. Compose 검사에서 검증합니다.",
                        "Edit ranges and expressions in source; Compose validates them.",
                      )}
                    </small>
                  </div>
                );
              const update = (field: string, value: unknown) =>
                patch(
                  "ports",
                  s.ports.map((x, j) =>
                    i === j
                      ? {
                          ...(typeof x.raw === "object"
                            ? record(x.raw)
                            : {
                                target: x.target,
                                published: x.published,
                                host_ip: x.hostIp,
                                protocol: x.protocol,
                              }),
                          [field]: value,
                        }
                      : x.raw,
                  ),
                );
              return (
                <div className="builder-item" key={i}>
                  <div className="builder-two">
                    <label>
                      {tr("컨테이너 포트", "Container port")}
                      <Edit
                        value={String(p.target)}
                        onCommit={(v) => update("target", Number(v))}
                      />
                    </label>
                    <label>
                      {tr("호스트 공개 포트", "Published port")}
                      <Edit
                        value={p.published ?? ""}
                        onCommit={(v) => update("published", v || undefined)}
                      />
                    </label>
                  </div>
                  <div className="builder-two">
                    <label>
                      {tr("호스트 바인딩 주소", "Host bind address")}
                      <Edit
                        value={p.hostIp ?? "0.0.0.0"}
                        onCommit={(v) => update("host_ip", v)}
                      />
                    </label>
                    <label>
                      {tr("프로토콜", "Protocol")}
                      <NativeSelect
                        value={p.protocol}
                        onChange={(e) => update("protocol", e.target.value)}
                      >
                        <option>tcp</option>
                        <option>udp</option>
                      </NativeSelect>
                    </label>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch(
                        "ports",
                        s.ports.filter((_, j) => i !== j).map((x) => x.raw),
                      )
                    }
                  >
                    {tr("공개 제거", "Remove publishing")}
                  </Button>
                </div>
              );
            })}
            <label>
              {tr(
                "컨테이너 내부 포트 (쉼표 구분)",
                "Internal container ports (comma separated)",
              )}
              <Edit
                value={
                  Array.isArray(s.raw.expose) ? s.raw.expose.join(", ") : ""
                }
                onCommit={(v) =>
                  patch(
                    "expose",
                    v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <small>
              {tr(
                "앱이 실제로 수신하는 포트를 지정하세요. 이 설정은 호스트에 공개하거나 앱의 수신 포트를 바꾸지 않습니다.",
                "Specify ports the app listens on. This neither publishes them nor changes the app listener.",
              )}
            </small>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                patch("ports", [
                  ...s.ports.map((p) => p.raw),
                  {
                    target: template?.port ?? 3000,
                    published: String(template?.port ?? 3000),
                    host_ip: "127.0.0.1",
                    protocol: "tcp",
                  },
                ])
              }
            >
              {tr("Docker 호스트에 포트 공개", "Publish on Docker host")}
            </Button>
            <small>
              {tr(
                "서비스끼리 접속할 때는 서비스 이름과 내부 포트를 사용합니다.",
                "Containers use service names and internal ports. A remote host is not your PC.",
              )}
            </small>
          </div>
        </details>
        <details open>
          <summary>{tr("저장소 마운트", "Storage mounts")}</summary>
          <div className="builder-fields">
            {s.mounts.map((m, i) => {
              const update = (field: string, value: unknown) =>
                mounts(
                  s.mounts.map((x, j) =>
                    i === j
                      ? {
                          ...(typeof x.raw === "object"
                            ? record(x.raw)
                            : {
                                type: x.type,
                                source: x.source || undefined,
                                target: x.target,
                                read_only: x.readOnly,
                              }),
                          [field]: value,
                          ...(field === "type" && value === "tmpfs"
                            ? { source: undefined }
                            : {}),
                        }
                      : typeof x.raw === "object"
                        ? x.raw
                        : {
                            type: x.type,
                            source: x.source || undefined,
                            target: x.target,
                            read_only: x.readOnly,
                          },
                  ),
                );
              return (
                <div className="builder-item" key={i}>
                  <label>
                    {tr("종류", "Type")}
                    <NativeSelect
                      value={m.type}
                      onChange={(e) => update("type", e.target.value)}
                    >
                      <option value="volume">Docker volume</option>
                      <option value="bind">
                        {tr("호스트 폴더", "Host folder")}
                      </option>
                      <option value="tmpfs">
                        {tr("임시 메모리", "Temporary memory")}
                      </option>
                    </NativeSelect>
                  </label>
                  {m.type !== "tmpfs" && (
                    <label>
                      {tr("원본", "Source")}
                      {m.type === "volume" ? (
                        <NativeSelect
                          value={m.source}
                          onChange={(e) => update("source", e.target.value)}
                        >
                          <option value="">
                            {tr("익명 볼륨", "Anonymous volume")}
                          </option>
                          {view.volumes.map((v) => (
                            <option key={v.key} value={v.key}>
                              {v.key}
                              {v.external ? " · external" : ""}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Edit
                          value={m.source}
                          onCommit={(v) => update("source", v)}
                        />
                      )}
                    </label>
                  )}
                  <label>
                    {tr("컨테이너 경로", "Container path")}
                    <Edit
                      value={m.target}
                      onCommit={(v) => update("target", v)}
                    />
                  </label>
                  <label className="builder-check">
                    <input
                      type="checkbox"
                      checked={m.readOnly}
                      onChange={(e) => update("read_only", e.target.checked)}
                    />
                    {tr("읽기 전용", "Read only")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      mounts(
                        s.mounts
                          .filter((_, j) => i !== j)
                          .map((x) =>
                            typeof x.raw === "object"
                              ? x.raw
                              : {
                                  type: x.type,
                                  source: x.source || undefined,
                                  target: x.target,
                                  read_only: x.readOnly,
                                },
                          ),
                      );
                    }}
                  >
                    {tr("마운트 제거 · 데이터 유지", "Unmount · keep data")}
                  </Button>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch("volumes", [
                  ...(Array.isArray(s.raw.volumes) ? s.raw.volumes : []),
                  {
                    type: "volume",
                    source: view.volumes[0]?.key,
                    target: "/data",
                  },
                ])
              }
            >
              {tr("저장소 연결", "Attach storage")}
            </Button>
            <small>
              {tr(
                "기존 DB 볼륨의 계정은 환경 변수 수정만으로 변경되지 않습니다.",
                "Changing environment variables does not change accounts inside an existing database volume.",
              )}
            </small>
          </div>
        </details>
        <details>
          <summary>
            {tr("준비 검사와 시작 조건", "Readiness and startup")}
          </summary>
          <div className="builder-fields">
            <label>
              {tr("준비 검사 명령", "Healthcheck command")}
              <Edit
                value={
                  Array.isArray(s.healthcheck?.test)
                    ? s.healthcheck!.test.slice(1).join(" ")
                    : ""
                }
                onCommit={(v) =>
                  v
                    ? patch("healthcheck", {
                        ...s.healthcheck,
                        test: ["CMD-SHELL", v],
                        interval: s.healthcheck?.interval ?? "10s",
                        timeout: s.healthcheck?.timeout ?? "5s",
                        retries: s.healthcheck?.retries ?? 5,
                      })
                    : onPatch([
                        {
                          path: ["services", s.key, "healthcheck"],
                          remove: true,
                        },
                      ])
                }
              />
            </label>
            {s.healthcheck && (
              <div className="builder-two">
                {["interval", "timeout", "start_period", "retries"].map((k) => (
                  <label key={k}>
                    {k}
                    <Edit
                      value={String(s.healthcheck?.[k] ?? "")}
                      onCommit={(v) =>
                        onPatch([
                          {
                            path: ["services", s.key, "healthcheck", k],
                            value: k === "retries" ? Number(v) : v,
                          },
                        ])
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            {view.services
              .filter((x) => x.key !== s.key)
              .map((other) => (
                <label key={other.key}>
                  {other.key}
                  <NativeSelect
                    value={s.depends[other.key]?.condition ?? ""}
                    onChange={(e) =>
                      onPatch([
                        e.target.value
                          ? {
                              path: [
                                "services",
                                s.key,
                                "depends_on",
                                other.key,
                              ],
                              value: {
                                ...s.depends[other.key],
                                condition: e.target.value,
                              },
                            }
                          : {
                              path: [
                                "services",
                                s.key,
                                "depends_on",
                                other.key,
                              ],
                              remove: true,
                            },
                      ])
                    }
                  >
                    <option value="">{tr("대기 안 함", "No wait")}</option>
                    <option value="service_started">
                      {tr("시작 후", "After started")}
                    </option>
                    <option
                      value="service_healthy"
                      disabled={!other.healthcheck}
                    >
                      {tr("준비 검사 통과 후", "After healthy")}
                    </option>
                    <option value="service_completed_successfully">
                      {tr("성공 종료 후", "After successful completion")}
                    </option>
                  </NativeSelect>
                </label>
              ))}
            <label>
              {tr("자체 재시작 정책", "Own restart policy")}
              <NativeSelect
                value={s.restart}
                onChange={(e) => patch("restart", e.target.value)}
              >
                {["no", "unless-stopped", "always", "on-failure"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </NativeSelect>
            </label>
          </div>
        </details>
        {s.build && (
          <details open>
            <summary>{tr("빌드 설정", "Build configuration")}</summary>
            <div className="builder-fields">
              {["context", "dockerfile"].map((k) => (
                <label key={k}>
                  {k}
                  <Edit
                    value={String(
                      s.build?.[k] ?? (k === "dockerfile" ? "Dockerfile" : "."),
                    )}
                    onCommit={(v) =>
                      onPatch([
                        { path: ["services", s.key, "build", k], value: v },
                      ])
                    }
                  />
                </label>
              ))}
              {Object.entries(record(s.build.args)).map(([key, value]) => (
                <label key={key}>
                  ARG {key}
                  <Edit
                    type={show ? "text" : "password"}
                    value={String(value ?? "")}
                    onCommit={(v) =>
                      onPatch([
                        {
                          path: ["services", s.key, "build", "args", key],
                          value: v,
                        },
                      ])
                    }
                  />
                </label>
              ))}
              <small>
                {tr(
                  "ARG 사용 여부와 소스 변경에 따른 재빌드는 Dockerfile에서 확인하세요.",
                  "Verify ARG usage in the Dockerfile. Source changes affect rebuilds.",
                )}
              </small>
            </div>
          </details>
        )}
        <details>
          <summary>{tr("고급 설정", "Advanced")}</summary>
          <div className="builder-fields">
            <label>
              {tr("명령", "Command")}
              <Edit
                value={
                  typeof s.command === "string"
                    ? s.command
                    : Array.isArray(s.command)
                      ? s.command.join(" ")
                      : ""
                }
                onCommit={(v) => patch("command", v)}
              />
            </label>
            <label>
              profiles
              <Edit
                value={s.profiles.join(", ")}
                onCommit={(v) =>
                  patch(
                    "profiles",
                    v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              env_file
              <Edit
                value={s.envFiles.join(", ")}
                onCommit={(v) =>
                  patch(
                    "env_file",
                    v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </div>
        </details>
        <Button variant="outline" onClick={onRemove}>
          {tr("컴포넌트 제거", "Remove component")}
        </Button>
      </fieldset>
    </section>
  );
}

export function ResourceProperties({
  kind,
  view,
  snapshot,
  language,
  onPatch,
  onClose,
}: {
  kind: "networks" | "volumes";
  view: ProjectView;
  snapshot: Snapshot | null;
  language: string;
  onPatch: (p: Patch[]) => void;
  onClose: () => void;
}) {
  const tr = (ko: string, en: string) => (language === "ko" ? ko : en);
  const [name, setName] = useState(
      kind === "networks" ? "backend" : "shared-data",
    ),
    [external, setExternal] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="builder-properties builder-fields">
      <header>
        <h2>
          {kind === "networks"
            ? tr("네트워크", "Networks")
            : tr("저장소", "Storage")}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {tr("닫기", "Close")}
        </Button>
      </header>
      {view[kind].map((r) => (
        <article className="builder-item" key={r.key}>
          <strong>{r.key}</strong>
          <small>
            {r.external
              ? `${tr("외부에서 관리", "Externally managed")} · ${r.name ?? r.key}`
              : tr("프로젝트에서 관리", "Project managed")}
          </small>
          {view.services
            .filter((s) =>
              kind === "networks"
                ? s.networks.includes(r.key)
                : s.mounts.some((m) => m.source === r.key),
            )
            .map((s) => (
              <p key={s.key}>
                {s.key}
                {kind === "volumes" &&
                  s.mounts
                    .filter((m) => m.source === r.key)
                    .map((m) => ` → ${m.target} · ${m.readOnly ? "RO" : "RW"}`)
                    .join(", ")}
              </p>
            ))}
          {!r.external && kind === "networks" && (
            <label className="builder-check">
              <input
                type="checkbox"
                checked={r.internal ?? false}
                onChange={(e) =>
                  onPatch([
                    {
                      path: [kind, r.key, "internal"],
                      value: e.target.checked,
                    },
                  ])
                }
              />
              {tr("내부 전용 네트워크", "Internal network")}
            </label>
          )}
        </article>
      ))}
      <h3>{tr("새 자원", "New resource")}</h3>
      <label>
        {tr("구성 이름", "Configuration name")}
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {tr("관리 방식", "Ownership")}
        <NativeSelect
          value={external}
          onChange={(e) => setExternal(e.target.value)}
        >
          <option value="">
            {tr("프로젝트에서 생성", "Create for project")}
          </option>
          {snapshot?.[kind].map((r) => (
            <option value={r.name} key={r.id}>
              {r.name} · external
            </option>
          ))}
        </NativeSelect>
      </label>
      <Button
        disabled={
          !/^[\w.-]+$/.test(name) || view[kind].some((r) => r.key === name)
        }
        onClick={() =>
          onPatch([
            {
              path: [kind, name],
              value: external ? { external: true, name: external } : {},
            },
          ])
        }
      >
        {tr("초안에 추가", "Add to draft")}
      </Button>
      {kind === "volumes" && (
        <>
          <p>
            {tr(
              "볼륨을 만든 뒤 여러 컴포넌트의 마운트에서 같은 이름을 고르면 공유할 수 있습니다.",
              "Choose the same volume in multiple components to share it.",
            )}
          </p>
          <Button
            disabled={!desktop}
            variant="outline"
            onClick={() =>
              void pickPath()
                .then((p) => {
                  if (p)
                    setError(
                      `${tr("선택한 로컬 경로 (원격 Docker 호스트에는 자동 적용되지 않음)", "Local path (not automatically applied to remote hosts)")}: ${p}`,
                    );
                })
                .catch((e) => setError(String(e)))
            }
          >
            {tr("호스트 폴더 경로 찾기", "Find host folder path")}
          </Button>
        </>
      )}
      {error && <p>{error}</p>}
    </section>
  );
}
