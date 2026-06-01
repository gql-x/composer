import assert from "node:assert";
import { module } from "./runner.js";
import { createComposer, } from "@gql-x/composer";

export const test = module("type-conditional-selections");

var {
	raw,
	query,
	$f,
	$t,
	$v,
	$m,
	$d,
	varArgs,
	litArgs,
	selectionSet,
	root,
	operationName,
	directives,
} = createComposer();

function normalize(str) {
	return str.replace(/\s+/g, " ").trim();
}


// ************************
// basic rendering — function-call form
// ************************

test("$f.on(type) via $m renders ... on Type { subSel }", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m($f.on("Admin"),[ "permissions" ])
		)
	);
	assert.ok(normalize(text).includes("User { ... on Admin { permissions } }"));
});

test("$f.on(type) via computed property key", () => {
	var { text, } = raw(
		root("User"),
		selectionSet({
			[$f.on("Admin")]: [ "permissions" ]
		})
	);
	assert.ok(normalize(text).includes("User { ... on Admin { permissions } }"));
});

test("$f.on accepts $t token as type name", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m($f.on($t.Admin),[ "permissions" ])
		)
	);
	assert.ok(normalize(text).includes("... on Admin { permissions }"));
});


// ************************
// basic rendering — tag form
// ************************

test("$f.on`Type` tag form parity with function-call form", () => {
	var tagQuery = raw(
		root("User"),
		selectionSet(
			$m($f.on`Admin`,[ "permissions" ])
		)
	);
	var fnQuery = raw(
		root("User"),
		selectionSet(
			$m($f.on("Admin"),[ "permissions" ])
		)
	);
	assert.equal(fnQuery.text, tagQuery.text);
});


// ************************
// directives on inline fragments
// ************************

test("$f.on with single directive (function form)", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m($f.on("Admin",$d.nonreactive),[ "permissions" ])
		)
	);
	assert.ok(normalize(text).includes("... on Admin @nonreactive { permissions }"));
});

test("$f.on with single directive (tag form)", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m($f.on`Admin ${$d.nonreactive}`,[ "permissions" ])
		)
	);
	assert.ok(normalize(text).includes("... on Admin @nonreactive { permissions }"));
});

test("$f.on with multiple directives via directives()", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m(
				$f.on("Admin",directives($d.a,$d.b)),
				[ "permissions" ]
			)
		)
	);
	assert.ok(normalize(text).includes("... on Admin @a @b { permissions }"));
});

test("$f.on directive args hoist var-defs", () => {
	var { text, } = query(
		operationName("Get"),
		root("User"),
		selectionSet(
			$m(
				$f.on("Admin",$d.scoped(varArgs($v("scope","String")))),
				[ "permissions" ]
			)
		)
	);
	assert.ok(text.startsWith("query Get($scope:String) {"));
	assert.ok(normalize(text).includes("... on Admin @scoped(scope:$scope) { permissions }"));
});


// ************************
// nesting and composition
// ************************

test("nested $f.on inside another $f.on", () => {
	var { text, } = raw(
		root("Node"),
		selectionSet(
			$m($f.on("User"),[
				"name",
				$m($f.on("AdminUser"),[ "permissions" ])
			])
		)
	);
	assert.ok(normalize(text).includes(
		"... on User { name ... on AdminUser { permissions } }"
	));
});

test("$f.on alongside regular fields in same selection", () => {
	var { text, } = raw(
		root("Node"),
		selectionSet(
			"id",
			$m($f.on("User"),[ "name" ]),
			"createdAt"
		)
	);
	assert.ok(normalize(text).includes(
		"{ id ... on User { name } createdAt }"
	));
});

test("$f.on alongside another $f.on for sibling type narrowing", () => {
	var { text, } = raw(
		root("Node"),
		selectionSet(
			$m($f.on("User"),[ "name" ]),
			$m($f.on("Post"),[ "title" ])
		)
	);
	assert.ok(normalize(text).includes(
		"{ ... on User { name } ... on Post { title } }"
	));
});


// ************************
// namePrefix integration
// ************************

test("$f.on type name is subject to namePrefix", () => {
	var { text, } = raw(
		{ namePrefix: "Dev_", },
		root("User"),
		selectionSet(
			$m($f.on("Admin"),[ "permissions" ])
		)
	);
	assert.ok(normalize(text).includes("... on Dev_Admin { permissions }"));
});

test("$f.on type name skips prefixing for nonPrefixedTypes", () => {
	var { text, } = raw(
		{ namePrefix: "Dev_", nonPrefixedTypes: [ "Admin" ], },
		root("User"),
		selectionSet(
			$m($f.on("Admin"),[ "permissions" ])
		)
	);
	assert.ok(normalize(text).includes("... on Admin { permissions }"));
	assert.ok(!text.includes("Dev_Admin"));
});


// ************************
// render-time errors
// ************************

test("$f.on at top-level of selection (no sub-selection) throws at render", () => {
	assert.throws(() =>
		raw(
			root("User"),
			selectionSet($f.on("Admin"))
		)
	);
});

test("$f.on as $m key with null sub-selection throws at render", () => {
	assert.throws(() =>
		raw(
			root("User"),
			selectionSet({
				[$f.on("Admin")]: null
			})
		)
	);
});


// ************************
// invalid re-wrap paths
// ************************

test("$f(onToken) throws (cannot re-wrap an inline-type-condition token)", () => {
	var onTok = $f.on("Admin");
	assert.throws(() => $f(onTok));
});

test("$f(alias, onToken) throws (cannot alias an inline-type-condition token)", () => {
	var onTok = $f.on("Admin");
	assert.throws(() => $f("a",onTok));
});

test("$f`alias`(onToken) throws (cannot alias via double-tag form)", () => {
	var onTok = $f.on("Admin");
	assert.throws(() => $f`a`(onTok));
});
