import { parseDocument } from "yaml";
import type { ProjectDraft, SourceFile } from "./types";

export function canRestore(
  current: ProjectDraft,
  captured: ProjectDraft,
): boolean {
  return (
    current.id === captured.id &&
    current.revision === captured.revision &&
    current.source === captured.source
  );
}
export function completeSave(
  current: ProjectDraft,
  captured: ProjectDraft,
  saved: SourceFile[],
): ProjectDraft {
  if (current.id !== captured.id) return current;
  const byPath = new Map(saved.map((f) => [f.path, f]));
  // Save completion updates disk baselines, never a newer editor buffer.
  return {
    ...current,
    files: current.files.map((f) =>
      byPath.has(f.path)
        ? {
            ...f,
            source: current.files.length === 1 ? current.source : f.source,
            original: byPath.get(f.path)!.source,
          }
        : f,
    ),
    savedSource: captured.source,
    needsInput: false,
    pendingDestination: false,
  };
}
export function importedProjectName(
  files: { path: string; source: string }[],
): string {
  let explicit = "";
  for (const file of files) {
    try {
      const name = parseDocument(file.source).get("name");
      if (typeof name === "string") explicit = name;
    } catch {
      /* source diagnostics are shown by the editor */
    }
  }
  if (explicit) return explicit;
  return (
    (files[0]?.path.replace(/\\/g, "/").split("/").at(-2) ?? "imported")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-") || "imported"
  );
}
