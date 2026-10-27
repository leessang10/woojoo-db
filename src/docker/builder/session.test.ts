import { describe, it, expect } from "vitest";
import { createProject, changeProject } from "./document";
import { completeSave, importedProjectName, canRestore } from "./session";
describe("project asynchronous completions", () => {
  it("marks a single-file GUI edit saved and retains later edits", () => {
    const initial = createProject("services: {}");
    initial.files = [
      { path: "C:/app.yml", source: initial.source, original: initial.source },
    ];
    const edited = changeProject(initial, "services: {api: {image: api:1}}");
    const result = completeSave(edited, edited, [
      { ...initial.files[0], source: edited.source, original: edited.source },
    ]);
    expect(result.files[0].source).toBe(result.files[0].original);
    const later = changeProject(edited, "services: {api: {image: api:2}}");
    const completed = completeSave(later, edited, [
      { ...initial.files[0], source: edited.source, original: edited.source },
    ]);
    expect(completed.files[0].source).toBe(later.source);
    expect(completed.files[0].original).toBe(edited.source);
  });
  it("records saved originals without replacing edits made while saving", () => {
    const d = createProject("services: {}");
    d.files = [
      { path: "C:/base.yml", source: d.source, original: "" },
      { path: "C:/dev.yml", source: "services: {}", original: "" },
    ];
    const newer = changeProject(d, d.source);
    newer.files = [
      d.files[0],
      { ...d.files[1], source: "services: {redis: {image: redis:7.4}}" },
    ];
    const saved = completeSave(
      newer,
      d,
      d.files.map((f) => ({ ...f, original: f.source })),
    );
    expect(saved.files[1].source).toContain("redis");
    expect(saved.files[1].original).toBe("services: {}");
    expect(saved.revision).toBe(newer.revision);
  });
  it("does not restore over edited or different projects", () => {
    const d = createProject();
    expect(canRestore(d, d)).toBe(true);
    expect(canRestore(changeProject(d, "services: {a: {image: a}}"), d)).toBe(
      false,
    );
    expect(canRestore(createProject(), d)).toBe(false);
  });
  it("uses the last explicit Compose project name before the folder fallback", () => {
    expect(
      importedProjectName([
        { path: "C:/folder/base.yml", source: "name: actual\nservices: {}" },
        { path: "C:/folder/dev.yml", source: "name: dev\nservices: {}" },
      ]),
    ).toBe("dev");
    expect(
      importedProjectName([
        { path: "C:/folder/base.yml", source: "services: {}" },
      ]),
    ).toBe("folder");
  });
});
