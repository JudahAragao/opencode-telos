function metric(actualValues, expectedValues) {
    const actual = new Set(actualValues);
    const expected = new Set(expectedValues);
    const truePositive = [...actual].filter((value) => expected.has(value)).length;
    const falsePositive = [...actual].filter((value) => !expected.has(value)).length;
    const falseNegative = [...expected].filter((value) => !actual.has(value)).length;
    return {
        precision: actual.size === 0 ? expected.size === 0 ? 1 : 0 : truePositive / actual.size,
        recall: expected.size === 0 ? actual.size === 0 ? 1 : 0 : truePositive / expected.size,
        true_positive: truePositive,
        false_positive: falsePositive,
        false_negative: falseNegative,
    };
}
export function evaluateParsedFile(parsed, expected) {
    return {
        file: parsed.path,
        parser: parsed.parser,
        source: parsed.analysis_source,
        symbols: metric(parsed.symbols.map((symbol) => symbol.qualified_name), expected.symbols || []),
        imports: metric(parsed.imports.map((item) => item.source), expected.imports || []),
        exports: metric(parsed.exports.map((item) => item.name), expected.exports || []),
        diagnostics: parsed.diagnostics.length,
    };
}
export function averageAstMetric(reports, key) {
    if (reports.length === 0)
        return { precision: 0, recall: 0, true_positive: 0, false_positive: 0, false_negative: 0 };
    const values = reports.map((report) => report[key]);
    return {
        precision: values.reduce((sum, value) => sum + value.precision, 0) / values.length,
        recall: values.reduce((sum, value) => sum + value.recall, 0) / values.length,
        true_positive: values.reduce((sum, value) => sum + value.true_positive, 0),
        false_positive: values.reduce((sum, value) => sum + value.false_positive, 0),
        false_negative: values.reduce((sum, value) => sum + value.false_negative, 0),
    };
}
