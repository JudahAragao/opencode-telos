export const DEFAULT_SDD_CONFIG = {
    storage: "yaml",
    dashboard: {
        enabled: true,
        host: "127.0.0.1",
        port: "auto",
    },
    workflow: {
        specification_first: true,
        auto_discovery: true,
        drift_detection: true,
        require_approval_for_architecture_changes: true,
    },
    graph: {
        max_traversal_depth: 5,
    },
    git: {
        enabled: true,
    },
    validation: {
        critical_requirement_without_test: "error",
        missing_verification_scenario: "warning",
    },
};
