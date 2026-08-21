import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  P19_REPO_ROOT,
  NONLITERAL_DYNAMIC_IMPORT,
  exportedNamesForP19Source,
  formatSourceImport,
  importsForP19Source,
  listP19SourceFiles,
  type SourceImport,
} from "./p19-architecture-kit";

const APP_PUBLIC_EXPORTS = [
  "App",
  "EMPTY_LYNX_CHECKLIST_STATE",
  "EMPTY_POPUP_CREDENTIALS_FORM",
  "EMPTY_POPUP_DIAGNOSTICS",
  "EMPTY_POPUP_SETTINGS_FORM",
  "LynxChecklistState",
  "PopupActionAvailability",
  "PopupAuthState",
  "PopupCredentialsField",
  "PopupCredentialsForm",
  "PopupCurtainKind",
  "PopupDiagnostics",
  "PopupLogEntry",
  "PopupSettingsField",
  "PopupSettingsForm",
  "PreviewRowList",
  "PreviewRowListProps",
  "RENDER_MODE_NOT_SET_REASON",
  "RenderModeView",
  "markingDisableNeedsConfirmation",
  "relativePageKey",
  "resolvePopupActionButtons",
  "resolvePopupCurtainKind",
  "resolvePopupPanelBlocking",
] as const;

const sourceImports = listP19SourceFiles().flatMap(importsForP19Source);

function targetStartsWith(sourceImport: SourceImport, prefix: string): boolean {
  return sourceImport.target === prefix || sourceImport.target?.startsWith(`${prefix}/`) === true;
}

function isExternalPackage(sourceImport: SourceImport, name: string): boolean {
  return sourceImport.target === null &&
    (sourceImport.specifier === name || sourceImport.specifier.startsWith(`${name}/`));
}

function isPopupController(path: string | null): boolean {
  return path !== null && (
    path.startsWith("src/popup/controllers/") ||
    /^src\/popup\/[^/]+-controller\.tsx?$/.test(path)
  );
}

function isPopupSection(path: string): boolean {
  return path.startsWith("src/popup/sections/");
}

function isAllowedPopupSectionImport(sourceImport: SourceImport): boolean {
  if (
    isExternalPackage(sourceImport, "react") ||
    isExternalPackage(sourceImport, "react-dom")
  ) {
    return true;
  }
  if (sourceImport.target === null) {
    return false;
  }
  return [
    "src/domain",
    "src/ui",
    "src/popup/sections",
  ].some((prefix) => targetStartsWith(sourceImport, prefix)) || [
    "src/popup/presentation.ts",
    "src/popup/theme.ts",
    "src/popup/view.ts",
    "src/popup/copy.ts",
    "src/popup/preview-classification.ts",
    "src/popup/todo-recovery.ts",
  ].includes(sourceImport.target);
}

function isContentLifecycleController(path: string): boolean {
  return path.startsWith("src/content/controllers/") ||
    /^src\/content\/[^/]+-lifecycle\.tsx?$/.test(path) ||
    path === "src/content/transient-surfaces.ts" ||
    path === "src/content/preview-controller.ts";
}

function controllerPortViolation(sourceImport: SourceImport): string | null {
  if (
    isExternalPackage(sourceImport, "react") ||
    isExternalPackage(sourceImport, "react-dom")
  ) {
    return "operational controllers must not depend on React";
  }
  if (
    isExternalPackage(sourceImport, "chrome") ||
    isExternalPackage(sourceImport, "webextension-polyfill") ||
    sourceImport.target === "src/common/browser.ts"
  ) {
    return "browser access must be injected into operational controllers";
  }
  if (targetStartsWith(sourceImport, "src/messaging/transports")) {
    return "messaging transports must be injected into operational controllers";
  }
  if (
    !sourceImport.typeOnly &&
    (sourceImport.target === "src/messaging/realms.ts" ||
      sourceImport.target === "src/messaging/rewrite-signals.ts")
  ) {
    return "runtime bus ownership must remain in the realm entrypoint";
  }
  if (!sourceImport.typeOnly && targetStartsWith(sourceImport, "src/storage")) {
    return "runtime storage access must remain behind an injected port";
  }
  return null;
}

describe("ACCEPT-P19-DECOMPOSITION TypeScript import boundaries", () => {
  it("preserves the existing App public export surface during later moves", () => {
    const exported = exportedNamesForP19Source(join(P19_REPO_ROOT, "src/popup/App.tsx"));
    const missing = APP_PUBLIC_EXPORTS.filter((name) => !exported.has(name));

    expect(missing).toEqual([]);
  });

  it("keeps shared messaging contracts independent of realm implementations", () => {
    const violations = sourceImports.flatMap((sourceImport) => {
      if (!sourceImport.importer.startsWith("src/messaging/")) {
        return [];
      }
      const forbiddenTarget = [
        "src/background",
        "src/content",
        "src/entrypoints",
        "src/offscreen",
        "src/popup",
      ].some((prefix) => targetStartsWith(sourceImport, prefix));
      return forbiddenTarget
        ? [formatSourceImport("shared messaging contracts cannot import a realm implementation", sourceImport)]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps popup support modules independent of the React App module", () => {
    const violations = sourceImports.flatMap((sourceImport) =>
      sourceImport.importer.startsWith("src/popup/") &&
        sourceImport.importer !== "src/popup/App.tsx" &&
        sourceImport.target === "src/popup/App.tsx"
        ? [formatSourceImport("move shared presentation contracts out of App instead", sourceImport)]
        : []
    );

    expect(violations).toEqual([]);
  });

  it("keeps shared UI policy independent of every extension realm", () => {
    const violations = sourceImports.flatMap((sourceImport) => {
      if (!sourceImport.importer.startsWith("src/ui/")) {
        return [];
      }
      const realmImport = [
        "src/background",
        "src/content",
        "src/entrypoints",
        "src/messaging",
        "src/offscreen",
        "src/popup",
        "src/storage",
      ].some((prefix) => targetStartsWith(sourceImport, prefix));
      const frameworkImport = isExternalPackage(sourceImport, "react") ||
        isExternalPackage(sourceImport, "react-dom");
      return realmImport || frameworkImport || sourceImport.target === "src/common/browser.ts"
        ? [formatSourceImport("src/ui must remain framework- and realm-neutral", sourceImport)]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("enforces injected ports and one-way dependencies for extracted controllers", () => {
    const violations = sourceImports.flatMap((sourceImport) => {
      const popupController = isPopupController(sourceImport.importer);
      const contentController = isContentLifecycleController(sourceImport.importer);
      if (!popupController && !contentController) {
        return [];
      }

      const commonViolation = controllerPortViolation(sourceImport);
      if (commonViolation) {
        return [formatSourceImport(commonViolation, sourceImport)];
      }
      if (sourceImport.specifier === NONLITERAL_DYNAMIC_IMPORT) {
        return [formatSourceImport("controllers cannot hide dependencies behind a nonliteral dynamic import", sourceImport)];
      }
      if (
        targetStartsWith(sourceImport, "src/entrypoints") ||
        targetStartsWith(sourceImport, "src/background")
      ) {
        return [formatSourceImport("controllers cannot import entrypoints or background authority", sourceImport)];
      }
      if (
        popupController &&
        (targetStartsWith(sourceImport, "src/content") ||
          sourceImport.target === "src/popup/App.tsx" ||
          sourceImport.target !== null && isPopupSection(sourceImport.target))
      ) {
        return [formatSourceImport("popup controllers cannot depend on content or React presentation", sourceImport)];
      }
      if (
        contentController &&
        (targetStartsWith(sourceImport, "src/popup") || targetStartsWith(sourceImport, "src/offscreen"))
      ) {
        return [formatSourceImport("content controllers cannot depend on another realm", sourceImport)];
      }
      return [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps focused React sections presentation-only and App controller-free", () => {
    const violations = sourceImports.flatMap((sourceImport) => {
      if (sourceImport.importer === "src/popup/App.tsx" && isPopupController(sourceImport.target)) {
        return [formatSourceImport("App receives controller snapshots and callbacks through its public props", sourceImport)];
      }
      if (
        sourceImport.importer === "src/popup/App.tsx" &&
        ([
          "src/background",
          "src/content",
          "src/entrypoints",
          "src/messaging",
          "src/offscreen",
          "src/storage",
        ].some((prefix) => targetStartsWith(sourceImport, prefix)) ||
          sourceImport.target === "src/common/browser.ts" ||
          isExternalPackage(sourceImport, "chrome") ||
          isExternalPackage(sourceImport, "webextension-polyfill") ||
          sourceImport.specifier === NONLITERAL_DYNAMIC_IMPORT)
      ) {
        return [formatSourceImport("App must remain a presentation boundary", sourceImport)];
      }
      if (sourceImport.importer === "src/popup/presentation.ts") {
        const permittedTypeDependency = sourceImport.typeOnly && (
          targetStartsWith(sourceImport, "src/domain") ||
          sourceImport.target === "src/popup/organ/memory.ts"
        );
        if (!permittedTypeDependency) {
          return [formatSourceImport("popup presentation contracts may depend only on domain and organ types", sourceImport)];
        }
      }
      if (!isPopupSection(sourceImport.importer)) {
        return [];
      }
      if (!isAllowedPopupSectionImport(sourceImport)) {
        return [formatSourceImport("React sections may depend only on presentation and pure UI/domain helpers", sourceImport)];
      }
      return [];
    });

    expect(violations).toEqual([]);
  });
});
