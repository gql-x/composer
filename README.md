# @gql-x/composer

A DSL for composing GraphQL query strings with nicer DX.

`@gql-x/composer` is a general-purpose GraphQL query composer: it produces plain, spec-compliant GraphQL text suitable for any GraphQL endpoint, any client transport, any tooling.

Think of it as a spiritual successor to the older [`gql-query-builder`](https://www.npmjs.com/package/gql-query-builder) package; it solves the same problem (building GraphQL queries from host-language values rather than templated strings), but with better ergonomics around variable hoisting, dynamic composition, and field-level expressivity. None of the code or API is ported or shared; the kinship is in problem space and motivation, not in implementation.

For usage examples across the DSL's surface, see [EXAMPLES.md](./EXAMPLES.md). For design rationale and tradeoffs, see [DESIGN.md](./DESIGN.md). For details on the extension points composer exposes for building higher-level layers on top of it, see [EXTENSIBILITY.md](./EXTENSIBILITY.md).

## Design Overview

Three primary goals motivate the design:

1. **Reduce variable bookkeeping.** Annotate a variable's type at its use site; the builder hoists the declaration into the operation's parameter list and deduplicates automatically.

2. **First-class dynamic composition.** Query units/clauses (arguments, selection-sets, etc) are plain JS values that can be conditionally included, named, passed around, and combined using ordinary host-language logic. No string templating, no parameter-list maintenance.

    GraphQL itself offers some in-language mechanisms for varying what a query expresses: variables, named fragments, inline type conditions, and the `@skip` / `@include` directives. These cover value parameterization, reference reuse, and type-narrowing well, but none of them address shape assembly from host-side conditions: queries whose selection-sets, arguments, or sub-selections depend on user input, feature flags, or permissions. That gap is where Composer is meant to fit. For the longer argument, see [On GraphQL's Native Composition Mechanisms](./DESIGN.md#on-graphqls-native-composition-mechanisms).

3. **Meaning is conveyed by explicit names (`selectionSet`, `varArgs`, `litArgs`) rather than syntactic position.** This trades raw-GraphQL positional convention for label-driven composition that can be reordered to foreground whatever matters most about a given query.

For an in-depth explanation of the design, see [DESIGN.md](./DESIGN.md).

## Getting Started

Composer is a factory-producing module: each call to `createComposer()` returns its own independent instance with its own closure-private state (token symbols, internal WeakMaps, caches).

```js
import { createComposer } from "@gql-x/composer";

var {
    $d, $f, $t, $v, $m,
    varArgs, litArgs, varDefs, directives,
    selectionSet, root, operationName,
    raw, query, mutation, subscription,
    isGQLName,
} = createComposer();
```

**NOTE:** All the destructured API methods shown above are bound to that instance of the Composer, and *cannot* safely be mixed with helpers from other Composer instances. Generally, though, you'll only create one Composer instance in your application.

```js
// minimal: just the builder + the bits used in the simplest query
var { query, root, selectionSet } = createComposer();

query(
    root("ping"),
    selectionSet("ok")
)
// {
//    text: "query { ping { ok } }",
//    kind: "query",
//    opName: null,
//    resName: "ping"
// }
```

## At a Glance

Consider a typical GraphQL query like the one below; fetching a user by ID with a date-bounded sub-selection of recent posts:

```graphql
query GetUser(
    $userID: ID,
    $sinceTS: Int
) {
    user(id: $userID) {
        firstName
        lastName
        recentPosts: posts(since: $sinceTS) {
            title
            publishedAt
        }
    }
}
```

A few things stand out as friction:

* **Variable duplication.** `$userID` is declared once but its definition (`$userID: ID`) lives far away from its use site. Same for `$sinceTS`.

* **Sigil bookkeeping.** Every variable carries a `$` everywhere it appears. Easy to typo, easy to forget.

* **Nesting tax.** Field aliases, field-level arguments, and sub-selections each have their own syntactic shape to remember.

Here's the Composer equivalent:

```js
query(
    operationName("GetUser"),
    root("user"),
    varArgs($v("id","userID","ID")),
    selectionSet(
        "firstName",
        "lastName",
        $m(
            $f`recentPosts``posts ${
                varArgs($v("since","sinceTS","Int"))
            }`,
            [ "title", "publishedAt" ]
        )
    )
)
```

Variables are declared inline where used, then hoisted into the parameter list (and de-duplicated/de-conflicted) by the builder (`raw()`, `query()`, etc), so you never have to type both a separate parameter declaration and the use-site reference.

For more examples across the DSL's surface -- variables, literal arguments, sub-selections, aliasing, directives, type-conditional selections, and dynamic composition patterns -- see [EXAMPLES.md](./EXAMPLES.md).

## Fluent Helpers vs. Object Literal Forms

Composer provides two families of helpers, and both produce plain JS object structures that the query-builder consumes:

1. **Option-key combinators** like `varArgs(..)`, `litArgs(..)`, `varDefs(..)`, `selectionSet(..)`, `root(..)`. Each produces a single-property object keyed by its option name. They're passed as variadic arguments to a builder (`raw(..)`, `query(..)`, etc).

    In other words, `varArgs(..)` produces `{ varArgs: .. }`.

2. **Unit-producing helpers** like `$v(..)`, `$m(..)`, `` $f`...` ``. They produce structural object units for the inside of those options.

    In other words, `$m(..)` produces `{ field: value }`.

Both families are pure object-shape sugar. Every helper has an equivalent object literal form, and the query-builder accepts either form interchangeably.

```js
// helper form (recommended)
raw(
    root("user"),
    varArgs($v("id","ID")),
    selectionSet("firstName","lastName")
)

// object literal form (also accepted)
raw({
    root: { field: "user" },
    varArgs: { id: "ID" },
    selectionSet: [ "firstName", "lastName" ]
})

// mixed (also accepted)
raw(
    root("user"),
    varArgs({ id: "ID" }),
    { selectionSet: [ "firstName", "lastName" ] }
)
```

The object literal forms are the base. The helpers exist as sugar on top, to reduce repetition and visual syn-tax. If a helper doesn't fit a particular shape cleanly, drop down to an object literal for that bit.

## Query Builder Options

Query Builder's `raw(..)` accepts variadic option-key helpers (or a single options object), and returns a query-builder result object (see below).

**NOTE:** In general, an option-key helper like `{ whatever: .. }` has the preferred `whatever(..)` named function form, as illustrated in the examples below.

The following options are recognized:

* `kind` (string, default: `"query"`): allows `"query"`, `"mutation"` or `"subscription"`.

    ```js
    { kind: "query" }
    ```

    **NOTE:** It's generally preferred to use the scoped query-builder methods `query(..)`, `mutation(..)`, and `subscription(..)`, which each preset the underlying `kind` accordingly:

    ```js
    // raw({ kind: "query", .. })
    query({ .. })

    // raw({ kind: "mutation", .. })
    mutation({ .. })

    // raw({ kind: "subscription", .. })
    subscription({ .. })
    ```

* `operationName` (string, default: `null`): the operation name in the query text (e.g., `GetUser`). Pass `null` or `""` to omit, in which case the builder falls back to `Query` / `Mutation` / `Subscription` (based on `kind`) if variable defs are present, or omits the operation header entirely if not. Most easily produced via the `operationName(..)` option-key helper.

    ```js
    operationName("getUser")
    // { operationName: "getUser" }
    ```

* `root` (object): specifies the root field shape. Most easily produced via the `root(..)` option-key helper.

    `root(field)` bare field:

    ```js
    root("user")
    // { root: { field: "user" } }
    ```

    Produces a root like `user(..) { .. }`.

    `root(field, alias)` aliased root:

    ```js
    root("currentUser","user")
    // { root: { field: "currentUser", alias: "user" } }
    ```

    Produces a root like `currentUser: user(..) { .. }`.

    The `root(..)` unit also has a chained `.directives(..)` method for attaching GraphQL directives directly to the root field. See [GraphQL Directives](#graphql-directives) below.

* `varArgs` (option): operation-level (and field-level) arguments whose values are variable type-defs. The builder hoists the type-defs into the operation parameter list automatically.

    For example:

    ```js
    varArgs(
        $v("id","userID","ID"),
        $v("limit","Int")
    )
    ```

    Produces operation parameters: `$userID: ID, $limit: Int`, and operation arguments: `id: $userID, limit: $limit`.

* `litArgs` (option): operation-level (and field-level) arguments with literal values. Leaf values can be built-in JS types (`42`, `"hello"`, `true`), bare-tokens via `$t` (e.g., `$t.DESC`), or manual variable references via `$v` (e.g., `$v.orderBy`).

    For example:

    ```js
    litArgs(
        $m("order", $m("lastName", $t.DESC)),
        $m("limit", 50)
    )
    ```

    Produces: `order: { lastName: DESC }, limit: 50`.

* `varDefs` (option): manual variable type-defs. Adds explicit parameter declarations to the operation without tying them to any specific argument position; useful when a variable is referenced manually via `$v.varName` in literal-based arguments.

    For example:

    ```js
    varDefs($v("orderBy","String"))
    ```

    Adds `$orderBy: String` to the operation's variable type definitions. The variable can then be referenced in `litArgs` (operation-level or field-level) via `$v.orderBy`.

* `selectionSet` (option): the fields to include in the selection-set.

    For example:

    ```js
    selectionSet(
        "firstName",
        "lastName",
        $f`ownerEmail``email`
    )
    ```

    Produces: `firstName lastName ownerEmail: email`.

    Each argument is a selection entry: a bare string for a scalar field, an `$f` helper for an aliased or argument-bearing field reference, or an object-keyed entry for sub-selections (see "Field-Level Selections" below).

    To omit the selection-set block entirely: `selectionSet(null)`, `selectionSet($f.noSelection)`, or `selectionSet.none()`.

* `directives` (option): operation-level GraphQL directives, attached to the `query`/`mutation`/`subscription` keyword itself. See [GraphQL Directives](#graphql-directives) below.

## Unit-Producing Helpers

### `$v`: Variable Leaf Specs

`$v` builds variable leaf-specs for `varArgs` and `varDefs`.

`$v(unit1, unit2, ..)` composes/merges units; it takes the place of an object literal on the right side of `varArgs:` / `varDefs:`, merging the individual leaf units passed in.

```js
varArgs: $v(
    $v("id","ID"),
    $v("limit","Int")
)
```

**NOTE:** Since `$v(..)` composes object units, the units it accepts can also be object-spread directly into a regular object literal as a more flexible alternative.

The 2-arg form `$v(name,type)` defaults the variable name to the argument name:

```js
$v("id","ID")
// unit: { id: "ID" }
// type def: $id: ID, arg: id: $id
```

The 3-arg form `$v(name,varName,type)` sets the variable name explicitly:

```js
$v("id","userID","ID")
// unit: { id: { userID: "ID" } }
// type def: $userID: ID, arg: id: $userID
```

**NOTE:** Anywhere a type string appears -- as long as it doesn't include non-identifier characters like `[` or `!` -- a `$t` bare-name token is also accepted. For example: `$t.String`, `$t.Int`, `$t.ID`. This can help visually distinguish the type from the surrounding field/variable name strings:

```js
$v("id",$t.ID)
```

Manual variable references (for use alongside `varDefs`) can also be made with `$v.varName`; alternatively, if you prefer, `$v.$varName` with the `$` prefix on `varName` works the same.

Either way, the reference renders as `$varName` (with the necessary `$` sigil):

```js
$v.email    // $email
$v.$email   // $email
```

### `$t`: Bare-Name Tokens

`$t` is a proxy that produces bare-name tokens for use in literal-based argument positions.

```js
$t.DESC      // renders as: DESC
$t.UTC_NOW   // renders as: UTC_NOW
$t.String    // renders as: String  (usable as a type string)
```

A leading `$` on the property name marks it as a manual variable reference (same as `$v.varName`):

```js
$t.$orderBy  // renders as: $orderBy
```

**TIP:** While `$t.$orderBy` (`$` prefix on `orderBy` required!) works for consistency, the *preferred* way to express a manual variable reference is `$v.orderBy`.

Bare tokens can appear anywhere a literal value is expected: inside `litArgs`, as type strings in `$v` / variable specs, etc.

### `$m`: Map Literals

`$m` builds object structures, useful in places where the literal data shape would otherwise require object-literal syntax.

The 2-arg form `$m(name,value)` produces a single-property object:

```js
$m("order",$t.DESC)
// unit: { order: $t.DESC }
// arg: order: DESC

$m("foo",42)
// unit: { foo: 42 }
// arg: foo: 42
```

Nesting requires explicit `$m` calls per level:

```js
$m("order",
    $m("title",$t.DESC)
)
// unit: { order: { title: $t.DESC } }
// arg: order: { title: DESC }
```

Multiple unit-objects as trailing args merge as siblings under the named property:

```js
$m("order",
    $m("title",$t.DESC),
    $m("year",$t.ASC)
)
// unit: { order: { title: $t.DESC, year: $t.ASC } }
// args: order: { title: DESC, year: ASC }
```

`$m` also accepts an `$f` token (or its symbol) as the property-name, mirroring the `[$f`...`]` computed-property syntax, for selection-set entries:

```js
selectionSet(
    $m(
        $f`recentPosts``posts ${ /* .. */ }`,
        [ "title", "publishedAt" ]
    )
)
```

is equivalent to:

```js
selectionSet: {
    [ $f`recentPosts``posts ${ /* .. */ }` ]:
        [ "title", "publishedAt" ]
}
```

### `$f`: Field-Level References

`$f` produces field-level reference tokens for use in `selectionSet(..)`. It supports field aliases, field-level arguments, and pairs with `$m` for sub-selections.

`$f` supports two equivalent calling styles. The tagged-template form (``` $f`alias``field` ```) is JS-specific and is more terse/closer to GraphQL's own alias syntax. The function-call form (`$f(alias,field)`) is conventional JS and is the basis for ports to other languages (Go, Rust, etc.).

Both forms produce identical tokens and work interchangeably in all positions: `selectionSet(..)`, computed property keys (`{ [$f(...)]: subSel }`), and `$m(..)`.

**Signatures:**

```js
// tag form
$f`fieldName`
$f`alias``fieldName`
$f`fieldName ${combinator}`
$f`alias``fieldName ${combinator}`

// function-call form
$f("fieldName")
$f("alias", "fieldName")
$f("fieldName", combinator)
$f("alias", "fieldName", combinator)
```

**Side by side:**

```js
// alias only
$f`ownerEmail``email`
$f("ownerEmail", "email")

// field with args, no alias
$f`posts ${varArgs($v("sinceTS","Int"))}`
$f("posts", varArgs($v("sinceTS","Int")))

// alias + field + args
$f`myPosts``posts ${varArgs($v("sinceTS","Int"))}`
$f("myPosts", "posts", varArgs($v("sinceTS","Int")))
```

The choice between forms is purely stylistic. The tag form is more compact and reads left-to-right as `alias: field`, matching GraphQL's own rendering. The function-call form is immediately readable to anyone familiar with conventional JS and maps directly to how other language ports express the same concept.

#### Field-Level Selections

To alias a field name in a selection-set:

```js
selectionSet(
    // ..
    $f`userFirstName``firstName`,
    // ..
)
```

Produces a field-level reference like `userFirstName: firstName`, which aliases the `firstName` field name to `userFirstName` in the result set.

To use field-level arguments (and aliases, if desired) on an object field with sub-selection, pair the `$f` helper with `$m` to produce a computed-property selection-set entry. The `$f` interpolation accepts an array of units (merged together), so the option-key helpers and other unit producers compose naturally inside it:

```js
selectionSet(
    // ..
    $m(
        $f`myPosts``posts ${[
            varArgs($v("sinceTS","Int")),
            litArgs($m("limit",50))
        ]}`,
        [ "title", "publishedAt" ]
    )
    // ..
)
```

**NOTE:** The `[ ]` surrounding the interpolation expression is there to allow the two argument-bearing values. If there's only one value being interpolated, you can pass it directly without the `[ ]` around it.

The `$f` interpolation also accepts a single object literal directly, equivalent to the array-of-units form above:

```js
selectionSet(
    // ..
    $m(
        $f`myPosts``posts ${{
            varArgs: { sinceTS: "Int" },
            litArgs: { limit: 50 }
        }}`,
        [ "title", "publishedAt" ]
    )
)
```

Either form above produces this field-level reference with sub-selection:

```graphql
myPosts: posts(since: $sinceTS, limit: 50) {
    title
    publishedAt
}
```

## Type-Conditional Selections

GraphQL lets a selection-set include type-conditional branches when the field's type is wider than a single concrete type -- typically interface or union types. The `... on TypeName { .. }` syntax narrows a branch of the selection to fields available only on `TypeName`; the server evaluates the condition per result and includes the branch when the runtime type matches.

**TIP:** This pattern is common in API-style GraphQL backends (GitHub's API, Shopify, anything Relay-flavored).

`$f.on` produces a type-conditional selection token, used as a key with `$m` (or as a computed property key) to attach the type-narrowed sub-selection.

```js
selectionSet(
    "id",
    $m($f.on("User"), [ "name", "email" ]),
    $m($f.on("Post"), [ "title", "body" ]),
)
// renders: id ... on User { name email } ... on Post { title body }
```

Like `$f`, both calling forms work and are equivalent:

```js
// tag form
$f.on`User`

// function-call form
$f.on("User")
```

The type name accepts either a string or a `$t` bare-name token:

```js
$f.on($t.User)
// equivalent to: $f.on("User")
```

When `namePrefix` is in effect, the type name is prefixed the same way other type names are:

```js
// with namePrefix: "Dev_"
$f.on("User")
// renders: ... on Dev_User
```

### Constraints

`$f.on` is intentionally narrower than `$f`. The following are rejected at construction time:

* **No alias.** Inline fragments don't have aliases in GraphQL. `$f.on("alias", "User")` throws.

* **No field arguments.** Inline fragments don't take arguments. `$f.on("User", varArgs(..))` and `$f.on("User", litArgs(..))` throw.

The following is rejected at render time:

* **Sub-selection required.** Inline fragments without a selection-set are a GraphQL parse error. `selectionSet($f.on("User"))` with no `$m` wrap throws.

Directives, however, are allowed and compose the same way they do for any other field:

```js
selectionSet(
    $m($f.on("User", $d.nonreactive), [ "name" ])
)
// renders: ... on User @nonreactive { name }
```

Type-conditional selections can be nested:

```js
selectionSet(
    $m($f.on("User"), [
        "name",
        $m($f.on("AdminUser"), [ "permissions" ])
    ])
)
// renders: ... on User { name ... on AdminUser { permissions } }
```

## GraphQL Directives

GraphQL allows attaching `@directive` annotations to fields, operations, and several other positions. Composer supports rendering directives in three positions -- selection-field, root-field, and operation-level -- through the `$d` proxy and the `directives(..)` combinator.

These directives can be spec-mandated ones like `@skip` or client-custom ones like `@nonreactive`.

### Producing Directives: `$d`

`$d` is a proxy that produces directive tokens. The bare form renders the directive without arguments:

```js
$d.nonreactive
// renders as: @nonreactive
```

Calling the token attaches arguments. Both literal and variable args are supported, and can be combined:

```js
$d.format(litArgs($m("style","short")))
// renders as: @format(style:"short")

$d.scoped(varArgs($v("scope","String")))
// renders as: @scoped(scope:$scope)
// hoists: $scope: String into operation var-defs

$d.fancy(
    varArgs($v("scope","String")),
    litArgs($m("format","short"))
)
// renders as: @fancy(scope:$scope,format:"short")
```

### Operation-Level Directives

Pass `directives(..)` at the top level of `raw(..)` / `query(..)` / etc. to attach directives to the operation itself (immediately after the operation name and var-defs, before the opening brace):

```js
query(
    operationName("GetUser"),
    directives(
        $d.cached(litArgs($m("ttl",60))),
        $d.nonreactive
    ),
    root("user"),
    selectionSet("firstName"),
)
// renders: query GetUser @cached(ttl:60) @nonreactive { user { firstName } }
```

Operation-level directive args participate in variable hoisting like any other args:

```js
query(
    directives(
        $d.cached(varArgs($v("ttl","Int")))
    ),
    root("user"),
    selectionSet("firstName"),
)
// renders: query Query($ttl:Int) @cached(ttl:$ttl) { user { firstName } }
```

### Root-Field Directives

`root(..)` has a chained `.directives(..)` method for attaching directives to the root field. The method accepts one or more directive tokens:

```js
query(
    operationName("GetUser"),
    root("user").directives($d.cached),
    selectionSet("firstName", "lastName"),
)
// renders: query GetUser { user @cached { firstName lastName } }
```

```js
query(
    operationName("GetUser"),
    root("user").directives(
        $d.cached(varArgs($v("ttl","Int"))),
        $d.nonreactive
    ),
    selectionSet("firstName"),
)
// renders: query GetUser($ttl: Int) { user @cached(ttl: $ttl) @nonreactive { firstName } }
```

### Selection-Field Directives

A single directive can be attached to a selection field by interpolating its token into the `$f` slot:

```js
selectionSet(
    $f`email ${$d.nonreactive}`
)
// renders: email @nonreactive
```

Combined with field args and/or a sub-selection, use the array form to interpolate multiple units. Directives render after args, before any sub-selection block:

```js
selectionSet(
    $m(
        $f`books ${[
            litArgs($m("limit",10)),
            $d.nonreactive,
        ]}`,
        [ "title" ]
    )
)
// renders: books(limit:10) @nonreactive { title }
```

For multiple directives on the same field, wrap them with the `directives(..)` combinator:

```js
$f`email ${
    directives(
        $d.nonreactive,
        $d.format(litArgs($m("style","short")))
    )
}`
// renders: email @nonreactive @format(style:"short")
```

### Type-Conditional Selection Directives

Directives can be attached to an inline type-conditional selection via `$f.on`'s combinator slot:

```js
selectionSet(
    $m($f.on("User", $d.nonreactive), [ "name" ])
)
// renders: ... on User @nonreactive { name }
```

The tag form works the same way:

```js
selectionSet(
    $m($f.on`User ${$d.nonreactive}`, [ "name" ])
)
```

For multiple directives, wrap with `directives(..)`:

```js
$f.on("User", directives($d.a, $d.b))
// or in tag form:
$f.on`User ${directives($d.a, $d.b)}`
// renders: ... on User @a @b { ... }
```

See [Type-Conditional Selections](#type-conditional-selections) for the full surface.

### `@skip` and `@include`

The spec-mandated conditional directives `@skip` and `@include` are specified with the generic `$d` proxy:

```js
$f`email ${$d.skip(litArgs($m("if",true)))}`
// renders: email @skip(if:true)
```

**WARNING:** That verbosity (i.e., lack of any specific syntactic sugar) is a strong hint that this type of conditionality really belongs in the host-language (JS) conditional logic (such as an inline `? :` ternary), rather than embedded in the query string for the server to resolve. `@skip` and `@include` are generally an anti-pattern with this DSL, but you *can* specify them if the legitimate need arises.

## Query Result Object

The query-builders (`raw()`, `query()`, etc) all return a result object with the following properties:

* `text`: the ready-to-execute query text

* `opName`: the operation name embedded in the query text (e.g., `GetUser`), to pass along to whatever GraphQL endpoint will execute the query

* `resName`: the result set name (e.g., the root field's alias if one was set, otherwise its bare field name)

* `kind`: the kind of query string (`"query"`, `"mutation"`, or `"subscription"`)

For example, this call:

```js
query(
    operationName("GetUser"),
    root("user"),
    varArgs($v("id","ID")),
    selectionSet("firstName","lastName")
)
```

Produces:

```js
{
    text: "query GetUser($id:ID) { user(id:$id) { firstName lastName } }",
    opName: "GetUser",
    resName: "user",
    kind: "query"
}
```

## Other Exports

* `isGQLName(str)`: predicate; returns `true` if `str` is a valid GraphQL name (per the spec's identifier grammar). Useful for validating dynamically-supplied field or alias names before passing them to the builder.

## Extending Composer

Composer is built to be extended. Higher-level layers -- backend-flavored DSLs, opinionated query helpers, transport-coupled clients -- can register against composer's internals to add new syntax, new combinators, and new rendering behavior, without composer itself needing to know about any of it.

This package also ships an abstract DB-shaped layer (`@gql-x/composer/db`) that sits between bare composer and a fully-realized backend-specific package. It adds auto-prefixing of schema names (handy for backends without native namespacing), a pluggable transport spread, and a `decorate` hook for layering on backend-specific helpers. It functions more like an interface or abstract base class than a direct tool; you wouldn't normally instantiate it directly.

The extension points, the DB layer's full surface, and the render protocol that makes deep customization possible are all documented in [EXTENSIBILITY.md](./EXTENSIBILITY.md).

## TypeScript Support

Type definitions are bundled with the package. TypeScript projects will pick them up automatically; no separate `@types/` install needed.

The types cover the full public API surface, including:

- Autocomplete on all helpers and the `$t` / `$d` proxies
- Branded clause types with a structural escape hatch for raw object literals
- Detection of common construction mistakes (e.g., missing `root`)
- Both calling forms of `$f` (function call and tagged template)
- `$f.on` for type-conditional selections (both calling forms)
- The chained `root().directives(..)` method

The runtime is plain JavaScript; the types are an additive aid for editor tooling and don't affect behavior.

## Tests

A test suite is included in this repository, as well as the npm package distribution. The default test behavior runs the test suite using the files in `src/`.

To run the test suite:

```
npm test
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2026 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
