const assert = require('node:assert/strict');
const vscode = require('vscode');

// Exercise actual Enter handling, including VS Code's bracket fallback and rule ordering.
exports.run = async function () {
	await vscode.workspace.getConfiguration('editor').update('autoIndent', 'full', vscode.ConfigurationTarget.Global);
	const cases = [
		['if ready', '', '  '],
		['unless ready', '', '  '],
		['new: =>', '', '  '],
		['callback = -> -- body follows', '', '  '],
		['if message == "then ready"', '', '  '],
		['with {value: "do work"}', '', '  '],
		['if ready -- then work!', '', '  '],
		['if ready then -- body follows', '', '  '],
		['if ready then work!', '', ''],
		['if ready then print "=>"', '', ''],
		['value = undo', '', ''],
		['repeat\n  work!\nuntil ready', '', ''],
		['make = ->\n  return if ready', '', '    '],
		['make = ->\n  return {', '', '    '],
		['make = ->\n  return {', '}', '    \n  }'],
		['make = ->\n  return {value: 1}', '', '  '],
		['make = ->\n  return', '', ''],
	];
	for (const [before, after, expected] of cases) {
		const document = await vscode.workspace.openTextDocument({ language: 'yuescript', content: before + after });
		const editor = await vscode.window.showTextDocument(document);
		editor.options = { insertSpaces: true, tabSize: 2, indentSize: 2 };
		const position = document.positionAt(before.length);
		editor.selection = new vscode.Selection(position, position);
		await vscode.commands.executeCommand('type', { text: '\n' });
		assert.equal(document.getText(), before + '\n' + expected, `Enter after ${JSON.stringify(before)} before ${JSON.stringify(after)}`);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	}
	console.log(`Passed ${cases.length} real-editor indentation cases.`);
};
