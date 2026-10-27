import { test, expect, type Page } from "./fixtures";
async function setup(page: Page, scenario = "normal") {
  await page.addInitScript(
    ({ scenario }) => {
      const w = window as any;
      w.builderCalls = [];
      w.builderOps = [];
      const callbacks = new Map<number, any>();
      let callbackId = 0;
      Object.defineProperty(window, "isTauri", { value: true });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: (callback: any) => {
            callbacks.set(++callbackId, callback);
            return callbackId;
          },
          unregisterCallback: () => {},
          invoke: async (command: string, args: any) => {
            w.builderCalls.push({ command, args });
            if (command === "docker_contexts")
              return [
                { name: "local", endpoint: "npipe://docker", current: true },
                ...(scenario === "contexts"
                  ? [{ name: "other", endpoint: "ssh://test", current: false }]
                  : []),
              ];
            if (command === "docker_snapshot")
              return {
                context: args.context,
                containers: [],
                images: [],
                volumes: [],
                networks: [],
                warnings: [],
                complete: true,
              };
            // Native IPC returns a fresh deserialized value on every poll.
            if (command === "docker_builder_operations")
              return structuredClone(w.builderOps);
            if (command === "docker_builder_import") {
              if (scenario === "multi")
                return [
                  {
                    path: "C:/example/base.yml",
                    original:
                      "services: {api: {image: api:1, networks: [private]}}",
                    source:
                      "services: {api: {image: api:1, networks: [private]}}",
                  },
                  {
                    path: "C:/example/dev.yml",
                    original:
                      "services: {worker: {image: worker:2}}\nnetworks: {private: {}}",
                    source:
                      "services: {worker: {image: worker:2}}\nnetworks: {private: {}}",
                  },
                ];
              if (args.paths) {
                if (scenario === "reload") {
                  await new Promise((resolve) => {
                    w.finishReload = resolve;
                  });
                  return [
                    {
                      path: "C:/example/compose.yml",
                      source: "services: {old: {image: redis:7.4}}",
                      original: "services: {old: {image: redis:7.4}}",
                    },
                  ];
                }
                throw "File does not exist";
              }
              return [
                {
                  path: "C:/example/compose.yml",
                  original:
                    "# preserved\nx-custom: {mode: hello}\nservices:\n  redis:\n    image: redis:7.4\n",
                  source:
                    "# preserved\nx-custom: {mode: hello}\nservices:\n  redis:\n    image: redis:7.4\n",
                },
              ];
            }
            if (command === "docker_builder_destination")
              return "C:/example/compose.yml";
            if (command === "docker_builder_save") {
              if (scenario === "multi")
                await new Promise((resolve) => {
                  w.finishSave = resolve;
                });
              return w.reviewInput.files.map((f: any) => ({
                ...f,
                original: f.source,
              }));
            }
            if (command === "docker_builder_review") {
              w.reviewInput = structuredClone(args.input);
              if (scenario === "slow")
                await new Promise((resolve) => {
                  w.finishReview = resolve;
                });
              return {
                token: "review-token",
                effective:
                  scenario === "multi"
                    ? {
                        services: {
                          api: { image: "api:1", networks: { private: {} } },
                          worker: { image: "worker:2" },
                        },
                        networks: { private: {} },
                      }
                    : { services: { redis: { image: "redis:7.4" } } },
                files: args.input.files.map((f: any) => ({
                  path: f.path,
                  changed: true,
                })),
                extraFiles: [],
                fingerprint: "fp",
                checked: 1,
              };
            }
            if (command === "docker_builder_start") {
              w.builderOps = [
                {
                  id: "job-1",
                  context: "local",
                  project: args.project ?? "project-1",
                  state: "running",
                  started: 1,
                  lines: ["Pulling redis…"],
                },
              ];
              return w.builderOps[0];
            }
            if (command === "docker_builder_cancel") {
              w.builderOps[0].state = "unknown";
              return;
            }
            if (command === "compose_list") return [];
            if (command === "plugin:event|listen") {
              if (args.event === "close-requested")
                w.requestClose = () =>
                  callbacks.get(args.handler)?.({
                    event: "close-requested",
                    id: 1,
                    payload: null,
                  });
              return 1;
            }
          },
        },
      });
    },
    { scenario },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Docker", exact: true }).click();
}
test("imports without running and preserves unknown source through a GUI edit", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Compose 가져오기", exact: true })
    .click();
  await page.getByTestId("builder-service-redis").click();
  await page.getByLabel("이미지", { exact: true }).fill("redis:7.4-alpine");
  await page.getByLabel("이미지", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Compose 원문", exact: true }).click();
  await expect(page.getByLabel("Compose YAML")).toHaveValue(/# preserved/);
  await expect(page.getByLabel("Compose YAML")).toHaveValue(/x-custom/);
  expect(
    await page.evaluate(() =>
      (window as any).builderCalls.filter((c: any) =>
        /builder_start|compose_action/.test(c.command),
      ),
    ),
  ).toHaveLength(0);
});
test("invalidates a pending review when the draft changes", async ({
  page,
}) => {
  await setup(page, "slow");
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  await page
    .getByRole("button", { name: "구성 검사", exact: true })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).finishReview))
    .toBe(true);
  await page.getByLabel("프로젝트 이름").fill("changed-project");
  await page.evaluate(() => (window as any).finishReview());
  await expect(page.getByRole("alert")).toContainText("초안이 변경");
  await expect(
    page.getByRole("button", { name: "저장하고 실행", exact: true }),
  ).toHaveCount(0);
});
test("requires reviewed apply and retains unknown outcome after cancellation", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  await page.getByRole("button", { name: "실행 검토", exact: true }).click();
  await page
    .getByRole("button", { name: "저장하고 실행", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "CLI 작업 취소", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "CLI 작업 취소", exact: true })
    .click();
  await expect(
    page.getByText("결과 미확정 · 실제 상태 확인 필요", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).builderCalls.filter(
          (c: any) => c.command === "docker_builder_start",
        ).length,
    ),
  ).toBe(1);
});
test("closing during an operation can wait without cancelling the job", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  await page.getByRole("button", { name: "실행 검토", exact: true }).click();
  await page
    .getByRole("button", { name: "저장하고 실행", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "CLI 작업 취소", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).requestClose());
  await expect(page.getByRole("alertdialog")).toContainText("Docker CLI");
  await page
    .getByRole("button", { name: "작업 완료까지 기다리기", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).builderCalls.filter(
        (c: any) =>
          c.command === "close_window" || c.command === "docker_builder_cancel",
      ),
    ),
  ).toHaveLength(0);
});

test("does not apply a delayed original reload to another project", async ({
  page,
}) => {
  await setup(page, "reload");
  await page
    .getByRole("button", { name: "Compose 가져오기", exact: true })
    .click();
  await page.getByRole("button", { name: "Compose 원문", exact: true }).click();
  await page
    .getByRole("button", { name: "원본 다시 불러오기", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).finishReload))
    .toBe(true);
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  await page.evaluate(() => (window as any).finishReload());
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("builder-service-redis")).toBeVisible();
  await expect(page.getByLabel("프로젝트 이름")).toHaveValue("project-2");
});
test("invalidates a pending review when interpolation input changes", async ({
  page,
}) => {
  await setup(page, "slow");
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  await page.getByLabel("비밀번호 인증 사용").check();
  await page
    .getByRole("button", { name: "프로젝트 변수", exact: true })
    .click();
  await page.getByLabel("REDIS_PASSWORD", { exact: true }).fill("first");
  await page
    .getByRole("button", { name: "구성 검사", exact: true })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).finishReview))
    .toBe(true);
  await page
    .getByRole("button", { name: "프로젝트 변수", exact: true })
    .click();
  await page.getByLabel("REDIS_PASSWORD", { exact: true }).fill("second");
  await page.evaluate(() => (window as any).finishReview());
  await expect(page.getByRole("alert")).toContainText("초안이 변경");
  await expect(
    page.getByRole("button", { name: "저장하고 실행", exact: true }),
  ).toHaveCount(0);
});

test("rebinds an older draft to the selected context before review", async ({
  page,
}) => {
  await setup(page, "contexts");
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "새 프로젝트", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  }
  await page
    .getByRole("combobox", { name: "Docker 연결 대상", exact: true })
    .click();
  await page.getByRole("option", { name: "other", exact: true }).click();
  await page
    .getByRole("navigation", { name: "조립 프로젝트", exact: true })
    .getByRole("button", { name: /project-1/ })
    .click();
  await page
    .getByRole("button", { name: "구성 검사", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "저장하고 실행", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).reviewInput.context)).toBe(
    "other",
  );
});
test("reviews the merged services and preserves override edits made while saving", async ({
  page,
}) => {
  await setup(page, "multi");
  await page
    .getByRole("button", { name: "Compose 가져오기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "구성 검사", exact: true })
    .first()
    .click();
  await expect(page.locator(".builder-review")).toContainText("worker:2");
  await page.getByRole("button", { name: "파일만 저장", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).finishSave))
    .toBe(true);
  await page.getByRole("button", { name: "Compose 원문", exact: true }).click();
  await page.getByRole("button", { name: "2. dev.yml", exact: true }).click();
  await page
    .getByLabel("Compose YAML")
    .fill("services: {worker: {image: worker:3}}");
  await page.evaluate(() => (window as any).finishSave());
  await expect(page.getByLabel("Compose YAML")).toHaveValue(
    "services: {worker: {image: worker:3}}",
  );
});
