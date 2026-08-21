import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import * as ts from "typescript";

export const P19_REPO_ROOT = resolve(import.meta.dirname, "..");
export const P19_SOURCE_ROOT = join(P19_REPO_ROOT, "src");

export type SourceImport = Readonly<{
  importer: string;
  line: number;
  specifier: string;
  target: string | null;
  typeOnly: boolean;
}>;

export const NONLITERAL_DYNAMIC_IMPORT = "<nonliteral-dynamic-import>";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const RESOLUTION_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
};

export function repositoryPath(path: string): string {
  return relative(P19_REPO_ROOT, path).replaceAll("\\", "/");
}

export function listP19SourceFiles(directory = P19_SOURCE_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listP19SourceFiles(path);
    }
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(path)) && !path.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (file.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (file.endsWith(".js") || file.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  return clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) {
    return true;
  }
  return node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly);
}

function resolveSourceSpecifier(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = ts.resolveModuleName(
    specifier,
    importer,
    RESOLUTION_OPTIONS,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (resolved) {
    return repositoryPath(resolved);
  }

  const unresolved = resolve(importer, "..", specifier);
  const candidates = extname(unresolved)
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.js`,
        `${unresolved}.jsx`,
        join(unresolved, "index.ts"),
        join(unresolved, "index.tsx"),
      ];
  const candidate = candidates.find((path) => existsSync(path));
  return candidate ? repositoryPath(candidate) : null;
}

export function importsForP19Source(file: string): SourceImport[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const imports: SourceImport[] = [];
  const importer = repositoryPath(file);

  const record = (node: ts.Node, specifier: string, typeOnly: boolean): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    imports.push({
      importer,
      line,
      specifier,
      target: resolveSourceSpecifier(file, specifier),
      typeOnly,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      record(node, node.moduleSpecifier.text, importDeclarationIsTypeOnly(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      record(node, node.moduleSpecifier.text, exportDeclarationIsTypeOnly(node));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      record(node, node.moduleReference.expression.text, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1
    ) {
      const firstArgument = node.arguments[0]!;
      if (ts.isStringLiteralLike(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument)) {
        record(node, firstArgument.text, false);
      } else {
        record(node, NONLITERAL_DYNAMIC_IMPORT, false);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      record(node, node.argument.literal.text, true);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return imports;
}

function exportedBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : exportedBindingNames(element.name)
  );
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

export function exportedNamesForP19Source(file: string): Set<string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        names.add(element.name.text);
      }
      continue;
    }
    if (!isExported(statement)) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of exportedBindingNames(declaration.name)) {
          names.add(name);
        }
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
  }

  return names;
}

export function formatSourceImport(problem: string, sourceImport: SourceImport): string {
  const target = sourceImport.target ?? sourceImport.specifier;
  return `${sourceImport.importer}:${sourceImport.line} -> ${target}: ${problem}`;
}
