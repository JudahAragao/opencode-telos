export type AnalysisSource = "ast" | "fallback"
export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved"

export interface SourcePosition {
  line: number
  column: number
}

export interface SourceRange {
  start: SourcePosition
  end: SourcePosition
  start_index: number
  end_index: number
}

export type SymbolKind =
  | "class"
  | "function"
  | "method"
  | "variable"
  | "interface"
  | "type"
  | "enum"
  | "field"
  | "module"

export interface ImportInfo {
  source: string
  names: string[]
  kind: "import" | "require" | "use" | "include"
  range: SourceRange
  resolution_status: ResolutionStatus
  resolved_path?: string
}

export interface ExportInfo {
  name: string
  /** Original exported name when this is an aliased re-export. */
  source_name?: string
  source?: string
  kind: "named" | "default" | "reexport" | "public"
  range: SourceRange
}

export interface SymbolInfo {
  name: string
  qualified_name: string
  kind: SymbolKind
  visibility?: string
  parent?: string
  signature?: string
  range: SourceRange
  exported: boolean
}

export interface ParsedRelation {
  type: "extends" | "implements" | "calls" | "contains" | "imports"
  from: string
  to: string
  range: SourceRange
  confidence: number
}

export interface ParseDiagnostic {
  message: string
  severity: "error" | "warning" | "info"
  range?: SourceRange
}

export interface ParsedFile {
  path: string
  language: string
  parser: string
  parser_version: string
  content_hash: string
  analysis_source: AnalysisSource
  confidence: number
  package_name?: string
  imports: ImportInfo[]
  exports: ExportInfo[]
  symbols: SymbolInfo[]
  relations: ParsedRelation[]
  test_names: string[]
  diagnostics: ParseDiagnostic[]
}

export interface LanguageParser {
  readonly name: string
  readonly version: string
  supports(language: string, extension: string): boolean
  parse(filePath: string, content: string): ParsedFile
}
