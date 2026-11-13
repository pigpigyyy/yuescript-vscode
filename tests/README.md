# Indentation regression tests

Run `npm install` first.

`npm test` reads the actual `language-configuration.json` file and checks which
`onEnterRules` action wins for representative lines. These checks cover both
block starters and lines that must retain VS Code's default bracket handling.

`npm run compile` builds the extension (Bun must be on PATH). Then
`npm run test:editor` opens an isolated VS Code development host, creates YueScript
documents, types a newline, and checks the resulting text and indentation. It
uses a temporary profile and extensions directory, without modifying your normal
editor settings. VS Code is downloaded by `@vscode/test-electron` unless you set
`VSCODE_EXECUTABLE_PATH` to an installed editor executable. On macOS, for example:

```sh
VSCODE_EXECUTABLE_PATH='/Applications/Visual Studio Code.app/Contents/MacOS/Code' npm run test:editor
```

Add a case for each bug before changing a rule. Run both suites: matching a regular
expression alone does not establish the editor's resulting indentation, especially
when VS Code's bracket fallback or token preprocessing is involved.

These rules are line-based heuristics, not a YueScript parser. In particular,
quoted-string coverage exercises single- and double-quoted strings; long-bracket
strings and multiline lexical context are not fully handled. VS Code removes
brackets from string tokens before matching Enter rules, so a raw-line regex test
cannot establish correctness for those cases.
