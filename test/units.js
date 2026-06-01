import assert from "node:assert";
import { module } from "./runner.js";
import { createComposer, } from "@gql-x/composer";

export const test = module("units");

var {
	$d, $f, $t, $v, $m,
	varArgs, litArgs,
} = createComposer();


// ************************
// $v
// ************************

test("$v 2-arg form", () => {
	assert.deepEqual(
		$v("docID","ID"),
		{ docID: "ID" }
	);
});

test("$v 3-arg form", () => {
	assert.deepEqual(
		$v("docID","userDocID","ID"),
		{ docID: { userDocID: "ID" } }
	);
});

test("$v compose merges units", () => {
	assert.deepEqual(
		$v(
			$v("foo","String"),
			$v("bar","Int")
		),
		{ foo: "String", bar: "Int" }
	);
});

test("$v with $t token as type", () => {
	assert.deepEqual(
		$v("sinceDate",$t.DateTime),
		{ sinceDate: "DateTime" }
	);
});


// ************************
// $v — errors
// ************************

test("$v() throws with no args", () => {
	assert.throws(() => $v());
});

test("$v() throws with wrong arg types", () => {
	assert.throws(() => $v("foo",42));
});


// ************************
// $m
// ************************

test("$m 2-arg number value", () => {
	assert.deepEqual(
		$m("limit",50),
		{ limit: 50 }
	);
});

test("$m 2-arg string value", () => {
	assert.deepEqual(
		$m("status","active"),
		{ status: "active" }
	);
});

test("$m 2-arg boolean value", () => {
	assert.deepEqual(
		$m("isEnabled",true),
		{ isEnabled: true }
	);
});

test("$m 2-arg null value", () => {
	assert.deepEqual(
		$m("deletedAt",null),
		{ deletedAt: null }
	);
});

test("$m multi-unit siblings merged under key", () => {
	assert.deepEqual(
		$m("order",
			$m("title","asc"),
			$m("year","desc")
		),
		{ order: { title: "asc", year: "desc" } }
	);
});

test("$m nested calls", () => {
	assert.deepEqual(
		$m("order",
			$m("title",
				$m("direction","asc")
			)
		),
		{ order: { title: { direction: "asc" } } }
	);
});


// ************************
// $m — errors
// ************************

test("$m() throws with no args", () => {
	assert.throws(() => $m());
});

test("$m() throws with only name", () => {
	assert.throws(() => $m("foo"));
});

test("$m() throws with mixed unit and non-unit trailing args", () => {
	assert.throws(() => $m("foo",$m("a",1),"notAUnit"));
});


// ************************
// $t
// ************************

test("$t.NAME returns bare-name token", () => {
	var tok = $t.DESC;
	assert.equal(typeof tok, "object");
	assert.equal(String(tok), "DESC");
});

test("$t caches tokens (same identity for same name)", () => {
	assert.equal($t.DESC, $t.DESC);
});

test("$t.$varName returns $-prefixed token", () => {
	var tok = $t.$email;
	assert.equal(String(tok), "$email");
});

test("$t reserved property names return undefined", () => {
	assert.equal($t.then, undefined);
	assert.equal($t.toString, undefined);
	assert.equal($t.constructor, undefined);
});

test("$t invalid GQL name returns undefined", () => {
	assert.equal($t["bad-name"], undefined);
	assert.equal($t["123abc"], undefined);
});

test("$t.$invalid returns undefined", () => {
	assert.equal($t["$bad-name"], undefined);
	assert.equal($t["$123abc"], undefined);
});

test("$t tokens are isolated across composer instances", () => {
	var { $t: $tA, } = createComposer();
	var { $t: $tB, } = createComposer();
	assert.notEqual($tA.DESC, $tB.DESC);
	// but both stringify to the same name
	assert.equal(String($tA.DESC), String($tB.DESC));
});


// ************************
// $f — function-call mode (errors)
// ************************

test("$f() throws with no args", () => {
	assert.throws(() => $f());
});

test("$f() throws with invalid first arg type", () => {
	assert.throws(() => $f(42));
});

test("$f() throws with invalid GQL name", () => {
	assert.throws(() => $f("bad-name"));
});

test("$f() throws with invalid GQL name for field", () => {
	assert.throws(() => $f("alias","bad-name"));
});


// ************************
// $f — tagged template (errors)
// ************************

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
// $f.on — function-call mode (errors)
// ************************

test("$f.on() throws with no args", () => {
	assert.throws(() => $f.on());
});

test("$f.on() throws with invalid first arg type", () => {
	assert.throws(() => $f.on(42));
	assert.throws(() => $f.on(null));
});

test("$f.on() throws with invalid GQL name", () => {
	assert.throws(() => $f.on("bad-name"));
});

test("$f.on() rejects alias form (second string arg)", () => {
	assert.throws(() => $f.on("alias","User"));
});

test("$f.on() rejects field args", () => {
	assert.throws(() => $f.on("User",varArgs($v("x","Int"))));
	assert.throws(() => $f.on("User",litArgs($m("x",1))));
});


// ************************
// $f.on — tagged template (errors)
// ************************

test("$f.on tag form throws on invalid GQL name", () => {
	assert.throws(() => $f.on`bad-name`);
});

test("$f.on tag form rejects field args via interpolation", () => {
	assert.throws(() => $f.on`User ${varArgs($v("x","Int"))}`);
	assert.throws(() => $f.on`User ${litArgs($m("x",1))}`);
});

test("$f.on tag form rejects $f tokens as interpolation", () => {
	assert.throws(() => $f.on`User ${$f`field`}`);
});


// ************************
// $d proxy basics
// ************************

test("$d.name yields a usable directive token", () => {
	var d = $d.nonreactive;
	assert.equal(typeof d, "function");
	assert.equal(typeof d.render, "function");
	assert.ok(Array.isArray(d.directives));
	assert.equal(d.directives.length, 1);
	assert.equal(d.directives[0], d);
});

test("$d.name rejects invalid GQL names", () => {
	assert.equal($d["bad-name"], undefined);
	assert.equal($d[""], undefined);
});

test("$d.name skips reserved/probe names", () => {
	assert.equal($d.then, undefined);
	assert.equal($d.toString, undefined);
	assert.equal($d.constructor, undefined);
	assert.equal($d.render, undefined);
});

test("$d.foo() returns a fresh, distinct clause from bare $d.foo", () => {
	var bare = $d.foo;
	var called = $d.foo();
	assert.notEqual(bare, called);
	assert.equal(typeof called, "function");
	assert.ok(Array.isArray(called.directives));
});

test("directives(..) rejects non-directive-token entries", () => {
	assert.throws(() => directives("foo"));
	assert.throws(() => directives({}));
});

test("root().directives(..) validates entries", () => {
	assert.throws(() => root("User").directives("not-a-directive"));
	assert.throws(() => root("User").directives({}));
});
