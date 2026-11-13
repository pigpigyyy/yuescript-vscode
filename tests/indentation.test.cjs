const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const JSON5 = require('json5');

const configuration = JSON5.parse(readFileSync(`${__dirname}/../language-configuration.json`, 'utf8'));
const rules = configuration.onEnterRules.map(rule => ({
	beforeText: new RegExp(rule.beforeText),
	action: rule.action.indent,
}));

// VS Code takes the first matching onEnterRule; null leaves its bracket fallback active.
function enterAction(line) {
	return rules.find(rule => rule.beforeText.test(line))?.action ?? null;
}

for (const line of [
	'if ready', 'unless ready', 'elseif ready', 'else', 'when 1',
	'for item in *items', 'while ready', 'switch value', 'do', 'repeat',
	'catch err', 'try', 'with object', 'class Example',
	'new: =>', 'callback = ->', '  return ->', '  return =>',
	'for item in *items do', 'if ready then', 'if ready then callback = ->',
	'callback = -> -- body follows', 'do -- body follows',
	'if message == "then ready"', "if message == 'do work'",
	'with {value: "do work"}', 'if message == "escaped \\" then ready"',
	'if ready -- then work!', 'if ready then -- body follows',
	'if ready -- ->', 'if ready -- =>',
	'  return if ready', '  return unless ready', '  return switch value',
	'  return with object', '  return do',
]) {
	test(`indent: ${line}`, () => assert.equal(enterAction(line), 'indent'));
}

for (const line of [
	'if ready then work!', 'unless ready then work!',
	'for item in *items do print item', 'do print "hello"',
	'if ready then print "do"', 'if ready then print "=>"',
	'if ready then work! -- ->', 'return if ready then 1 else 2',
]) {
	test(`inline statement: ${line}`, () => assert.equal(enterAction(line), 'none'));
}

for (const line of ['return', '  return ', '\tbreak', '  continue', 'return -- done', 'break -- done']) {
	test(`outdent: ${line}`, () => assert.equal(enterAction(line), 'outdent'));
}

for (const line of [
	'until ready', 'until ready -- finished', 'value = undo', 'undo = 1',
	'if_ready = true', 'className = "Example"',
	'return value', 'return {', 'return {value: 1}', 'return [', 'return (',
	'print "then work"', 'value = "do"', 'value = "=>"', 'value = "->"',
	'-- do', '-- then work', '-- ->',
]) {
	test(`keep default indentation: ${line}`, () => assert.equal(enterAction(line), null));
}

test('return tables preserve VS Code bracket fallback', () => {
	assert.equal(enterAction('  return {'), null);
	assert.ok(configuration.brackets.some(([open, close]) => open === '{' && close === '}'));
});

test('angle brackets surround selections without auto-closing comparisons', () => {
	assert.ok(!configuration.autoClosingPairs.some(([open]) => open === '<'));
	assert.ok(configuration.surroundingPairs.some(([open, close]) => open === '<' && close === '>'));
});
