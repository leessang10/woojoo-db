import { test, expect } from "./fixtures";
import { chooseOption } from "./select-control";

test("assembles an engine-independent Redis draft and restores safe structure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("docker-project-builder")).toBeVisible();
  await page
    .getByRole("button", { name: "컴포넌트 추가", exact: true })
    .click();
  await page.getByRole("button", { name: "Redis 추가", exact: true }).click();
  await expect(page.getByTestId("builder-service-redis")).toBeVisible();
  await expect(page.getByTestId("builder-service-redis")).toContainText("6379");
  await page.getByRole("button", { name: "Compose 원문", exact: true }).click();
  await expect(page.getByLabel("Compose YAML")).toHaveValue(/redis:7.4/);
  await expect(page.getByLabel("Compose YAML")).toHaveValue(/127.0.0.1/);
  await page.reload();
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await expect(page.getByTestId("builder-service-redis")).toBeVisible();
});

test("reviews environment mappings and startup as one undoable connection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "컴포넌트 추가", exact: true })
    .click();
  await page.getByRole("button", { name: "MySQL 추가", exact: true }).click();
  await page
    .getByRole("button", { name: "컴포넌트 추가", exact: true })
    .click();
  await page
    .getByRole("button", { name: "이미지 직접 지정", exact: true })
    .click();
  await page.getByLabel("이미지 주소").fill("example/api:1");
  await page.getByLabel("컴포넌트 이름").fill("api");
  await page
    .getByRole("button", { name: "이미지 컴포넌트 추가", exact: true })
    .click();
  await page.getByTestId("builder-service-api").click();
  await page.getByRole("button", { name: "연결 추가", exact: true }).click();
  await chooseOption(page.getByLabel("연결 대상 서비스"), "mysql");
  await expect(page.getByLabel("변수 DB_HOST 값")).toHaveValue("mysql");
  await page.getByRole("button", { name: "초안에 적용", exact: true }).click();
  await page.getByRole("button", { name: "Compose 원문", exact: true }).click();
  await expect(page.getByLabel("Compose YAML")).toHaveValue(/service_healthy/);
  await expect(page.getByLabel("Compose YAML")).toHaveValue(/DB_HOST: mysql/);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.getByLabel("Compose YAML")).not.toHaveValue(/DB_HOST/);
});
