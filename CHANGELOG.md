# Changelog
### $0.2.1$
    - Warn about undeclared global variables by enabling Yue's `lint_global` checks and surfacing them as editor diagnostics.
    - Support `cojson` (alongside `cjson`/`json`) for serializing messages between the extension and Yue runtime.
### $0.2.0$
    - Replaced the Bun-based LSP experiment with a lightweight `yue` subprocess that streams diagnostics while you edit.
    - Shipped a simplified runtime `server.yue` and removed generated parser artifacts to reduce the published bundle size.
### $0.1.1$
    - Introduced an experimental LSP client/server scaffold powered by Bun, including message transport helpers.
    - Added a Peggy-generated Yue parser, semantic highlighter utilities, and supporting build tooling.
### $0.1.0$
    - Greatly expanded snippet coverage for Lua/Yue standard libraries and control flow constructs.
    - Migrated the TextMate grammar to a JSON5 source with new generators and demo fixtures for validation.
### $0.0.7$
    Improved & added more snippets.
### $0.0.6$
    Added basic Snippets.
### $0.0.1$
    Initial release of the extension.