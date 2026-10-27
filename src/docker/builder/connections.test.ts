import { describe, it, expect } from "vitest";
import {
  createProject,
  patchProject,
  readProject,
  undoProject,
} from "./document";
import { addComponent, configureRedis } from "./catalog";
import {
  applyConnection,
  proposeConnection,
  removeConnection,
  renameService,
} from "./connections";
import { validateProject } from "./validation";

const stack = () =>
  addComponent(
    addComponent(createProject(), { name: "api", image: "example/api:1" }),
    { template: "mysql" },
  );
describe("component assembly", () => {
  it("reviews existing startup conditions and restores them on disconnect", () => {
    const d = patchProject(stack(), [
      { path: ["services", "api", "depends_on"], value: ["mysql"] },
    ]);
    const p = proposeConnection(d, "api", "mysql");
    expect(p.condition).toBe("service_started");
    p.condition = "service_healthy";
    p.replaceDependency = true;
    const next = applyConnection(d, p);
    expect(readProject(next.source).services[0].depends.mysql.condition).toBe(
      "service_healthy",
    );
    expect(
      readProject(removeConnection(next, p.id).source).services[0].depends.mysql
        .condition,
    ).toBe("service_started");
  });
  it("adds reviewed build arguments to shorthand build contexts", () => {
    const d = patchProject(stack(), [
      { path: ["services", "api", "build"], value: "." },
    ]);
    const p = proposeConnection(d, "api", "mysql");
    p.injection = "build";
    const next = applyConnection(d, p);
    expect(readProject(next.source).services[0].build).toMatchObject({
      context: ".",
      args: { DB_HOST: "mysql" },
    });
  });
  it("adds standalone Redis with loopback publishing, dedicated data and healthcheck", () => {
    const d = addComponent(createProject(), { template: "redis" }),
      v = readProject(d.source);
    expect(v.services[0].ports[0]).toMatchObject({
      target: 6379,
      published: "6379",
      hostIp: "127.0.0.1",
    });
    expect(v.services[0].mounts[0].source).toBe("redis-data");
    expect(v.services[0].healthcheck).toBeTruthy();
    expect(
      readProject(addComponent(d, { template: "mysql" }).source).services[1]
        .ports,
    ).toHaveLength(0);
  });
  it("configures Redis authentication and persistence without embedding a password", () => {
    const d = configureRedis(
      addComponent(createProject(), { template: "redis" }),
      "redis",
      true,
      false,
    );
    const s = readProject(d.source).services[0];
    expect(s.environment.REDIS_PASSWORD).toContain("${REDIS_PASSWORD:?");
    expect(JSON.stringify(s.command)).toContain("requirepass");
    expect(JSON.stringify(s.healthcheck)).toContain("REDISCLI_AUTH");
    expect(JSON.stringify(s.command)).toContain("--appendonly no");
  });
  it("applies a reviewed connection as a single undo transaction", () => {
    const d = stack(),
      p = proposeConnection(d, "api", "mysql");
    expect(p.condition).toBe("service_healthy");
    expect(p.mappings.find((m) => m.key === "DB_HOST")?.value).toBe("mysql");
    const next = applyConnection(d, p),
      api = readProject(next.source).services[0];
    expect(api.environment.DB_HOST).toBe("mysql");
    expect(api.depends.mysql.condition).toBe("service_healthy");
    expect(undoProject(next).source).toBe(d.source);
  });
  it("keeps preexisting env and env_file values unless explicitly replaced", () => {
    let d = patchProject(stack(), [
      { path: ["services", "api", "environment", "DB_HOST"], value: "custom" },
    ]);
    d = applyConnection(d, proposeConnection(d, "api", "mysql"));
    expect(readProject(d.source).services[0].environment.DB_HOST).toBe(
      "custom",
    );
    const file = patchProject(stack(), [
      { path: ["services", "api", "env_file"], value: ["app.env"] },
    ]);
    expect(
      proposeConnection(file, "api", "mysql").mappings.every((m) => !m.enabled),
    ).toBe(true);
  });
  it("keeps existing values expressed in list syntax", () => {
    const d = patchProject(stack(), [
      {
        path: ["services", "api", "environment"],
        value: ["DB_HOST=private-existing"],
      },
    ]);
    const next = applyConnection(d, proposeConnection(d, "api", "mysql"));
    expect(readProject(next.source).services[0].environment.DB_HOST).toBe(
      "private-existing",
    );
  });
  it("restores replaced list-syntax values when disconnecting", () => {
    const d = patchProject(stack(), [
      {
        path: ["services", "api", "environment"],
        value: ["DB_HOST=old-host", "DB_PORT=1234"],
      },
    ]);
    const p = proposeConnection(d, "api", "mysql");
    p.mappings.forEach((m) => (m.replace = true));
    const connected = applyConnection(d, p),
      removed = removeConnection(connected, p.id);
    expect(readProject(removed.source).services[0].environment).toMatchObject({
      DB_HOST: "old-host",
      DB_PORT: "1234",
    });
  });
  it("requires an explicit port for an unknown image instead of inventing one", () => {
    const d = addComponent(
      addComponent(createProject(), { name: "api", image: "example/api:1" }),
      { name: "server", image: "example/server:1" },
    );
    const p = proposeConnection(d, "api", "server");
    expect(p.mappings.find((m) => m.key === "API_PORT")?.value).toBe("");
    expect(() => applyConnection(d, p)).toThrow(/port|포트/i);
  });
  it("does not rename a dependency inside a shared alias", () => {
    const d = createProject(
      "x-deps: &deps\n  db: {condition: service_started}\nservices:\n  db: {image: mysql:8.4}\n  api:\n    image: api:1\n    depends_on: *deps\n",
    );
    expect(() => renameService(d, "db", "database")).toThrow(/source|원문/i);
  });
  it("renames only managed references and retains edited mappings on disconnect", () => {
    let d = applyConnection(
      stack(),
      proposeConnection(stack(), "api", "mysql"),
    );
    d = patchProject(d, [
      { path: ["services", "api", "environment", "LITERAL"], value: "mysql" },
    ]);
    d = renameService(d, "mysql", "database");
    expect(readProject(d.source).services[0].environment).toMatchObject({
      DB_HOST: "database",
      LITERAL: "mysql",
    });
    d = patchProject(d, [
      { path: ["services", "api", "environment", "DB_PORT"], value: "custom" },
    ]);
    d = removeConnection(d, d.connections[0].id);
    expect(readProject(d.source).services[0].environment.DB_PORT).toBe(
      "custom",
    );
    expect(
      readProject(d.source).services[0].environment.DB_HOST,
    ).toBeUndefined();
  });
  it("refuses browser connections to private endpoints or credentials", () => {
    const d = stack(),
      p = proposeConnection(d, "api", "mysql");
    p.origin = "browser";
    p.publicUrl = "https://db.example";
    expect(() => applyConnection(d, p)).toThrow(/browser|브라우저/i);
  });
  it("reports cyclic startup and healthy dependencies without a check", () => {
    const d = patchProject(stack(), [
      {
        path: ["services", "api", "depends_on"],
        value: { mysql: { condition: "service_started" } },
      },
      {
        path: ["services", "mysql", "depends_on"],
        value: { api: { condition: "service_healthy" } },
      },
    ]);
    const issues = validateProject(d);
    expect(issues.some((i) => i.code === "cycle")).toBe(true);
    expect(issues.some((i) => i.code === "healthcheck")).toBe(true);
  });
  it("updates tracked provider values but preserves detached consumer overrides", () => {
    let d = stack();
    d = applyConnection(d, proposeConnection(d, "api", "mysql"));
    d = patchProject(d, [
      {
        path: ["services", "mysql", "environment", "MYSQL_DATABASE"],
        value: "other",
      },
    ]);
    expect(readProject(d.source).services[0].environment.DB_NAME).toBe("other");
    d = patchProject(d, [
      { path: ["services", "api", "environment", "DB_NAME"], value: "manual" },
    ]);
    d = patchProject(d, [
      {
        path: ["services", "mysql", "environment", "MYSQL_DATABASE"],
        value: "third",
      },
    ]);
    expect(readProject(d.source).services[0].environment.DB_NAME).toBe(
      "manual",
    );
  });
});
