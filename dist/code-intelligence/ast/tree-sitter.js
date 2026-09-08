import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";
import Ruby from "tree-sitter-ruby";
import { extname } from "path";
import { emptyParsedFile, rangeFromOffsets } from "./common.js";
const GRAMMARS = {
    python: { language: Python, version: "0.25.0" },
    go: { language: Go, version: "0.25.0" },
    rust: { language: Rust, version: "0.24.0" },
    java: { language: Java, version: "0.23.5" },
    ruby: { language: Ruby, version: "0.23.1" },
};
const EXTENSIONS = {
    ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby",
};
function nodeName(node) {
    const name = node.childForFieldName("name");
    return name?.text || node.namedChildren.find((child) => ["identifier", "type_identifier", "field_identifier", "constant"].includes(child.type))?.text;
}
function fieldText(node, field) {
    return node.childForFieldName(field)?.text;
}
function visibilityFor(language, text) {
    if (language === "rust")
        return text.trimStart().startsWith("pub") ? "public" : "private";
    if (language === "java") {
        if (/\bpublic\b/.test(text))
            return "public";
        if (/\bprotected\b/.test(text))
            return "protected";
        if (/\bprivate\b/.test(text))
            return "private";
        return "package";
    }
    if (language === "go")
        return /^[A-Z]/.test(text) ? "public" : "private";
    if (language === "ruby" || language === "python")
        return text.trimStart().startsWith("_") ? "private" : "public";
    return undefined;
}
function isPublic(language, name, text) {
    if (language === "rust")
        return text.trimStart().startsWith("pub");
    if (language === "java")
        return /\bpublic\b/.test(text);
    if (language === "go")
        return /^[A-Z]/.test(name);
    return !name.startsWith("_");
}
function isTypeNode(language, type) {
    if (language === "python")
        return type === "class_definition";
    if (language === "go")
        return type === "type_spec";
    if (language === "rust")
        return ["struct_item", "enum_item", "trait_item"].includes(type);
    if (language === "java")
        return ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"].includes(type);
    return ["class", "module"].includes(type);
}
function symbolKind(language, type) {
    if (isTypeNode(language, type)) {
        if (language === "ruby" && type === "module")
            return "module";
        if (type.includes("interface") || type === "trait_item")
            return "interface";
        if (type.includes("enum"))
            return "enum";
        return "class";
    }
    if (["function_definition", "function_declaration", "function_item", "method", "method_declaration", "constructor_declaration", "singleton_method"].includes(type)) {
        return ["method", "method_declaration", "constructor_declaration", "singleton_method"].includes(type) ? "method" : "function";
    }
    if (type === "function_signature_item" || type === "method_elem")
        return "method";
    if (type === "field_declaration")
        return "field";
    if (type === "type_alias_declaration")
        return "type";
    return undefined;
}
function importSource(node) {
    const path = node.childForFieldName("path") || node.childForFieldName("module_name") || node.childForFieldName("argument");
    if (path)
        return path.text.replace(/^['\"]|['\"]$/g, "");
    const named = node.namedChildren.find((child) => child.type.includes("string") || child.type.includes("identifier"));
    return named?.text.replace(/^['\"]|['\"]$/g, "");
}
function isImportNode(language, type) {
    if (language === "python")
        return ["import_statement", "import_from_statement"].includes(type);
    if (language === "go")
        return type === "import_spec";
    if (language === "rust")
        return type === "use_declaration";
    if (language === "java")
        return type === "import_declaration";
    return false;
}
function importKind(language) {
    if (language === "rust")
        return "use";
    return "import";
}
function textRange(content, node) {
    return rangeFromOffsets(content, node.startIndex, node.endIndex);
}
export class TreeSitterParser {
    name = "tree-sitter";
    version = "0.25";
    supports(language, extension) {
        return Boolean(GRAMMARS[language] && EXTENSIONS[extension.toLowerCase()] === language);
    }
    parse(filePath, content) {
        const extension = extname(filePath).toLowerCase();
        const language = EXTENSIONS[extension] || "unknown";
        const grammar = GRAMMARS[language];
        const result = emptyParsedFile(filePath, language, `${this.name}:${language}`, grammar?.version || this.version, content);
        if (!grammar) {
            result.analysis_source = "fallback";
            result.confidence = 0;
            result.diagnostics.push({ message: `No Tree-sitter grammar registered for ${language}`, severity: "error" });
            return result;
        }
        const parser = new Parser();
        parser.setLanguage(grammar.language);
        parser.setTimeoutMicros(750_000);
        const tree = parser.parse(content);
        const contexts = [];
        const addSymbol = (node, name, kind) => {
            const parent = contexts.at(-1);
            const qualified = parent ? `${parent}.${name}` : name;
            const symbol = {
                name,
                qualified_name: qualified,
                kind,
                parent,
                visibility: visibilityFor(language, node.text),
                signature: node.text.split("{")[0].split("\n")[0].trim(),
                range: textRange(content, node),
                exported: isPublic(language, name, node.text),
            };
            result.symbols.push(symbol);
            if (symbol.exported)
                result.exports.push({ name, kind: "public", range: symbol.range });
            return qualified;
        };
        const addRelation = (relation, from, to, node, confidence = 0.9) => {
            if (from && to)
                result.relations.push({ type: relation, from, to, range: textRange(content, node), confidence });
        };
        const walk = (node) => {
            if (node.isMissing)
                result.diagnostics.push({ message: `Missing syntax node: ${node.type}`, severity: "warning", range: textRange(content, node) });
            if (language === "go" && node.type === "package_clause")
                result.package_name = node.childForFieldName("name")?.text;
            if (language === "java" && node.type === "package_declaration")
                result.package_name = node.namedChildren.at(-1)?.text;
            if (language === "ruby" && node.type === "call") {
                const method = node.childForFieldName("method")?.text;
                const stringNode = node.namedChildren.find((child) => child.type.includes("string"));
                if ((method === "require" || method === "require_relative") && stringNode) {
                    result.imports.push({ source: stringNode.text.replace(/^['\"]|['\"]$/g, ""), names: [], kind: "require", range: textRange(content, node), resolution_status: "unresolved" });
                }
            }
            if (isImportNode(language, node.type)) {
                const source = importSource(node);
                if (source)
                    result.imports.push({ source, names: node.namedChildren.map((child) => child.text).slice(0, 8), kind: importKind(language), range: textRange(content, node), resolution_status: "unresolved" });
            }
            let pushed = false;
            let contextual = false;
            if (language === "go" && node.type === "method_declaration") {
                const receiverType = node.childForFieldName("receiver")?.descendantsOfType(["type_identifier"])[0]?.text;
                if (receiverType) {
                    contexts.push(receiverType.replace(/^\*/, ""));
                    contextual = true;
                }
            }
            if (language === "rust" && node.type === "impl_item") {
                const target = fieldText(node, "type");
                const trait = fieldText(node, "trait");
                if (target) {
                    contexts.push(target);
                    contextual = true;
                }
                if (target && trait)
                    addRelation("implements", target, trait, node);
            }
            const kind = symbolKind(language, node.type);
            const name = nodeName(node);
            if (kind && name) {
                const qualified = addSymbol(node, name, kind);
                contexts.push(qualified);
                pushed = true;
                if (language === "python" && node.type === "class_definition") {
                    const supers = node.childForFieldName("superclasses");
                    for (const child of supers?.namedChildren || [])
                        addRelation("extends", qualified, child.text, child);
                }
                if (language === "ruby" && node.type === "class") {
                    const superclass = node.childForFieldName("superclass");
                    if (superclass)
                        addRelation("extends", qualified, superclass.text, superclass);
                }
                if (language === "java" && ["class_declaration", "interface_declaration"].includes(node.type)) {
                    const superclass = node.childForFieldName("superclass");
                    if (superclass)
                        addRelation("extends", qualified, superclass.text, superclass);
                    const interfaces = node.childForFieldName("interfaces");
                    for (const item of interfaces?.namedChildren || [])
                        addRelation("implements", qualified, item.text, item);
                }
            }
            if (node.type.includes("call") || node.type === "call" || node.type === "method_invocation") {
                const methodNode = node.childForFieldName("function") || node.childForFieldName("method") ||
                    (language === "java" ? node.childForFieldName("name") : undefined);
                const callee = methodNode || node.namedChildren[0];
                const current = contexts.at(-1);
                if (callee && current) {
                    let target = callee.text.replace(/^self[.:#]/, "");
                    if (language === "java" && methodNode && node.childForFieldName("object")) {
                        const object = node.childForFieldName("object").text.match(/(?:new\s+)?([A-Za-z_$][\w$]*)/);
                        if (object)
                            target = `${object[1]}.${target}`;
                    }
                    target = target.replace(/\(\)/g, "");
                    addRelation("calls", current, target, node, 0.6);
                    if (["describe", "test", "it", "specify"].includes(target)) {
                        const stringNode = node.namedChildren.find((child) => child.type.includes("string"));
                        if (stringNode)
                            result.test_names.push(stringNode.text.replace(/^['\"]|['\"]$/g, ""));
                    }
                }
            }
            for (const child of node.namedChildren)
                walk(child);
            if (pushed)
                contexts.pop();
            if (contextual)
                contexts.pop();
        };
        walk(tree.rootNode);
        if (tree.rootNode.hasError) {
            result.confidence = 0.85;
            result.diagnostics.push({ message: "Tree-sitter recovered one or more syntax errors", severity: "warning", range: textRange(content, tree.rootNode) });
        }
        result.package_name = result.symbols.find((symbol) => symbol.kind === "module")?.name;
        return result;
    }
}
