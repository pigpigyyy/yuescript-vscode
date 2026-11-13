const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const profile = mkdtempSync(path.join(tmpdir(), 'yuescript-editor-tests-'));
runTests({
	// Set this to use an installed editor; otherwise test-electron downloads VS Code.
	vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
	extensionDevelopmentPath: path.resolve(__dirname, '..'),
	extensionTestsPath: path.resolve(__dirname, 'editor/indentation.cjs'),
	launchArgs: ['--user-data-dir', profile, '--extensions-dir', path.join(profile, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
}).catch(error => {
	console.error(error);
	process.exitCode = 1;
});
