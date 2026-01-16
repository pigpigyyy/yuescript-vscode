<center>

# Yuescript

###### (yuescript-vscode)

<img src="images/icon.png" width=128 height=128>

![Last Commit](https://img.shields.io/github/last-commit/pigpigyyy/yuescript-vscode?style=flat-square)
![Repo Size](https://img.shields.io/github/repo-size/pigpigyyy/yuescript-vscode?style=flat-square)
![Repo Stars](https://img.shields.io/github/stars/pigpigyyy/yuescript-vscode?style=flat-square)

A `VSCode` extension for [`Yuescript`](https://github.com/pigpigyyy/yuescript-vscode.git)

[read the documentation here 🔗](https://yuescript.org/)

</center>

## Features

- Provides **syntax-highlighting** and **snippets** for `Yuescript`.
- Supports loading `yueconfig.yue` file from the workspace as the compilation configuration file.
- Automatic build to `.lua` file on save (when enabled in configuration).

## Configuration

The extension supports loading a `yueconfig.yue` file from your workspace. This file allows you to configure how the extension compiles your Yuescript code. Create a `yueconfig.yue` file in your workspace with the following format:

```moonscript
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

	-- Whether the compiler should use the space character instead of the tab character in the compiled code.
	space_over_tab: false

	options:
		-- The target Lua version to compile the code.
		target: "5.5"

		-- The path to be appended to the `package.path` for the compiler.
		path: ""
```

## Requirements

- None.

## Extension Settings

- None yet.

## Known Issues

- Some word tokens may be colored incorrectly.