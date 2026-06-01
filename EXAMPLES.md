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
    query, mutation, subscription, raw,
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
    selectionSet("id", "name")
)
```

```graphql
query {
    viewer {
        id
        name
    }
}
```

The builder returns a result object, not just the text. The shape stays the same across every example below:

```js
{
    text: "query { viewer { id name } }",
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
    posts(authorID: $authorID, limit: 10, order: { publishedAt: DESC }) {
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
            $f`posts ${varArgs($v("since", "sinceTS", "Int"))}`,
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
            $f`recentPosts``posts ${varArgs($v("since", "sinceTS", "Int"))}`,
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
