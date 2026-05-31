# Extending Composer

This document covers composer's extension surface: the factory split, the internals plugin authors have access to, the render protocol that lets plugins add new rendering behavior, and the abstract DB layer (`@gql-x/composer/db`) you can build on top of instead of starting from bare composer.

The intended audience is plugin authors — people building a layer on top of composer (the way `@gql-x/defradb` is built). If you're an app developer trying to use composer to compose GraphQL queries, you want the [README](./README.md) instead.

> **Heads up:** Everything documented here is experimental and unstable. The composer extension surface is shaped by what's needed for the layers currently being built on it. Shapes will change. Things will be added, removed, renamed. Don't pin anything in this document down as a contract.

## The Two Factory Entry Points

The composer module exposes two factory functions:

```js
import { createComposer, registerPlugin } from "@gql-x/composer";
```

- `createComposer()` — app-facing. Returns just the public API (helpers + builders).
- `registerPlugin()` — plugin-facing. Returns `{ api, _internals }`.

`api` is the same public surface `createComposer()` returns. `_internals` exposes hooks that aren't part of the app-facing API, but that plugin authors need to mint their own field tokens, inspect bare-name tokens, and so on.

```js
var { api, _internals } = registerPlugin();

var { $f, $t, $v, $m, raw, selectionSet, root, /* .. */ } = api;
var { makeFieldToken, is$fToken, $fMeta, nameToken, /* .. */ } = _internals;
```

All per-instance state (token symbols, internal WeakMaps, caches) is closure-private to each `registerPlugin()` / `createComposer()` call. Two composer instances don't share token identities or metadata. This isolation is deliberate and non-negotiable — it means a plugin can safely instantiate its own composer without worrying about colliding with anyone else's.

## The Composer Internals

The `_internals` object exposed by `registerPlugin()` currently contains:

**Field-token internals**

- `makeFieldToken(...)` — mint a `$f`-style token directly, without going through the `$f` helper. Used when a plugin needs to produce field-level references with custom field metadata that the `$f` template/function-call surface doesn't expose.
- `is$fToken(value)` — predicate. Returns `true` if `value` is a `$f` token produced by this composer instance.
- `get$fSymbol(token)` — extract the internal symbol identifying a `$f` token. Useful when a plugin needs to look up field metadata directly.
- `$fMeta` — the WeakMap (or equivalent) where field metadata is keyed by token symbol. Plugins write into this when minting tokens via `makeFieldToken` so the composer renderer can find their metadata at render time.

**Bare-name-token internals**

- `nameToken` — used internally to mark bare-name tokens. Plugins may need to reference this when constructing tokens that need to render as bare identifiers (no quotes, no `$`).
- `is$tToken(value)` — predicate. Returns `true` if `value` is a `$t` bare-name token produced by this composer instance.
- `get$tTokenName(token)` — extract the bare name string from a `$t` token. Used when a plugin needs to unwrap a bare-name token to forward its underlying name into a different rendering position.

You won't need every internal for every plugin. The minimum set most plugins reach for is `makeFieldToken` + `$fMeta` (to mint custom field tokens) and `is$tToken` + `get$tTokenName` (to accept `$t` tokens in custom helper signatures, the way `$v("docID", $t.ID)` works).

## The Render Protocol

Composer is, by design, ignorant of plugin-specific syntax. It doesn't know what an aggregate is, what a filter looks like, what a custom *unit* (i.e., `$v()`, etc) wraps. But composer's renderer can still produce output for plugin-defined constructs, because it dispatches to a small set of **render protocol** seams at well-defined points.

A render-protocol token is just a plain JS object with a `.render(...)` method (and sometimes additional fields composer reads). Composer's renderer looks for these objects at three specific positions and, if it finds one, delegates to it instead of doing default rendering.

The three seams:

1. **`litArgs` value position.** If a value inside a `litArgs` (or any equivalent literal-argument position) has a `.render(renderCtx)` method, composer dispatches to it instead of treating the value as a JS literal.

2. **Field-level `argsWrapper`.** If a field's metadata carries an `argsWrapper` token, composer's argument renderer hands the already-rendered inner args string to `argsWrapper.render(renderCtx, innerArgsStr)`, and the wrapper produces the final args string — possibly wrapping the inner args in whatever syntactic shape it wants.

3. **Root unit `render`.** If the root unit has a `render(rootRenderCtx)` function, composer's query-builder calls it to override the default `rootField`/`rootAlias` computation. This lets a plugin rewrite how the root field itself appears.

The next two sections show seams 1 and 2 in action via a running example. Seam 3 is documented at the end since it's both less common and harder to demonstrate in miniature.

## Running Example: A `near()` Geolocation Helper

To make the render protocol concrete, let's sketch a small plugin: a helper that adds a `near(lat: ..., lng: ..., radius: ...)` argument wrapper to a field, where `lat` and `lng` are hoisted variables and `radius` is a literal number.

The GraphQL we want to produce:

```graphql
query FindShops($lat: Float, $lng: Float) {
    shops(near: { lat: $lat, lng: $lng, radius: 5000 }) {
        name
        address
    }
}
```

The composer call we want to enable:

```js
query(
    operationName("FindShops"),
    root("shops"),
    near("lat", "lng", 5000),       // <-- plugin!
    selectionSet("name", "address")
)
```

Two render-protocol seams come into play. The `near` helper needs to:

- Hoist `$lat` and `$lng` as `Float` variables (variable bookkeeping — composer handles this natively once the variable spec is registered).
- Wrap whatever inner argument string composer renders into a `near: { ... }` shape at the field level. **(argsWrapper seam.)**
- Produce a literal value (`5000`) inside that wrapped shape that renders cleanly alongside the variable references. **(litArgs render seam, if the inner shape mixes its own literal rendering.)**

### Step 1: Set up the plugin

```js
import { registerPlugin } from "@gql-x/composer";

function createGeoComposer() {
    var { api, _internals } = registerPlugin();
    var { $v, varArgs, ...rest } = api;

    function near(latVarName, lngVarName, radiusValue) {
        // ... built below
    }

    return { ...api, near };
}
```

### Step 2: Define the argsWrapper token

The wrapper's job is to take whatever inner args composer would have rendered for the field and re-emit them inside `near: { ... }`. Since `near` *is* the entire set of args at this position, the inner args composer would render are empty by default — the wrapper supplies all the content.

We need:

- A token with a `.render(renderCtx, innerArgsStr)` method (the argsWrapper protocol).
- That token's `render` produces `near:{lat:$lat,lng:$lng,radius:5000}` as a string.

```js
function makeNearWrapper(latVarName, lngVarName, radiusValue) {
    return {
        render(renderCtx, innerArgsStr) {
            // innerArgsStr will be empty here since `near` is the only arg
            // and we're supplying all of it ourselves.
            return `near:{lat:$${latVarName},lng:$${lngVarName},radius:${radiusValue}}`;
        }
    };
}
```

The `renderCtx` parameter exposes composer's renderer helpers; this simple wrapper doesn't need them, but more sophisticated wrappers will. (See "The `renderCtx` Contract" below.)

### Step 3: Wire up variable hoisting

The wrapper renders the variable references as a plain string, but composer doesn't *know* about those variables unless we register them through composer's normal variable-bookkeeping path. The right move is to attach a `varArgs` combinator to the same field at the same time as the wrapper.

```js
function near(latVarName, lngVarName, radiusValue) {
    return {
        // varArgs: composer hoists these into the operation's parameter list,
        // even though we're rendering the references ourselves in the wrapper.
        varArgs: {
            // these field-position keys are arbitrary — composer just needs them
            // present in some varArgs spec so the parameter list gets the type-defs.
            _near_lat: { [latVarName]: "Float" },
            _near_lng: { [lngVarName]: "Float" },
        },
        // fieldArgsWrapper: token implementing the argsWrapper render protocol.
        // composer will call .render(renderCtx, innerArgsStr) at field-render time.
        fieldArgsWrapper: makeNearWrapper(latVarName, lngVarName, radiusValue),
    };
}
```

**Note:** The exact property names a plugin uses to plumb an argsWrapper through to a field-level position (and to register varDefs alongside a custom wrapper) are part of composer's internal contract, not the public render-protocol surface. The shape sketched above is illustrative — refer to `@gql-x/defradb` for the actual plumbing pattern it currently uses, since that's the working production reference.

### Step 4: Putting it together

```js
var { query, root, selectionSet, operationName, near } = createGeoComposer();

query(
    operationName("FindShops"),
    root("shops"),
    near("lat", "lng", 5000),
    selectionSet("name", "address")
)
// → { text: "query FindShops($lat:Float,$lng:Float) { shops(near:{lat:$lat,lng:$lng,radius:5000}) { name address } }", ... }
```

The `$lat` and `$lng` variables hoist into the operation parameter list because we registered them through `varArgs`. The `near: {...}` wrapper around the args is produced by the argsWrapper token's `render` method. The `5000` literal is inside the wrapper's output string, rendered however the wrapper chose to render it (in this case, as a JS-side template literal).

This is a deliberately minimal example. A real plugin would:

- Use `_internals.makeFieldToken` to produce a proper `$f`-style token instead of returning a raw unit shape.
- Use `_internals.is$tToken` so callers could pass `$t.SomeType` in place of literal type strings.
- Use the `renderCtx` to defer parts of inner rendering back to composer, instead of building the entire string by hand.

`@gql-x/plugin-defradb`'s `over()` and `$a.*` aggregate helpers are the production reference for all of these.

## The `renderCtx` Contract

When composer dispatches to a render-protocol token's `.render(...)` method, it passes a `renderCtx` (the first argument). This context object exposes a handful of methods plugin renderers can call to delegate sub-rendering back to composer rather than re-implementing it.

The currently available `renderCtx` methods:

- `renderFieldMeta(fieldMeta)` — render a field's args using composer's normal field-args renderer, given the field meta. Used by render-protocol tokens that need to defer their inner rendering to composer (e.g., a `GROUP(field, ...combinators)` token that defers the combinator rendering to the field-args path).
- `renderName(name)` — render a name token (handling `$t` unwrapping and bare-name emission).
- ...others, as composer's needs evolve.

A render-protocol token can call these as it builds its output string, so it doesn't have to duplicate composer's escaping, name-handling, or sub-arg-rendering logic.

The simplest rule of thumb: if your token's render needs to emit something that *looks like* something composer already knows how to emit (a name, an args block, a sub-selection), it should delegate to `renderCtx` rather than hand-roll it.

## Seam 3: Root Unit `render`

The third render-protocol seam is on the root unit itself. If the root unit has a `render(rootRenderCtx)` function, composer's query-builder calls it during root rendering, and the function's return value overrides composer's default computation of `rootField` and `rootAlias`.

This is used when a plugin needs to rewrite the root field's *appearance* entirely — for example, when the root field is an aggregate function applied to a collection (`COUNT(User: { ... })`) rather than a direct field reference (`User { ... }`). In that case, the root unit's `render` function returns a custom `{ rootField, rootAlias }` shape that composer's renderer uses instead of its defaults.

Unlike the previous two seams, this one is harder to motivate with a small standalone example, because the use case (overriding root rendering) doesn't have a clean one-liner. `@gql-x/plugin-defradb`'s 3-arg `root(field, alias, over)` form is the working production example. If you find yourself needing to rewrite how the root field renders, that's the pattern to study.

## The Abstract DB Layer

Composer also ships a second module, `@gql-x/composer/db`, that builds on composer's extension surface to provide a scaffold for backend-flavored DSLs. You don't *have* to use it — plugins can build directly on bare composer. But for the common case of "I'm writing a layer that has its own schema-naming conventions and ships with a transport," the DB layer does a lot of the plumbing for you.

It adds three things over bare composer:

1. **Schema-name prefixing** — auto-prefixes variable types and root field names with a configurable prefix (e.g., `Dev_`), and auto-aliases the prefixed root back to its unprefixed name in the result set.
2. **Transport spread** — methods on a transport object are spread directly onto the returned API, so plugin consumers can call `api.exec(...)`, `api.startTransaction(...)`, etc. without the plugin having to expose them manually.
3. **A `decorate` hook** — runs after prefixing is applied, giving the plugin a chance to attach its own helpers (`$p`, `$a`, `collection()`, whatever) to the prefixed API before returning it.

Conceptually, the DB layer is more like an interface or abstract base class than a directly-usable tool. You wouldn't normally instantiate; its real audience is a plugin one layer up, which uses it as a base.

### Using the DB Layer as a Base

The DB layer exports a single function: `registerPlugin(opts)`. It returns `{ api, _internals }`.

```js
import { registerPlugin as dbRegisterPlugin } from "@gql-x/composer/db";

var { api, _internals } = dbRegisterPlugin({
    namePrefix: "Dev_",
    nonPrefixedTypes: [ "JSON", "DateTime" ],
    transport: {
        exec(query, args) { /* .. */ },
        hasActiveTransaction() { /* .. */ },
        startTransaction(opts) { /* .. */ },
        commitTransaction() { /* .. */ },
        discardTransaction() { /* .. */ },
    },
    decorate(prefixedAPI, composer, composerInternals) {
        // attach plugin-specific helpers here
        return {
            ...prefixedAPI,
            myHelper(...) { /* .. */ },
        };
    },
});
```

**`namePrefix`** is the schema-name prefix. With `"Dev_"`, the DB layer's `query()` method will produce GraphQL with root fields like `Dev_User` (aliased back to `User`), and variable types like `Dev_UserInput`.

**`nonPrefixedTypes`** extends the default list of types the prefixer leaves alone. The built-in defaults are the GraphQL spec primitives (`Int`, `Float`, `String`, `Boolean`, `ID`); pass additional names here for any custom types your backend exposes that shouldn't be prefixed (`JSON`, `DateTime`, etc.).

**`transport`** is an object whose methods are spread onto the returned `api`. The DB layer doesn't introspect it — whatever methods the transport provides become methods on the API. A plugin's actual transport implementation lives in the layer above (typically a `*-transport-http` package); the DB layer just wires it up to the API surface.

**`decorate`** is the layering hook. It runs after the DB layer has produced its prefixed API, and gets that prefixed API plus the composer API and its internals as arguments. Whatever the decorate function returns becomes the final API. This is where plugin-specific helpers get attached.

### The `prefix(...)` API

The returned `api` exposes a `prefix(namePrefix)` method that returns a *sibling* API with a different prefix. The original API is unchanged.

```js
var devAPI = api;                    // namePrefix: "Dev_"
var prodAPI = api.prefix("Prod_");   // sibling, namePrefix: "Prod_"
```

Re-prefixing re-runs the `decorate` hook against the new prefixed API, so any plugin-specific helpers the decorator attaches remain attached on the re-prefixed sibling. Plugin authors can rely on this: `prefix(...)` produces a fully-decorated sibling, not a stripped-down one.

### The DBQuery Functor

`api.query(...)` wraps composer's `query(...)` with the registered `namePrefix` and `nonPrefixedTypes`; same with `raw(..)`, `mutation(..)`, and `subscription(..)`. The returned query object is a functor with two methods:

- `.map(fn)` — returns a new query whose eventual result will be transformed by `fn`. Repeated `.map(...)` calls compose left-to-right.
- `.tap(fn)` — derived from `.map(...)`; runs `fn` for side effects (e.g., logging) and passes the query through unchanged.

```js
api.query(/* .. */)
    .tap(q => console.log(q.text))
    .map(result => result?.someField);
```

A plugin's `decorate` hook can extend this further — for example, `@gql-x/plugin-defradb` attaches an `.exec()` method to query objects that automatically threads the registered transport's `exec`, so callers can write `api.collection("User").get(...).exec()` instead of `api.exec(api.collection("User").get(...))`.

### When to Build on the DB Layer vs. Bare Composer

Build directly on bare composer (via `registerPlugin()`) if:

- You don't need schema-name prefixing.
- You don't have a transport story (e.g., you're building an AOT query generator that just writes `.graphql` files).
- You want the smallest possible surface to reason about.

Build on the DB layer (`@gql-x/composer/db`'s `registerPlugin()`) if:

- Your backend has a schema-namespacing convention that prefixing approximates.
- You want a transport-spread API as part of your plugin's surface.
- You want re-prefixing to "just work" without re-running your decoration logic by hand.

Most non-trivial plugins will want the DB layer.

## Recap

The composer extension story, summarized:

- `registerPlugin()` is the plugin-author entry point. It returns `{ api, _internals }`; the internals expose token-minting and token-inspection hooks.
- The render protocol has three seams: `litArgs` values, field-level `argsWrapper`, root unit `render`. Plugin-defined tokens carry a `.render(...)` method composer dispatches to at the appropriate point.
- `renderCtx` lets render-protocol tokens delegate sub-rendering back to composer instead of re-implementing it.
- `@gql-x/composer/db` is an abstract scaffold built on those extension points, providing schema-name prefixing, transport spread, and a `decorate` hook. Most plugins will build on it rather than on bare composer.

## A Concrete Example: `@gql-x/defradb`

The canonical worked-out example of everything in this document is [`@gql-x/plugin-defradb`](https://github.com/gql-x/plugin-defradb), a plugin built on top of `@gql-x/composer/db` that targets [DefraDB](https://source.network/defradb) — an open-source, peer-to-peer document database from Source Network that speaks GraphQL natively and supports CRDT-based sync between nodes.

DefraDB's GraphQL surface adds a fair amount on top of stock GraphQL — filters with rich comparator vocabularies, mutations with structured input payloads, aggregate functions usable both inside selection sets and at the operation root, grouped aggregates with their own combinator syntax, an `over(...)` argument-wrapping convention, and so on. The `@gql-x/plugin-defradb` plugin layers all of that onto composer without modifying composer itself, using exactly the extension points this document describes.

Plugin authors building for other GraphQL-speaking backends — Hasura, Postgraphile, vendored APIs with their own conventions — should find the plugin-defradb source useful both as a working reference for the extension mechanics and as a pattern for shape (helper naming, decorate-hook structure, where to draw the line between composer-flavored and backend-flavored vocabulary).
