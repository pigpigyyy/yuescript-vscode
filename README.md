<center>

# YueScript

###### (yuescript-vscode)

<img src="images/icon.png" width=128 height=128>

![Last Commit](https://img.shields.io/github/last-commit/pigpigyyy/yuescript-vscode?style=flat-square)
![Repo Size](https://img.shields.io/github/repo-size/pigpigyyy/yuescript-vscode?style=flat-square)
![Repo Stars](https://img.shields.io/github/stars/pigpigyyy/yuescript-vscode?style=flat-square)

A `VSCode` extension for [`YueScript`](https://github.com/pigpigyyy/yuescript-vscode.git)

[read the documentation here 🔗](https://yuescript.org/)

</center>

## Features

- Provides **syntax-highlighting** and **snippets** for `YueScript`.
- Supports loading `yueconfig.yue` file from the workspace as the compilation configuration file.
- Automatic build to `.lua` file on save (when `build` is enabled in configuration).
- Skip generating `.lua` for `yueconfig.yue` (config-only file).
- Includes an internal LuaLS bridge (LSP over stdio), so Yue diagnostics/completion/signature/hover/definition can work without opening generated `.lua` files.
- Supports Yue-style completion probing for chained calls, including `.` and `\` method call forms.

## Configuration

The extension supports loading a `yueconfig.yue` file from your workspace. This file allows you to configure how the extension compiles your Yuescript code. Create a `yueconfig.yue` file in your workspace with the following format:

```moonscript
-- create a `yueconfig.yue` file in your workspace with the following options

return
	-- Whether the vscode extension should build the code to Lua file on save.
	build: false

	-- The search paths to be included when compiling the code. The search paths are relative to the `yueconfig.yue` file.
	include:
		- "Lib"

	-- The global variables to be recognized by the extension.
	globals:
		- "Dora"

	-- Whether the compiler should collect the global variables appearing in the code.
	lint_global: true

	-- Whether the compiler should do an implicit return for the root code block.
	implicit_return_root: true

	-- Whether the compiler should reserve the original line number in the compiled code.
	reserve_line_number: true

	-- Whether the compiler should reserve the original comment in statement in the compiled code.
	reserve_comment: true

	-- Whether the compiler should use the space character instead of the tab character in the compiled code.
	space_over_tab: false

	options:
		-- The target Lua version to compile the code.
		target: "5.5"

		-- The path to be appended to the `package.path` for the compiler.
		path: ""
```

## Requirements

- `yue` command available in PATH.
- For LuaLS features, install `lua-language-server`: [LuaLS Install Guide](https://luals.github.io/#install)

## Extension Settings

- `yuescript.luaLS.executablePath`: optional explicit path to `lua-language-server` (leave empty for auto-detection).
- `yuescript.luaLS.parameters`: optional extra command line args passed to LuaLS.

## LuaLS Enable Conditions

LuaLS analysis for a Yue file is enabled only when all of the following are true in `yueconfig.yue`:

- `build: true`
- `reserve_line_number: true`
- `reserve_comment: true`

## Known Issues

- Some word tokens may be colored incorrectly.
