import assert from "node:assert";
import { module } from "./runner.js";
import { createComposer, } from "@gql-x/composer";

export const test = module("gql-directives");

var {
	raw,
	query,
	mutation,
	subscription,
	$f,
	$t,
	$v,
	$m,
	$d,
	varArgs,
	litArgs,
	varDefs,
	selectionSet,
	root,
	operationName,
	directives,
} = createComposer();

function normalize(str) {
	return str.replace(/\s+/g, " ").trim();
}


// ************************
// field-level directives (selection set)
// ************************

test("bare $d.foo on a selection field renders @foo with no args", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`email ${$d.nonreactive}`
		)
	);
	assert.ok(normalize(text).includes("{ email @nonreactive }"));
});

test("$d.foo(litArgs) on a selection field renders @foo with literal args", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`email ${$d.format(litArgs($m("style","short")))}`
		)
	);
	assert.ok(normalize(text).includes(`{ email @format(style:"short") }`));
});

test("$d.foo(varArgs) hoists vars into operation var-defs", () => {
	var { text, } = query(
		operationName("Get"),
		root("User"),
		selectionSet(
			$f`email ${$d.scoped(varArgs($v("scope","String")))}`
		)
	);
	assert.ok(text.startsWith("query Get($scope:String) {"));
	assert.ok(normalize(text).includes("{ email @scoped(scope:$scope) }"));
});

test("$d.foo(varArgs,litArgs) combines var and lit args", () => {
	var { text, } = query(
		operationName("Get"),
		root("User"),
		selectionSet(
			$f`email ${$d.fancy(
				varArgs($v("scope","String")),
				litArgs($m("format","short"))
			)}`
		)
	);
	assert.ok(text.startsWith("query Get($scope:String) {"));
	assert.ok(normalize(text).includes(`{ email @fancy(scope:$scope,format:"short") }`));
});

test("multiple directives on one field via directives(..) combinator", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`email ${[
				directives($d.nonreactive, $d.format(litArgs($m("style","short")))),
			]}`
		)
	);
	assert.ok(normalize(text).includes(`{ email @nonreactive @format(style:"short") }`));
});

test("directives render in source order within the combinator", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`email ${[
				directives($d.a, $d.b, $d.c),
			]}`
		)
	);
	assert.ok(normalize(text).includes("{ email @a @b @c }"));
});

test("directives coexist with field args (args before directives)", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`books ${[
				litArgs($m("limit",10)),
				$d.nonreactive,
			]}`
		)
	);
	assert.ok(normalize(text).includes("{ books(limit:10) @nonreactive }"));
});

test("directives coexist with sub-selection (directives before selection block)", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m(
				$f`books ${$d.nonreactive}`,
				[ "title" ]
			)
		)
	);
	assert.ok(normalize(text).includes("{ books @nonreactive { title } }"));
});

test("directives + args + sub-selection together", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m(
				$f`books ${[
					litArgs($m("limit",10)),
					$d.nonreactive,
				]}`,
				[ "title" ]
			)
		)
	);
	assert.ok(normalize(text).includes("{ books(limit:10) @nonreactive { title } }"));
});

test("@skip / @include go through the generic proxy (no special sugar)", () => {
	var { text, } = query(
		operationName("Get"),
		root("User"),
		selectionSet(
			$f`email ${$d.skip(litArgs($m("if",true)))}`,
			$f`name ${$d.include(litArgs($m("if",false)))}`,
		)
	);
	assert.ok(normalize(text).includes("{ email @skip(if:true) name @include(if:false) }"));
});

test("directive on aliased field via double-tag form", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`ownerEmail``email ${$d.nonreactive}`
		)
	);
	assert.ok(normalize(text).includes("{ ownerEmail: email @nonreactive }"));
});

test("empty varArgs/litArgs on directive collapses to bare @name", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`email ${$d.nonreactive(litArgs())}`
		)
	);
	assert.ok(normalize(text).includes("{ email @nonreactive }"));
});


// ************************
// directives() combinator validation
// ************************

test("directives() with zero entries renders nothing on a field", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`email ${[ directives(), ]}`
		)
	);
	assert.ok(normalize(text).includes("{ email }"));
});


// ************************
// operation-level directives (top-level)
// ************************

test("top-level directives(..) attach to the operation", () => {
	var { text, } = query(
		operationName("Get"),
		directives($d.cached),
		root("User"),
	);
	assert.ok(text.startsWith("query Get @cached {"));
});

test("operation directives with args", () => {
	var { text, } = query(
		operationName("Get"),
		directives($d.cached(litArgs($m("ttl",60)))),
		root("User"),
	);
	assert.ok(text.startsWith("query Get @cached(ttl:60) {"));
});

test("operation directives sit AFTER var-defs", () => {
	var { text, } = query(
		operationName("Get"),
		directives($d.cached),
		root("User"),
		varArgs($v("limit","Int")),
	);
	assert.ok(text.startsWith("query Get($limit:Int) @cached {"));
});

test("operation directive vars hoist into var-defs", () => {
	var { text, } = query(
		operationName("Get"),
		directives($d.cached(varArgs($v("ttl","Int")))),
		root("User"),
	);
	assert.ok(text.startsWith("query Get($ttl:Int) @cached(ttl:$ttl) {"));
});

test("multiple operation directives", () => {
	var { text, } = query(
		operationName("Get"),
		directives($d.a, $d.b(litArgs($m("x",1)))),
		root("User"),
	);
	assert.ok(text.startsWith("query Get @a @b(x:1) {"));
});

test("operation directive triggers fallback opName when none set", () => {
	var { text, opName, } = query(
		directives($d.cached(varArgs($v("ttl","Int")))),
		root("User"),
	);
	// var hoist forces fallback operationName
	assert.equal(opName, "Query");
	assert.ok(text.startsWith("query Query($ttl:Int) @cached(ttl:$ttl) {"));
});


// ************************
// root-field directives (root().directives(..))
// ************************

test("root().directives(..) attaches directives to the root field", () => {
	var { text, } = query(
		operationName("Get"),
		root("User").directives($d.nonreactive),
	);
	assert.ok(normalize(text).includes("query Get { User @nonreactive"));
});

test("root().directives(..) renders BETWEEN args and selection on root", () => {
	var { text, } = query(
		operationName("Get"),
		root("User").directives($d.nonreactive),
		varArgs($v("limit","Int")),
		selectionSet("username"),
	);
	assert.ok(text.startsWith("query Get($limit:Int) {"));
	assert.ok(normalize(text).includes("User(limit:$limit) @nonreactive { username }"));
});

test("root().directives(..) with multiple directives", () => {
	var { text, } = query(
		operationName("Get"),
		root("User").directives($d.a, $d.b),
	);
	assert.ok(normalize(text).includes("query Get { User @a @b"));
});

test("root().directives(..) directive args hoist vars", () => {
	var { text, } = query(
		operationName("Get"),
		root("User").directives($d.cached(varArgs($v("ttl","Int")))),
	);
	assert.ok(text.startsWith("query Get($ttl:Int) {"));
	assert.ok(normalize(text).includes("User @cached(ttl:$ttl)"));
});

test("root() and root().directives() with alias", () => {
	var { text, resName, } = query(
		operationName("Get"),
		root("User","Account").directives($d.nonreactive),
	);
	assert.equal(resName, "Account");
	assert.ok(normalize(text).includes("Account: User @nonreactive"));
});


// ************************
// all three positions together
// ************************

test("operation + root + field directives all coexist", () => {
	var { text, } = query(
		operationName("Get"),
		directives($d.cached),
		root("User").directives($d.nonreactive),
		selectionSet(
			$f`email ${$d.format(litArgs($m("style","short")))}`,
		),
	);
	var n = normalize(text);
	assert.ok(text.startsWith("query Get @cached {"));
	assert.ok(n.includes("User @nonreactive {"));
	assert.ok(n.includes(`email @format(style:"short")`));
});
