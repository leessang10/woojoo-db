import { stringify } from "yaml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readProject } from "./document";
import type { ProjectDraft, ServiceView } from "./types";
import type { Review } from "./api";

export function ReviewPanel({
  draft,
  review,
  language,
  busy,
  seconds,
  onSeconds,
  onSave,
  onRun,
}: {
  draft: ProjectDraft;
  review: Review;
  language: string;
  busy: boolean;
  seconds: number;
  onSeconds: (n: number) => void;
  onSave: () => void;
  onRun: () => void;
}) {
  const tr = (ko: string, en: string) => (language === "ko" ? ko : en);
  const before = review.baseline
    ? readProject(stringify(review.baseline))
    : null;
  const after = readProject(stringify(review.effective));
  const fields = (s: ServiceView | undefined) =>
    s
      ? [
          [
            tr("이미지 / 빌드", "Image / build"),
            s.image || (s.build ? String(s.build.context) : "—"),
          ],
          [
            tr("포트", "Ports"),
            s.ports
              .map((p) =>
                p.sourceOnly
                  ? String(p.raw)
                  : `${p.hostIp ?? "0.0.0.0"}:${p.published ?? "auto"} → ${p.target}/${p.protocol}`,
              )
              .join("\n") || "—",
          ],
          [
            tr("저장소", "Storage"),
            s.mounts
              .map(
                (m) =>
                  `${m.type}: ${m.source || "anonymous"} → ${m.target} (${m.readOnly ? "RO" : "RW"})`,
              )
              .join("\n") || "—",
          ],
          [tr("네트워크", "Networks"), s.networks.join(", ") || "—"],
          [
            tr("시작 조건", "Startup"),
            Object.entries(s.depends)
              .map(([key, value]) => `${key}: ${value.condition}`)
              .join("\n") || "—",
          ],
          [
            tr("환경 변수 키 (값 숨김)", "Environment keys (values hidden)"),
            Object.keys(s.environment).join(", ") || "—",
          ],
        ]
      : [];
  return (
    <section className="builder-review">
      <header>
        <h2>{tr("저장 및 실행 검토", "Review save and run")}</h2>
        <span>
          {draft.context} / {draft.name}
        </span>
      </header>
      <p>
        {tr(
          "선택한 모든 파일을 합친 유효 구성입니다. 이전 파일 비교는 현재 치환 환경을 사용하므로 실행 중인 컨테이너와 다를 수 있습니다. 실제 재생성과 준비 상태는 실행 후 확인합니다.",
          "This is the effective configuration of all selected files. The previous-file comparison uses current interpolation inputs and may differ from running containers. Verify recreation and readiness after execution.",
        )}
      </p>
      <div className="builder-review-grid">
        <div>
          <h3>{tr("파일 변경", "File changes")}</h3>
          {review.files.map((f) => (
            <p key={f.path}>
              <code>{f.path}</code> ·{" "}
              {f.changed
                ? tr("저장 예정", "Will save")
                : tr("변경 없음", "Unchanged")}
            </p>
          ))}
          {review.extraFiles.map((f) => (
            <p key={f.path}>
              <code>{f.path}</code> · {f.purpose}
            </p>
          ))}
          {!!review.extraFiles.length && (
            <p className="builder-warning">
              {tr(
                ".env는 평문입니다. .env.example에는 빈 키만, .gitignore에는 .env 제외 규칙을 추가합니다. 기존 파일 내용을 유지합니다.",
                ".env is plaintext. .env.example receives empty keys; .gitignore receives an exclusion. Existing content is retained.",
              )}
            </p>
          )}
          <p>
            {draft.rebuild
              ? tr(
                  "로컬 빌드: 실행 전에 다시 빌드",
                  "Local builds: rebuild before starting",
                )
              : tr(
                  "로컬 빌드: 이미지가 없을 때 빌드 · 기존 이미지는 재사용",
                  "Local builds: build missing images; reuse existing images",
                )}
          </p>
          <small>
            {tr(
              "빌드 폴더·마운트 파일의 내용은 고정되지 않습니다.",
              "Build-context and mounted-file contents are not frozen.",
            )}
          </small>
        </div>
        <div>
          <h3>{tr("서비스 영향", "Service impact")}</h3>
          {!before && (
            <p>
              {tr(
                "이전 유효 구성을 확인하지 못함",
                "Previous effective configuration unavailable",
              )}
            </p>
          )}
          {after.services.map((s) => {
            const old = before?.services.find((x) => x.key === s.key),
              previous = fields(old),
              changes = review.changedFields?.[s.key];
            return (
              <article className="builder-item" key={s.key}>
                <strong>
                  {s.key} ·{" "}
                  {!before
                    ? tr("현재 유효 구성", "Current effective configuration")
                    : !old
                      ? tr("새 서비스", "New service")
                      : changes?.length
                        ? tr("변경 · 재생성 가능", "Changed · may recreate")
                        : tr("구성 변경 없음", "Configuration unchanged")}
                </strong>
                {!!changes?.length && (
                  <small>
                    {tr("변경 필드", "Changed fields")}: {changes.join(", ")}
                  </small>
                )}
                <table className="builder-comparison">
                  <thead>
                    <tr>
                      <th>{tr("항목", "Field")}</th>
                      <th>{tr("이전", "Before")}</th>
                      <th>{tr("적용 예정", "After")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields(s).map(([label, value], i) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{before ? (previous[i]?.[1] ?? "—") : "?"}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            );
          })}
          {before?.services
            .filter((s) => !after.services.some((a) => a.key === s.key))
            .map((s) => (
              <p key={s.key}>
                {s.key} ·{" "}
                {tr(
                  "구성에서 제외됨 · 기존 컨테이너 자동 삭제 안 함",
                  "Removed from config · existing container retained",
                )}
              </p>
            ))}
        </div>
      </div>
      <p>
        {tr(
          "환경 변수·명령 값은 숨깁니다. 원문 탭에서 직접 확인할 수 있습니다. 볼륨과 orphan 컨테이너는 자동 삭제하지 않습니다.",
          "Environment and command values are masked; inspect source explicitly. Volumes and orphan containers are retained.",
        )}
      </p>
      <label>
        {tr("작업 제한 시간 (초)", "Operation timeout (seconds)")}
        <Input
          type="number"
          min={30}
          max={86400}
          value={seconds}
          onChange={(e) => onSeconds(Number(e.target.value))}
        />
      </label>
      <div className="builder-row">
        <Button variant="outline" disabled={busy} onClick={onSave}>
          {tr("파일만 저장", "Save files only")}
        </Button>
        <Button
          disabled={busy || seconds < 30 || seconds > 86400}
          onClick={onRun}
        >
          {tr("저장하고 실행", "Save and run")}
        </Button>
      </div>
    </section>
  );
}
