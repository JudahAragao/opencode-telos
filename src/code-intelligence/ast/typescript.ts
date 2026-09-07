import ts from "typescript"
import { basename, extname } from "path"
import { contentHash, emptyParsedFile, rangeFromOffsets } from "./common.js"
import type { ExportInfo, ImportInfo, LanguageParser, ParsedFile, SymbolInfo } from "./ir.js"

function textOf(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source)
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function symbolRange(node: ts.Node, source: ts.SourceFile) {
  return rangeFromOffsets(source.text, node.getStart(source), node.getEnd())
}

export class TypeScriptParser implements LanguageParser {
  readonly name = "typescript-compiler-api"
  readonly version = ts.version

  supports(language: string, extension: string): boolean {
    return (language === "typescript" || language === "javascript") &&
      [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(extension.toLowerCase())
  }

  parse(filePath: string, content: string): ParsedFile {
    const extension = extname(filePath).toLowerCase()
    const language = extension.includes("js") || extension === ".jsx" ? "javascript" : "typescript"
    const scriptKind = extension === ".tsx" ? ts.ScriptKind.TSX
      : extension === ".jsx" ? ts.ScriptKind.JSX
        : language === "typescript" ? ts.ScriptKind.TS : ts.ScriptKind.JS
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)
    const result = emptyParsedFile(filePath, language, this.name, this.version, content)
    const symbolStack: string[] = []

    const addImport = (item: ImportInfo) => result.imports.push(item)
    const addExport = (item: ExportInfo) => result.exports.push(item)
    const addSymbol = (node: ts.Node, name: string, kind: SymbolInfo["kind"], exported = false, signature?: string) => {
      const parent = symbolStack.at(-1)
      const qualifiedName = parent ? `${parent}.${name}` : name
      result.symbols.push({ name, qualified_name: qualifiedName, kind, parent, signature, range: symbolRange(node, source), exported })
      if (exported) addExport({ name, kind: "named", range: symbolRange(node, source) })
      return qualifiedName
    }

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const names: string[] = []
        const clause = node.importClause
        if (clause?.name) names.push(clause.name.text)
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) names.push(`* as ${clause.namedBindings.name.text}`)
          else for (const element of clause.namedBindings.elements) {
            const importedName = element.propertyName?.text || element.name.text
            names.push(importedName === element.name.text ? importedName : `${importedName} as ${element.name.text}`)
          }
        }
        addImport({ source: node.moduleSpecifier.text, names, kind: "import", range: symbolRange(node, source), resolution_status: "unresolved" })
      }

      if (ts.isExportDeclaration(node)) {
        const sourceName = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) addExport({ name: element.name.text, source_name: element.propertyName?.text, source: sourceName, kind: sourceName ? "reexport" : "named", range: symbolRange(element, source) })
        } else if (sourceName) addExport({ name: "*", source: sourceName, kind: "reexport", range: symbolRange(node, source) })
      }
      if (ts.isExportAssignment(node)) {
        addExport({ name: "default", source: textOf(node.expression, source), kind: "default", range: symbolRange(node, source) })
      }

      if (ts.isClassDeclaration(node) && node.name) {
        const qualified = addSymbol(node, node.name.text, "class", isExported(node))
        symbolStack.push(qualified)
        const heritage = node.heritageClauses || []
        for (const clause of heritage) for (const type of clause.types) {
          const target = textOf(type.expression, source)
          result.relations.push({ type: clause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : "extends", from: qualified, to: target, range: symbolRange(type, source), confidence: 1 })
        }
        for (const member of node.members) visit(member)
        symbolStack.pop()
        return
      }
      if (ts.isInterfaceDeclaration(node) && node.name) {
        addSymbol(node, node.name.text, "interface", isExported(node))
        return
      }
      if (ts.isTypeAliasDeclaration(node)) {
        addSymbol(node, node.name.text, "type", isExported(node), textOf(node.type, source))
        return
      }
      if (ts.isEnumDeclaration(node)) {
        addSymbol(node, node.name.text, "enum", isExported(node))
        return
      }
      if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
        addSymbol(node, node.name.text, "module", isExported(node))
        return
      }
      let scopedSymbol: string | undefined
      if (ts.isFunctionDeclaration(node) && node.name) {
        scopedSymbol = addSymbol(node, node.name.text, "function", isExported(node), textOf(node, source).split("{")[0].trim())
      } else if (ts.isMethodDeclaration(node) && node.name) {
        scopedSymbol = addSymbol(node, textOf(node.name, source), "method", isExported(node), textOf(node, source).split("{")[0].trim())
      } else if (ts.isPropertyDeclaration(node) && node.name) {
        addSymbol(node, textOf(node.name, source), "field", isExported(node))
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) {
          const value = declaration.initializer
          const kind = value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? "function" : "variable"
          addSymbol(declaration, declaration.name.text, kind, isExported(node), value ? textOf(value, source).split("=>")[0].trim() : undefined)
        }
      }

      if (scopedSymbol) symbolStack.push(scopedSymbol)
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.getText(source).replace(/^this\./, "")
            : ""
        const first = node.arguments[0]
        if (["describe", "test", "it", "specify"].includes(callee) && first && ts.isStringLiteral(first)) result.test_names.push(first.text)
        const current = symbolStack.at(-1)
        if (current && callee) result.relations.push({ type: "calls", from: current, to: callee, range: symbolRange(node, source), confidence: 0.8 })
      }
      ts.forEachChild(node, visit)
      if (scopedSymbol) symbolStack.pop()
    }

    for (const statement of source.statements) visit(statement)
    const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics || []
    const hasParseError = parseDiagnostics.length > 0
    if (hasParseError) {
      result.confidence = 0.8
      for (const diagnostic of parseDiagnostics) {
        const start = diagnostic.start || 0
        result.diagnostics.push({ message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "), severity: "warning", range: rangeFromOffsets(content, start, start + (diagnostic.length || 1)) })
      }
    }
    // Ensure the parser always emits a stable identity even for empty files.
    result.package_name = basename(filePath)
    result.content_hash = contentHash(content)
    return result
  }
}
