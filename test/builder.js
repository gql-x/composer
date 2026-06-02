import assert from "node:assert";
import { module } from "./runner.js";
import { createComposer, } from "@gql-x/composer";

export const test = module("builder");

var {
	raw,
	query,
	mutation,
	subscription,
	$f,
	$t,
	$v,
	$m,
	varArgs,
	litArgs,
	varDefs,
	selectionSet,
	root,
	operationName,
} = createComposer();

function normalize(str) {
	return str.replace(/\s+/g, " ").trim();
}

test("operationName null omits name when no var defs", () => {
	var { text, opName, } = query(
		operationName(null),
		root("User")
	);
	assert.equal(opName, null);
	assert.ok(text.startsWith("query {"));
});

test("raw.kind mutation", () => {
	var { text, } = raw({
		kind: "mutation",
		root: { field: "User" }
	});
	assert.ok(normalize(text).startsWith("mutation { User"));
});

test("operationName null falls back to Query when var defs present", () => {
	var { text, opName, } = query(
		operationName(null),
		root("User"),
		varDefs($v("foo","String"))
	);
	assert.equal(opName, "Query");
	assert.ok(text.startsWith("query Query("));
});

test("operationName null falls back to Mutation for mutation kind", () => {
	var { text, opName, } = mutation(
		operationName(null),
		root("User"),
		varDefs($v("foo","String"))
	);
	assert.equal(opName, "Mutation");
	assert.ok(text.startsWith("mutation Mutation("));
});

test("varArgs renders variable args", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varArgs($v("limit","limitCount","Int"))
	);
	assert.ok(text.startsWith("query User($limitCount:Int) {"));
	assert.ok(text.includes("User(limit:$limitCount)"));
});

test("varDefs adds variable to parameter list without arg position", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varDefs($v("sinceDate","DateTime"))
	);
	assert.ok(text.startsWith("query User($sinceDate:DateTime) {"));
	assert.ok(!text.includes("sinceDate:$sinceDate"));
});

test("litArgs renders literal arg", () => {
	var { text, } = raw(
		root("User"),
		litArgs($m("limit",50))
	);
	assert.ok(text.includes("User(limit:50)"));
});

test("varArgs 2-arg form", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varArgs($v("limit","Int"))
	);
	assert.ok(text.startsWith("query User($limit:Int) {"));
	assert.ok(text.includes("User(limit:$limit)"));
});

test("root with alias", () => {
	var { text, resName, } = raw(
		operationName(null),
		root("User","Account")
	);
	assert.equal(resName, "Account");
	assert.ok(text.includes("Account: User"));
});

test("$t bare token in litArgs renders without quotes", () => {
	var { text, } = raw(
		root("User"),
		litArgs($m("order",$m("createdAt",$t.DESC)))
	);
	assert.ok(text.includes("User(order:{createdAt:DESC})"));
});

test("$v.varName manual variable reference in litArgs", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varDefs($v("limitCount","Int")),
		litArgs($m("limit",$v.limitCount))
	);
	assert.ok(text.startsWith("query User($limitCount:Int) {"));
	assert.ok(text.includes(`User(limit:$limitCount`));
});

test("selectionSet renders string fields", () => {
	var { text, } = raw(
		root("User"),
		selectionSet("username","createdAt")
	);
	assert.ok(normalize(text).includes("{ username createdAt }"));
});

test("selectionSet $f alias", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$f`ownerEmail``email`
		)
	);
	assert.ok(normalize(text).includes("{ ownerEmail: email }"));
});

test("selectionSet null omits block", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		selectionSet($f.noSelection)
	);
	assert.ok(normalize(text).includes("query User { User }"));
});

test("$f field-level litArgs renders correctly", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			$m(
				$f`books ${litArgs($m("limit",10))}`,
				[ "title" ]
			)
		)
	);
	assert.ok(normalize(text).includes("User { books(limit:10) { title } }"));
});

test("$f field-level varArgs hoists var def", () => {
	var { text, } = query(
		root("User"),
		selectionSet(
			$m(
				$f`books ${varArgs($v("limit","Int"))}`,
				[ "title" ]
			)
		)
	);
	assert.ok(text.startsWith("query Query($limit:Int) {"));
	assert.ok(normalize(text).includes("User { books(limit:$limit) { title } }"));
});

test("selectionSet legacy string-key sub-selection", () => {
	var { text, } = raw(
		root("User"),
		selectionSet(
			{ books: [ "title", "author" ] }
		)
	);
	assert.ok(normalize(text).includes("User { books { title author } }"));
});

test("variable deduplication across operation and field level", () => {
	var { text, } = query(
		root("User"),
		varArgs($v("limit","limitCount","Int")),
		selectionSet(
			$m(
				$f`books ${
					varArgs($v("limit","limitCount","Int"))
				}`,
				[ "title" ]
			)
		)
	);
	assert.ok(text.startsWith("query Query($limitCount:Int) {"));
	assert.ok(normalize(text).includes("User(limit:$limitCount) { books(limit:$limitCount) { title } }"));
});

test("normalizeType handles array type [String]", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varArgs($v("tags","[String]"))
	);
	assert.ok(text.startsWith("query User($tags:[String]) {"));
	assert.ok(normalize(text).includes("User(tags:$tags)"));
});

test("normalizeType handles required type Int!", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varArgs($v("limit","limitCount","Int!"))
	);
	assert.ok(text.startsWith("query User($limitCount:Int!) {"));
	assert.ok(normalize(text).includes("User(limit:$limitCount)"));
});

test("normalizeType handles array type [String!]!", () => {
	var { text, } = query(
		operationName("User"),
		root("User"),
		varArgs($v("tags","[String!]!"))
	);
	assert.ok(text.startsWith("query User($tags:[String!]!) {"));
	assert.ok(normalize(text).includes("User(tags:$tags)"));
});

test("renderLitValue array form in litArgs", () => {
	var { text, } = raw(
		operationName("Get"),
		root("User"),
		litArgs($m("ids",["abc","def","ghi"]))
	);
	assert.ok(text.includes(`User(ids:["abc","def","ghi"])`));
});

test("$f tagged more than twice throws", () => {
	assert.throws(() => {
		$f`alias``field``another`;
	});
});

test("$f interpolation must come after name throws", () => {
	assert.throws(() => {
		var obj = {};
		$f`name ${obj} extra`;
	});
});


// ************************
// $f — function-call mode (parity with tag form)
// ************************

test("$f() parity: alias only", () => {
	var tagQuery = raw(
		root("User"),
		selectionSet($f`ownerEmail``email`)
	);
	var fnQuery = raw(
		root("User"),
		selectionSet($f("ownerEmail","email"))
	);
	assert.equal(fnQuery.text, tagQuery.text);
});

test("$f() parity: alias + field + varArgs", () => {
	var tagQuery = raw(
		root("User"),
		selectionSet($f`myPosts``posts ${varArgs($v("limit","limitCount","Int"))}`)
	);
	var fnQuery = raw(
		root("User"),
		selectionSet($f("myPosts","posts",varArgs($v("limit","limitCount","Int"))))
	);
	assert.equal(fnQuery.text, tagQuery.text);
});

test("$f() parity: computed property key with sub-selection", () => {
	var tagQuery = raw(
		root("User"),
		selectionSet({
			[$f`myPosts``posts ${varArgs($v("limit","limitCount","Int"))}`]: [ "title", "publishedAt" ]
		})
	);
	var fnQuery = raw(
		root("User"),
		selectionSet({
			[$f("myPosts","posts",varArgs($v("limit","limitCount","Int")))]: [ "title", "publishedAt" ]
		})
	);
	assert.equal(fnQuery.text, tagQuery.text);
});

test("$f() parity: via $m with sub-selection", () => {
	var tagQuery = raw(
		root("User"),
		selectionSet(
			$m($f`myPosts``posts ${varArgs($v("limit","limitCount","Int"))}`,[ "title", "publishedAt" ])
		)
	);
	var fnQuery = raw(
		root("User"),
		selectionSet(
			$m($f("myPosts","posts",varArgs($v("limit","limitCount","Int"))),[ "title", "publishedAt" ])
		)
	);
	assert.equal(fnQuery.text, tagQuery.text);
});

test("$f() parity: variable deduplication preserved across function-call form", () => {
	var tagQuery = raw(
		operationName("Get"),
		root("User"),
		selectionSet(
			$f`myPosts``posts ${varArgs($v("limit","limitCount","Int"))}`,
			$f`myReplies``replies ${varArgs($v("limit","limitCount","Int"))}`
		)
	);
	var fnQuery = raw(
		operationName("Get"),
		root("User"),
		selectionSet(
			$f("myPosts","posts",varArgs($v("limit","limitCount","Int"))),
			$f("myReplies","replies",varArgs($v("limit","limitCount","Int")))
		)
	);
	assert.equal(fnQuery.text, tagQuery.text);
});

test("invalid GQL name for root field throws", () => {
	assert.throws(() => raw(
		operationName(null),
		root("bad-name")
	));
});

test("$t token accepted as type in $v", () => {
	var { text, } = raw(
		operationName("Get"),
		root("User"),
		varDefs($v("sinceDate",$t.DateTime))
	);
	assert.ok(text.includes("$sinceDate:DateTime"));
});

test("normalizeType does not double-prefix already-prefixed type", () => {
	var { text, } = raw(
		{ namePrefix: "Dev_", },
		operationName("User"),
		root("User"),
		varDefs($v("input","Dev_UserInput"))
	);
	assert.ok(text.includes("$input:Dev_UserInput"));
	assert.ok(!text.includes("Dev_Dev_UserInput"));
});

test("namePrefix applies to non-builtin type in varDefs", () => {
	var { text, } = raw(
		{ namePrefix: "Dev_", },
		operationName("User"),
		root("User"),
		varDefs($v("input","UserInput"))
	);
	assert.ok(text.includes("$input:Dev_UserInput"));
});

test("conflicting type definitions throw", () => {
	assert.throws(() => {
		raw(
			operationName("User"),
			root("User"),
			varArgs($v("limit","limitCount","Int")),
			varDefs($v("limitCount","String"))
		);
	});
});

test("mutation() presets kind:mutation", () => {
	var { kind, text } = mutation(root("User"));
	assert.equal(kind, "mutation");
	assert.ok(text.startsWith("mutation {"));
});

test("subscription() presets kind:subscription", () => {
	var { kind, text } = subscription(root("User"));
	assert.equal(kind, "subscription");
	assert.ok(text.startsWith("subscription {"));
});

test("mutation() kind cannot be overridden by unit", () => {
	var { kind } = mutation(root("User"), { kind: "query" });
	assert.equal(kind, "mutation");
});

test("subscription() falls back to Subscription when var defs present", () => {
	var { text, opName } = subscription(
		root("User"),
		varDefs($v("foo","String"))
	);
	assert.equal(opName, "Subscription");
	assert.ok(text.startsWith("subscription Subscription("));
});
