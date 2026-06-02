# Examples

Examples covering composer's primary use patterns. Each example shows the JS call form and the GraphQL it renders. For full API details see [README.md](./README.md); for design rationale see [DESIGN.md](./DESIGN.md).

## Baseline Forms

This section walks through the building blocks one at a time: a bare query, then variables, then literal arguments, then sub-selections, then aliases. Each example introduces one new piece. Section 2 ("Host-Language Composition") shows how these compose dynamically; this section is just about seeing each shape in isolation.

All examples assume the API has been destructured from a composer instance:

```js
import { createComposer } from "@gql-x/composer";

var {
    $d, $f, $t, $v, $m,
    varArgs, litArgs, varDefs, directives,
    selectionSet, root, operationName,
    query, mutation, subscription, raw
} = createComposer();
```

### Schema Assumptions

The examples below presume a server schema along these lines:

```graphql
type Query {
    viewer: User
    user(id: ID): User
    posts(
        authorID: ID,
        limit: Int,
        order: PostOrder,
        since: Int
    ): [Post]
}

type Mutation {
    createPost(title: String, body: String): Post
}

type Subscription {
    postPublished(authorID: ID): Post
}

type User {
    id: ID
    firstName: String
    lastName: String
    email: String
    posts(since: Int): [Post]
}

type Post {
    id: ID
    title: String
    body: String
    publishedAt: Int
}

input PostOrder {
    publishedAt: SortDirection
    title: SortDirection
}

enum SortDirection {
    ASC
    DESC
}
```

Notably, `SortDirection` (with its `ASC` / `DESC` values) is a schema-defined enum, not part of the GraphQL spec. The spec only reserves `true`, `false`, and `null` as bare-name literals. Schema-defined enum values render as bare identifiers via the `$t` proxy, as shown below.

### A Bare Query

The minimum: a root field and a selection-set of scalar fields.

```js
query(
    root("viewer"),
    selectionSet("id", "name", "email")
)
```

```graphql
query {
    viewer {
        id
        name
        email
    }
}
```

The builder returns a result object, not just the text. The shape stays the same across every example below:

```js
{
    text: "query { viewer { id name email } }",
    opName: null,
    resName: "viewer",
    kind: "query"
}
```

`text` is the ready-to-execute query string. `opName` is the operation name (here, `null` because none was set). `resName` is the result-set name (the root field's alias if one was set, otherwise its bare field name). `kind` reflects which builder produced it. Subsequent examples show only the rendered GraphQL.

### Naming the Operation

Add `operationName(..)` to give the operation a name in the rendered text:

```js
query(
    operationName("GetViewer"),
    root("viewer"),
    selectionSet("id", "name")
)
```

```graphql
query GetViewer {
    viewer {
        id
        name
    }
}
```

The operation name is what a GraphQL endpoint sees when distinguishing between queries in a multi-operation document, and it's what the result object exposes as `opName`.

### Adding a Variable Argument

`varArgs(..)` declares arguments whose values are typed variables. The builder hoists the variable type-def into the operation's parameter list automatically; no separate parameter-list maintenance.

```js
query(
    operationName("GetUser"),
    root("user"),
    varArgs($v("id", "ID")),
    selectionSet("firstName", "lastName")
)
```

```graphql
query GetUser($id: ID) {
    user(id: $id) {
        firstName
        lastName
    }
}
```

The 2-arg form `$v("id", "ID")` defaults the variable name to the argument name, so `id` becomes both the argument name and `$id` the variable reference.

When you want a different variable name than the argument name, use the 3-arg form `$v(argName, varName, type)`:

```js
query(
    operationName("GetUser"),
    root("user"),
    varArgs($v("id", "userID", "ID")),
    selectionSet("firstName", "lastName")
)
```

```graphql
query GetUser($userID: ID) {
    user(id: $userID) {
        firstName
        lastName
    }
}
```

The argument position stays `id:` (matching the schema's field signature), while the operation-level variable is named `$userID`. This is useful when the argument names from different fields would otherwise collide on the same operation, or when a more descriptive variable name reads better in the parameter list.

### Multiple Variables

`varArgs(..)` accepts multiple `$v(..)` units:

```js
query(
    operationName("ListPosts"),
    root("posts"),
    varArgs(
        $v("authorID", "ID"),
        $v("limit", "Int")
    ),
    selectionSet("title", "publishedAt")
)
```

```graphql
query ListPosts($authorID: ID, $limit: Int) {
    posts(authorID: $authorID, limit: $limit) {
        title
        publishedAt
    }
}
```

### Literal Arguments

`litArgs(..)` is for arguments whose values are literals: JS primitives, bare-name tokens via `$t`, or nested map structures via `$m`.

```js
query(
    operationName("RecentPosts"),
    root("posts"),
    litArgs(
        $m("limit", 10),
        $m("order", $m("publishedAt", $t.DESC))
    ),
    selectionSet("title", "publishedAt")
)
```

```graphql
query RecentPosts {
    posts(limit: 10, order: { publishedAt: DESC }) {
        title
        publishedAt
    }
}
```

`$m("limit", 10)` produces a single literal entry. `$m("order", $m("publishedAt", $t.DESC))` nests one map inside another for the structured `order` argument. `$t.DESC` renders as the bare identifier `DESC` (a GraphQL enum value), not as a string.

Variables and literals can mix on the same operation; pass both `varArgs(..)` and `litArgs(..)` as separate chunks:

```js
query(
    operationName("RecentPostsByAuthor"),
    root("posts"),
    varArgs($v("authorID", "ID")),
    litArgs(
        $m("limit", 10),
        $m("order", $m("publishedAt", $t.DESC))
    ),
    selectionSet("title", "publishedAt")
)
```

```graphql
query RecentPostsByAuthor($authorID: ID) {
    posts(
        authorID: $authorID,
        limit: 10,
        order: { publishedAt: DESC }
    ) {
        title
        publishedAt
    }
}
```

### Sub-Selections

For nested selection-sets, the key is `$m`; it pairs a field key with its sub-selection. When the sub-selected field is just a bare name with no args or alias, the key is simply a string:

```js
query(
    operationName("GetUserWithPosts"),
    root("user"),
    varArgs($v("id", "ID")),
    selectionSet(
        "firstName",
        "lastName",
        $m("posts", [ "title", "publishedAt" ])
    )
)
```

```graphql
query GetUserWithPosts($id: ID) {
    user(id: $id) {
        firstName
        lastName
        posts {
            title
            publishedAt
        }
    }
}
```

When the sub-selected field takes its own arguments, `$f` enters the picture; its interpolation slot accepts arg combinators, and the resulting token works as the `$m` key:

```js
query(
    operationName("GetUserWithRecentPosts"),
    root("user"),
    varArgs(
        $v("id", "ID"),
        $v("sinceTS", "Int")
    ),
    selectionSet(
        "firstName",
        $m(
            $f`posts ${
                varArgs($v("since", "sinceTS", "Int"))
            }`,
            [ "title", "publishedAt" ]
        )
    )
)
```

The `$f()` alternative function-call form is equivalent; pass the combinator as the second argument:

```js
$f("posts", varArgs($v("since", "sinceTS", "Int")))
```

```graphql
query GetUserWithRecentPosts($id: ID, $sinceTS: Int) {
    user(id: $id) {
        firstName
        posts(since: $sinceTS) {
            title
            publishedAt
        }
    }
}
```

Notice that `$sinceTS` declared in the inner `varArgs(..)` hoists all the way up to the operation's parameter list, alongside `$id`. Variable hoisting works at any depth.

### Aliasing

Two positions can carry an alias: the root field, and any field inside a selection-set.

For the **root field**, pass the alias as the second argument to `root(..)`:

```js
query(
    operationName("CurrentUser"),
    root("currentUser", "user"),
    selectionSet("firstName", "lastName")
)
```

```graphql
query CurrentUser {
    currentUser: user {
        firstName
        lastName
    }
}
```

The result object's `resName` reflects the alias: `"currentUser"`.

For a **field inside a selection-set**, `$f`'s double-tag form reads as `alias: field`:

```js
query(
    operationName("GetUser"),
    root("user"),
    varArgs($v("id", "ID")),
    selectionSet(
        $f`given``firstName`,
        $f`family``lastName`
    )
)
```

The `$f()` alternative function-call form takes alias and field as positional arguments:

```js
$f("given", "firstName")
$f("family", "lastName")
```

```graphql
query GetUser($id: ID) {
    user(id: $id) {
        given: firstName
        family: lastName
    }
}
```

Aliasing combines with sub-selections and field-level args the same way:

```js
query(
    operationName("GetUserWithRecentPosts"),
    root("user"),
    varArgs(
        $v("id", "ID"),
        $v("sinceTS", "Int")
    ),
    selectionSet(
        "firstName",
        $m(
            $f`recentPosts``posts ${
                varArgs($v("since", "sinceTS", "Int"))
            }`,
            [ "title", "publishedAt" ]
        )
    )
)
```

The `$f()` alternative function-call form takes all three pieces positionally (alias, field, combinator):

```js
$f("recentPosts", "posts", varArgs($v("since", "sinceTS", "Int")))
```

```graphql
query GetUserWithRecentPosts($id: ID, $sinceTS: Int) {
    user(id: $id) {
        firstName
        recentPosts: posts(since: $sinceTS) {
            title
            publishedAt
        }
    }
}
```

### Mutations and Subscriptions

`mutation(..)` and `subscription(..)` are the same shape as `query(..)`; only the rendered keyword changes:

```js
mutation(
    operationName("CreatePost"),
    root("createPost"),
    varArgs(
        $v("title", "String"),
        $v("body", "String")
    ),
    selectionSet("id", "publishedAt")
)
```

```graphql
mutation CreatePost($title: String, $body: String) {
    createPost(title: $title, body: $body) {
        id
        publishedAt
    }
}
```

```js
subscription(
    operationName("OnPostPublished"),
    root("postPublished"),
    varArgs($v("authorID", "ID")),
    selectionSet("id", "title")
)
```

```graphql
subscription OnPostPublished($authorID: ID) {
    postPublished(authorID: $authorID) {
        id
        title
    }
}
```

The result object's `kind` field reflects which builder was used (`"query"`, `"mutation"`, or `"subscription"`).

## Host-Language Composition

So far, we've shown queries as standalone expressions, but those are just snapshots. Composer's main reason for existing is that those units/clauses are *JS values*, and JS values compose *best* using the host language's full vocabulary: conditionals, function abstraction, array spread, reusable bindings. This section shows the patterns that vocabulary makes natural.

### Conditional Inclusion via Spread

When a field should appear in a selection-set only under certain conditions, the cleanest pattern is an inline ternary that spreads either a one-element array (the field) or an empty array (skip):

```js
function getUser(includeEmail, includePosts, includePostBody) {
    return query(
        operationName("GetUser"),
        root("user"),
        varArgs($v("id", "ID")),
        selectionSet(
            "firstName",
            "lastName",
            ...(includeEmail ? [ "email" ] : []),
            ...(includePosts ? [
                $m("posts", [
                    "title",
                    "publishedAt",
                    ...(includePostBody ? [ "body" ] : [])
                ])
            ] : [])
        )
    );
}
```

Three independent boolean flags, each gating a different position in the query. Two of those positions are nested at different selection-set depths; the same spread pattern works identically at any depth.

Two call sites:

```js
getUser(true, false, false)
```

```graphql
query GetUser($id: ID) {
    user(id: $id) {
        firstName
        lastName
        email
    }
}
```

```js
getUser(false, true, true)
```

```graphql
query GetUser($id: ID) {
    user(id: $id) {
        firstName
        lastName
        posts {
            title
            publishedAt
            body
        }
    }
}
```

The same technique applies to argument positions. `varArgs(..)` and `litArgs(..)` both accept the unit-objects produced by `$v` / `$m`, so spreading conditional units into them works the same way:

```js
litArgs(
    $m("limit", 10),
    ...(
        orderBy ?
            [ $m("order", $m(orderBy, $t.DESC)) ] :
            []
    )
)
```

### Query Factory Functions

The previous example is already a factory; wrapping `query(..)` in a named function with parameters is the recommended packaging pattern for any non-trivial query. The function's name and signature convey intent at the call site, while the DSL composition stays encapsulated inside.

Factories aren't limited to gating inclusion. Parameters can drive the *structure* of arguments as well, including positions that GraphQL's built-in conditionality (`@skip` / `@include`) can't reach:

```js
function getPostsByAuthor(orderField) {
    return query(
        operationName("PostsByAuthor"),
        root("posts"),
        varArgs($v("authorID", "ID")),
        litArgs(
            $m("limit", 10),
            $m("order", $m(orderField, $t.DESC))
        ),
        selectionSet("title", "publishedAt")
    );
}
```

The `orderField` parameter becomes a key inside the `order` argument map. Two calls produce two structurally different queries:

```js
getPostsByAuthor("publishedAt")
```

```graphql
query PostsByAuthor($authorID: ID) {
    posts(
        authorID: $authorID,
        limit: 10,
        order: { publishedAt: DESC }
    ) {
        title
        publishedAt
    }
}
```

```js
getPostsByAuthor("title")
```

```graphql
query PostsByAuthor($authorID: ID) {
    posts(
        authorID: $authorID,
        limit: 10,
        order: { title: DESC }
    ) {
        title
        publishedAt
    }
}
```

A directive-based approach would have to enumerate both branches inline and toggle one off at execution time, and that only works at all because the alternatives differ by a single key. A factory parameterized by host data has no such restriction.

The naming side of factories also addresses an ergonomic concern: the DSL is intent-heavy rather than shape-heavy, so a bare DSL expression doesn't read like a GraphQL query at a glance. A well-named function around the DSL call (`getPostsByAuthor`, `getUserProfile`) restores that glance-readability at the call site, while the composition logic stays where it belongs.

### Reusable Selection Pieces

A reusable chunk of selection-set is just a JS array. Define it once, spread it in wherever it's needed:

```js
var userCoreFields = [
    "firstName",
    "lastName",
    "email"
];

function getUserBasic() {
    return query(
        operationName("GetUserBasic"),
        root("user"),
        varArgs($v("id", "ID")),
        selectionSet(...userCoreFields)
    );
}

function getUserWithPosts() {
    return query(
        operationName("GetUserWithPosts"),
        root("user"),
        varArgs($v("id", "ID")),
        selectionSet(
            ...userCoreFields,
            $m("posts", [ "title", "publishedAt" ])
        )
    );
}
```

```graphql
query GetUserBasic($id: ID) {
    user(id: $id) {
        firstName
        lastName
        email
    }
}
```

```graphql
query GetUserWithPosts($id: ID) {
    user(id: $id) {
        firstName
        lastName
        email
        posts {
            title
            publishedAt
        }
    }
}
```

This is the named-fragment replacement. The array is the reusable shape, JS is the composition vocabulary, spread is the inclusion point. Unlike GraphQL fragments, the array isn't tied to a specific GraphQL type at the language level; it's just data, useable wherever it composes structurally.

The real power comes when the reusable piece itself takes parameters. GraphQL fragments cannot do this; JS functions trivially can:

```js
function postFields({ includeBody } = {}) {
    return [
        "title",
        "publishedAt",
        ...(includeBody ? [ "body" ] : [])
    ];
}

function getUserWithPostDetails() {
    return query(
        operationName("GetUserWithPostDetails"),
        root("user"),
        varArgs($v("id", "ID")),
        selectionSet(
            ...userCoreFields,
            $m("posts", postFields({ includeBody: true }))
        )
    );
}
```

```graphql
query GetUserWithPostDetails($id: ID) {
    user(id: $id) {
        firstName
        lastName
        email
        posts {
            title
            publishedAt
            body
        }
    }
}
```

`postFields` is a parameterized selection-shape: a value that can be called with options to produce a tailored array of fields. The composing query treats it like any other array, because that's what it is.
