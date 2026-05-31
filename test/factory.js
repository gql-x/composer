import assert from "node:assert";
import { module } from "./runner.js";
import { createComposer, registerPlugin, isGQLName, } from "@gql-x/composer";

export const test = module("factory");


// ************************
// createComposer()
// ************************

test("createComposer() returns the public api surface", () => {
	var composer = createComposer();
	assert.deepEqual(
		Object.keys(composer).sort(),
		[
			"$d", "$f", "$m", "$t", "$v", "directives",
			"isGQLName", "litArgs", "mutation",
			"operationName", "query", "raw", "root",
			"selectionSet", "subscription",	"varArgs",
			"varDefs",
		]
	);
});

test("createComposer() does not expose _internals", () => {
	var composer = createComposer();
	assert.equal(composer._internals, undefined);
	assert.equal(composer.makeFieldToken, undefined);
	assert.equal(composer.$fMeta, undefined);
});


// ************************
// registerPlugin()
// ************************

test("registerPlugin() returns { api, _internals }", () => {
	var reg = registerPlugin();
	assert.ok(!!reg.api, "has api");
	assert.ok(!!reg._internals, "has _internals");
});

test("registerPlugin().api matches createComposer() shape", () => {
	var fromCreate = createComposer();
	var { api, } = registerPlugin();
	assert.deepEqual(
		Object.keys(api).sort(),
		Object.keys(fromCreate).sort()
	);
});

test("registerPlugin()._internals exposes plugin hooks", () => {
	var { _internals, } = registerPlugin();
	assert.equal(typeof _internals.makeFieldToken, "function");
	assert.equal(typeof _internals.is$fToken, "function");
	assert.equal(typeof _internals.get$fSymbol, "function");
	assert.equal(typeof _internals.nameToken, "function");
	assert.equal(typeof _internals.is$tToken, "function");
	assert.equal(typeof _internals.get$tTokenName, "function");
	assert.ok(_internals.$fMeta instanceof WeakMap);
});

test("registerPlugin() accepts opts without throwing", () => {
	assert.doesNotThrow(() => registerPlugin({}));
	assert.doesNotThrow(() => registerPlugin({ unknownFutureOpt: true }));
});


// ************************
// composer instance isolation
// ************************

test("two createComposer() calls produce independent instances", () => {
	var a = createComposer();
	var b = createComposer();
	assert.notEqual(a.$f, b.$f);
	assert.notEqual(a.$t, b.$t);
	assert.notEqual(a.raw, b.raw);
});

test("$f tokens minted by one composer are unknown to another", () => {
	var { api: apiA, _internals: _internalsA, } = registerPlugin();
	var { api: apiB, _internals: _internalsB, } = registerPlugin();

	var tokA = apiA.$f`field`;
	var symA = tokA[Symbol.toPrimitive]("default");

	// the symbol is registered in A's $fMeta, not B's
	assert.ok(_internalsA.$fMeta.has(symA));
	assert.ok(!_internalsB.$fMeta.has(symA));
});

test("$t tokens are not shared across composer instances", () => {
	var a = createComposer();
	var b = createComposer();
	assert.notEqual(a.$t.DESC, b.$t.DESC);
	assert.equal(String(a.$t.DESC), String(b.$t.DESC));
});


// ************************
// module-level isGQLName
// ************************

test("isGQLName exported at module level", () => {
	assert.equal(typeof isGQLName, "function");
	assert.equal(isGQLName("valid_name1"), true);
	assert.equal(isGQLName("123abc"), false);
	assert.equal(isGQLName("bad-name"), false);
	assert.equal(isGQLName(""), false);
});

test("isGQLName on composer api matches module-level", () => {
	var composer = createComposer();
	assert.equal(composer.isGQLName, isGQLName);
});
