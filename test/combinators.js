import assert from "node:assert";
import { module } from "./runner.js";
import { createComposer, } from "@gql-x/composer";

export const test = module("combinators");

var {
	varArgs,
	litArgs,
	varDefs,
	selectionSet,
	root,
	operationName,
	$m,
	$v,
} = createComposer();


// ************************
// varArgs
// ************************

test("varArgs produces { varArgs: ... }", () => {
	assert.deepEqual(
		varArgs($v("docID","ID")),
		{ varArgs: { docID: "ID" } }
	);
});

test("varArgs merges multiple units", () => {
	assert.deepEqual(
		varArgs(
			$v("docID","ID"),
			$v("limit","Int")
		),
		{ varArgs: { docID: "ID", limit: "Int" } }
	);
});


// ************************
// litArgs
// ************************

test("litArgs produces { litArgs: ... }", () => {
	assert.deepEqual(
		litArgs($m("limit",50)),
		{ litArgs: { limit: 50 } }
	);
});

test("litArgs merges multiple units", () => {
	assert.deepEqual(
		litArgs(
			$m("limit",50),
			$m("offset",0)
		),
		{ litArgs: { limit: 50, offset: 0 } }
	);
});


// ************************
// varDefs
// ************************

test("varDefs produces { varDefs: ... }", () => {
	assert.deepEqual(
		varDefs($v("minRating","Int")),
		{ varDefs: { minRating: "Int" } }
	);
});

test("varDefs merges multiple units", () => {
	assert.deepEqual(
		varDefs(
			$v("minRating","Int"),
			$v("maxRating","Int")
		),
		{ varDefs: { minRating: "Int", maxRating: "Int" } }
	);
});


// ************************
// selectionSet
// ************************

test("selectionSet produces { selectionSet: [...] }", () => {
	assert.deepEqual(
		selectionSet("foo","bar"),
		{ selectionSet: [ "foo", "bar" ] }
	);
});

test("selectionSet with single field", () => {
	assert.deepEqual(
		selectionSet("_docID"),
		{ selectionSet: [ "_docID" ] }
	);
});

test("selectionSet with no args produces empty array", () => {
	assert.deepEqual(
		selectionSet(),
		{ selectionSet: [] }
	);
});

test("selectionSet(null) produces null selection", () => {
	assert.deepEqual(
		selectionSet(null),
		{ selectionSet: null }
	);
});

test("selectionSet.none() produces null selection", () => {
	assert.deepEqual(
		selectionSet.none(),
		{ selectionSet: null }
	);
});


// ************************
// root
// ************************

test("root 1-arg form", () => {
	assert.deepEqual(
		root("User"),
		{ root: { field: "User" } }
	);
});

test("root 2-arg form with alias", () => {
	assert.deepEqual(
		root("User","Account"),
		{ root: { field: "User", alias: "Account" } }
	);
});


// ************************
// operationName
// ************************

test("operationName() produces { operationName: .. }", () => {
	assert.deepEqual(
		operationName("GetUser"),
		{ operationName: "GetUser" }
	);
});

test("operationName(null) produces { operationName: null }", () => {
	assert.deepEqual(
		operationName(null),
		{ operationName: null }
	);
});
