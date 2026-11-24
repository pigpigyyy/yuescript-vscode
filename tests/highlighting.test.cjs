const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { before, test } = require('node:test');
const path = require('node:path');
const JSON5 = require('json5');
const { Registry, INITIAL } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');

let grammar;
before(async () => {
	await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
	const source = JSON5.parse(readFileSync(path.join(__dirname, '../syntaxes/yuescript.tmLanguage.json5'), 'utf8'));
	const registry = new Registry({
		onigLib: Promise.resolve({
			createOnigScanner: patterns => new OnigScanner(patterns),
			createOnigString: text => new OnigString(text),
		}),
		loadGrammar: async scope => scope === 'source.yue' ? source : null,
	});
	grammar = await registry.loadGrammar('source.yue');
});

function tokenize(line) {
	const result = grammar.tokenizeLine(line, INITIAL);
	assert.ok(!result.stoppedEarly, 'tokenization should finish');
	const following = grammar.tokenizeLine('sentinel = 1', result.ruleStack);
	assert.ok(following.tokens.every(token => !token.scopes.includes('meta.inline.function.yue') &&
		!token.scopes.includes('meta.parameter.default.yue')), 'single-line function must not leak into following lines');
	return result.tokens;
}

function hasScope(tokens, line, text, scope, occurrence = 0) {
	let start = -1;
	for (let i = 0; i <= occurrence; i++) start = line.indexOf(text, start + 1);
	assert.ok(start >= 0, `missing fixture text: ${text}`);
	return tokens.filter(token => token.startIndex < start + text.length && token.endIndex > start)
		.every(token => token.scopes.includes(scope));
}

for (const arrow of ['->', '=>']) {
	test(`parameters, member parameters, commas, and defaults: ${arrow}`, () => {
		const line = `f = (first, @member, count = 42, ready = true, label = "hello") ${arrow}`;
		const tokens = tokenize(line);
		for (const name of ['first', 'count', 'ready', 'label']) {
			assert.ok(hasScope(tokens, line, name, 'variable.parameter.function.yue'), name);
		}
		assert.ok(hasScope(tokens, line, '@member', 'entity.other.attribute-name.yue'));
		assert.ok(hasScope(tokens, line, '42', 'constant.numeric.yue'));
		assert.ok(hasScope(tokens, line, 'true', 'constant.language.boolean.yue'));
		assert.ok(hasScope(tokens, line, 'hello', 'string.quoted.double.yue'));
		assert.ok(hasScope(tokens, line, arrow, 'storage.type.function.yue'));
		for (const token of tokens.filter(token => line.slice(token.startIndex, token.endIndex).includes(','))) {
			assert.ok(token.scopes.includes('keyword.operator.yue'), 'commas retain operator highlighting');
			assert.ok(!token.scopes.includes('variable.parameter.function.yue'));
		}
	});

	test(`parameterless function arrow: ${arrow}`, () => {
		const line = `f = ${arrow}`;
		assert.ok(hasScope(tokenize(line), line, arrow, 'storage.type.function.yue'));
	});
}

test('an inner lambda does not turn outer call arguments into parameters', () => {
	const line = 'outer(inner(foo, bar, ((biz) -> biz), baz))';
	const tokens = tokenize(line);
	assert.ok(hasScope(tokens, line, 'biz', 'variable.parameter.function.yue'));
	for (const name of ['inner', 'foo', 'bar', 'baz']) {
		assert.ok(!hasScope(tokens, line, name, 'variable.parameter.function.yue'), name);
		assert.ok(!hasScope(tokens, line, name, 'meta.inline.function.yue'), name);
	}
	assert.ok(!hasScope(tokens, line, 'biz', 'variable.parameter.function.yue', 1));
});

for (const value of [
	'factory(one, two)', '{one, two}', '[one, two]',
	'factory({items: [one, two]}, other)', '(one + (two * 3))',
	'"a, ) -> b"', "'a, ) => b'", '[=[a, ) -> b]=]',
	'((inner, @other = 2) -> inner)',
]) {
	test(`nested default expression: ${value}`, () => {
		const line = `f = (value = ${value}, next = 2) ->`;
		const tokens = tokenize(line);
		assert.ok(hasScope(tokens, line, 'value', 'variable.parameter.function.yue'));
		assert.ok(hasScope(tokens, line, 'next', 'variable.parameter.function.yue'));
		for (const name of ['one', 'two', 'factory']) {
			if (value.includes(name)) assert.ok(!hasScope(tokens, line, name, 'variable.parameter.function.yue'), name);
		}
	});
}

test('bare arrows inside strings and comments retain their lexical scopes', () => {
	for (const [line, scope] of [
		['text = "-> =>"', 'string.quoted.double.yue'],
		['text = [=[-> =>]=]', 'string.quoted.other.multiline.yue'],
		['-- -> =>', 'comment.line.yue'],
	]) {
		for (const arrow of ['->', '=>']) assert.ok(hasScope(tokenize(line), line, arrow, scope));
	}
});

test('deep nested defaults finish without leaking parameter scopes', () => {
	const line = `f = (value = ${'('.repeat(8)}source${')'.repeat(8)}, next = 2) ->`;
	const tokens = tokenize(line);
	assert.ok(hasScope(tokens, line, 'value', 'variable.parameter.function.yue'));
	assert.ok(hasScope(tokens, line, 'next', 'variable.parameter.function.yue'));
	assert.ok(!hasScope(tokens, line, 'source', 'variable.parameter.function.yue'));
});
