# Design Philosophy

This document explains the design rationale behind `@gql-x/composer`: what it's trying to accomplish, what tradeoffs it makes, and what kinds of projects and developers it's likely to serve well (or poorly).

For the API reference, see [README.md](./README.md). For the rationale behind composer's extension surface (factory split, render protocol, internals access), see [EXTENSIBILITY.md](./EXTENSIBILITY.md).

## What This DSL Is For

Two primary pain points motivated the design:

1. **Variable bookkeeping.** In raw GraphQL strings, every variable has to be declared in the operation's parameter list *and* referenced at each use site. Adding, removing, or renaming a variable means editing multiple positions, and the parameter list lives far from the places it's actually used. The DSL annotates a variable's type at its use site and hoists the declaration automatically, with deduplication.

2. **Dynamic composition.** Arguments, selection-sets, and field-level references are first-class JS values in the DSL. They can be conditionally included, named, passed around, and combined using ordinary host-language logic — no string templating, no parameter-list maintenance.

A third theme runs through the design: **shifting meaning from syntactic position to explicit names.**

## On GraphQL's Native Composition Mechanisms

GraphQL itself has several mechanisms for varying what a query expresses. Before discussing host-language composition further, it's worth exploring where they fall short of the composition problem Composer addresses.

### Variables

GraphQL variables parameterize values: a `$userID` argument can vary per request without changing the query string. This is the cleanest in-language mechanism GraphQL offers, and Composer leans on it heavily; variable hoisting is one of Composer's two motivating problems.

But variables **vary values, not shape**. A query that needs a different field included, a different argument passed, or a different sub-selection structure depending on conditions -- that can't be expressed with variables alone.

### Named Fragments

Fragments let a reusable selection shape be declared once and referenced by name in multiple positions. They're useful for DRY-ing repeated sub-selections.

But the fragment itself is static; `UserCore` is the same `UserCore` everywhere. Fragments compose by reference, not by parameterization or conditional assembly.

### Inline fragments / type conditions (`... on Type`)

These handle polymorphism: when a field's type is wider than a single concrete type (interfaces, unions), an inline fragment narrows a branch of the selection-set.

This is a different axis from the conditionality discussed here; it's about type-narrowing at server-side resolution, not about choosing query shape at the client. Composer supports the type-condition form via `$f.on`, because the use case is real and orthogonal.

### `@skip` / `@include` Directives

These are the closest match to "conditional composition" in spec GraphQL: a directive on a field that suppresses it based on a variable's value. The query text contains both branches; the server evaluates the directive at execution time and omits the field from the response.

This last one is worth expanding on, because it's the mechanism that *looks* like it solves the problem Composer addresses. It doesn't, for several reasons:

* **Conditionality runs at the wrong end.** The host already knows whether the field is wanted; it's the host that set the variable. Pushing the decision to the server means parsing, validating, planning, and possibly resolving branches the host could have simply omitted. The server does work to answer a question the host already had the answer to.

* **The branches are static.** `@skip` and `@include` toggle a fixed branch. They don't let the *shape* of the branch vary; only its presence. A query that needs five different possible sub-selection shapes can't express that with `@skip` without enumerating all five inline and toggling four of them off.

* **No composition vocabulary.** `@skip` / `@include` are boolean toggles keyed on a single variable. There's no `@skipUnless`, no boolean combinators, no expressions. Any non-trivial conditional logic has to be evaluated host-side and reduced to a boolean before being passed in as a variable; at which point the host could have just composed the query directly and skipped the round-trip through directive evaluation.

* **Composition doesn't extend.** Once you reach for `@skip` for one branch, the next conditional concern doesn't compose with it; it has to be solved the same way, inline, in the query text. The complexity grows with the surface, not with the underlying logic.

In short, GraphQL's built-in composition mechanisms cover *value parameterization* (variables), *reference reuse* (named fragments), and *type-narrowing* (inline fragments). They don't cover *shape assembly from host-side conditions*.

That last category is the gap Composer is built for, and it's exactly where host-language composition has the cleanest fit; the language doing the composition is the same language that knows the conditions.

And the host language is a full Turing-complete language (like JS, etc) with proper and familiar mechanisms for decision making, looping, reuse, etc. That contrasts sharply against ad hoc, limited, in-GraphQL affordances like @directives and fragments.

## Where Composer Fits in the GraphQL Ecosystem

Most production GraphQL workflows put *something* between the developer and the raw query string. Codegen generates queries from schemas. Relay rewrites them at build time. Apollo wraps them in framework-specific machinery. Even `gql-tag` is, at minimum, a tagged-template function whose job is to mark a string as GraphQL for downstream tooling. The bare hand-typed string handed straight to the network layer is uncommon at scale — and where it does appear, it usually does so alongside other tooling that has already done some structural work.

A query-building DSL is one more point on that same continuum. It differs from the others in *what* it abstracts (composition rather than typing, caching, or binding) and *when* it runs (at the call site, in host-language values, rather than at compile or build time), but not in whether abstracting at all is reasonable. The question is which abstraction serves which kind of work.

Composer's particular bet is on **dynamic composition** as the abstraction worth optimizing for: queries whose shape varies with user input, permissions, feature flags, or local conditions. The widely-adopted alternatives are stronger on other axes — typed bindings, runtime caching, schema-driven scaffolding — and weaker on this one, because their representation of a query is either fixed at build time or expressed as a string-templated value that has to be threaded through host-language logic by hand.

Where dynamic shape isn't the dominant concern, composer earns its keep less and the existing tools cost less. Where it is, composer is meant to do the job those tools can't quite reach: turn the query itself into a first-class value of the host language, and let composition fall out of ordinary expressions, conditionals, and function calls.

Crucially, composer is **additive** to the ecosystem rather than a replacement for any part of it. Its output is plain, spec-compliant GraphQL text — the same surface every other GraphQL tool expects as input. The string composer emits can be handed to a schema validator, a linter, a Playground, a codegen pipeline, an IDE plugin, or any client transport (Apollo, urql, Relay, raw `fetch`) and it works. There's no bespoke runtime to adopt, no AST format only composer understands, no special handshake at the network layer. A team can introduce composer for the queries where dynamic composition pays off, and leave every other piece of their existing GraphQL stack — typing, caching, validation, codegen — exactly as it is. Composer slots underneath those layers, not in place of them.

The broader point — and the reason composer exists alongside, not instead of, the rest of the ecosystem — is that "what kind of abstraction over GraphQL is appropriate" is not a settled question with a single answer. Different abstractions serve different priorities, and a healthy ecosystem makes room for several. Composer is one shape that abstraction can take, designed around a specific axis the ecosystem currently underserves.

## Naming Over Positioning

In raw GraphQL, the meaning of each piece of a query is conveyed by where it sits. Arguments come before the selection-set. The selection-set nests inside the field. Field-level arguments sit inside parentheses on the field. These conventions are stable and learnable, but they're also implicit — a reader must know GraphQL syntax to understand which structural region defines what.

The DSL trades positional convention for explicit names: `selectionSet(...)`, `varArgs(...)`, `litArgs(...)`, `varDefs(...)`. Each piece of a query is labeled with its role rather than identified by where it appears.

This has two consequences:

**Position becomes malleable.** Because meaning is carried by names rather than positions, the order of arguments to a query builder is free. A query whose primary message is "what does this return" can lead with `selectionSet(...)`. A query primarily about a mutation can lead with `varArgs(...)` to foreground the inputs. The author chooses which aspect of the query to foreground, based on what matters about that particular query. This is an expressive freedom that raw GraphQL — with its fixed syntactic order — cannot offer.

**Shape is preserved where shape matters.** The flattening of positional convention applies to the *roles* of query parts, not to the structure of returned data. Inside `selectionSet(...)`, the nested shape of the response is preserved, because that nesting is genuinely meaningful — it tells the reader what they're going to get back. The DSL minimizes the syntactic tax around aliasing, arguments, and sub-selections within a selection-set, but the shape itself stays visible.

## On the Apparent "Opacity" of the DSL

A common reaction from developers fluent in raw GraphQL: the DSL feels opaque. It's harder, at first glance, to see what a query is doing or why.

Part of this is genuine learning curve. The DSL has a small vocabulary, but it is a vocabulary, and reading it fluently requires familiarity. We don't claim otherwise.

Part of it, though, is a category difference worth naming. Raw GraphQL syntax is **shape-heavy**: the visual structure of the query mirrors the shape of the response. The DSL is **intent-heavy**: each piece is labeled with its role. These are different cognitive modes — shape is parsed visually and in parallel, intent is read linguistically and sequentially. For a reader asking "what will this return," shape-heavy wins. For a reader asking "what is each piece doing and why," intent-heavy wins.

The DSL was deliberately built for the second question. For the first question, the answer is one level up: a well-named function around the DSL call (`getUserWithRecentPosts(userID, sinceDate)`) does the job of conveying intent at the call site. The DSL was never trying to make queries self-documenting at the point of definition; that's what function names are for.

## On Dynamic-Shape-as-Variable

One alternative to a composition DSL is to keep the query string static and pass dynamic structure as a variable, building that variable in the host language.

This pattern works cleanly when the shape is fixed and only values vary. The moment the shape itself needs to change — conditionally including a sub-selection field, a different argument set depending on user input, a comparator branch that's present only sometimes — the host-language logic to assemble the variable becomes structurally identical to what one would write with a composition DSL. The same conditionals, the same loops, the same merging. The values differ (`{ since: ... }` vs. `$v("since", ...)`), but the surrounding logic does not.

The real difference is **co-location**. With shape-as-variable, the query string and the assembled structure live in two textually separated places that must be kept in sync as the query evolves. With a composition DSL, the entire query is one expression and refactoring is local.

Neither pattern is wrong. Shape-as-variable has the advantage of keeping the query as a literal GraphQL string, usable directly in GraphQL-aware tooling. The DSL has the advantage of inlining composition logic where it's used. Each fits different workflows.

## On Extensibility as a First-Class Concern

Composer is designed from the start to be extended. It produces plain, spec-compliant GraphQL on its own, but its real architectural commitment is that **higher-level layers can register against it** — to add new syntactic vocabulary, new combinators, and new rendering behavior — without composer itself needing to know about any of it.

This is a deliberate departure from the predecessor in this space. The legacy `gql-query-builder` is essentially monolithic: its features (filter shapes, argument shapes, and so on) are baked in, and extending it means forking or wrapping. Composer treats extension as a primary use case, not an afterthought.

The motivation is practical. GraphQL is widely deployed, but the conventions around it vary enormously between backends: DefraDB has filters, aggregates, and `groupBy`; Hasura has its own filter and aggregate shapes; Postgraphile has another set; vendored backends invent their own. A query-building library that hard-codes any one of these conventions is implicitly placing a bet on a particular backend lineage. Composer makes a different bet: the underlying GraphQL surface is stable enough to support, and the backend-specific embellishments belong in layers that can be developed, versioned, and adopted independently.

This has real costs. Composer is more abstract than it would be if it embraced a single backend convention. Some of its design choices — closure-private per-instance state, a render protocol for tokens, a factory split between app-facing and plugin-facing entry points — exist primarily to serve plugin authors, and add complexity that pure app consumers don't directly benefit from. We've judged the tradeoff worthwhile: composer is meant to outlive any one backend's conventions, and that goal requires the seams be designed in, not bolted on.

For the actual mechanisms — factory shape, internals access, render protocol — see [EXTENSIBILITY.md](./EXTENSIBILITY.md).

## Who This Is For

The DSL is unlikely to displace raw GraphQL strings for developers who:

- Write mostly static queries
- Live primarily in GraphQL-native tooling (Playground, schema-aware IDEs)
- Already have an established workflow they're satisfied with

For those developers, the DSL is overhead. That's a fair assessment.

The DSL earns its keep for developers who:

- Compose queries dynamically based on user input, permissions, or feature flags
- Want variable hoisting and deduplication without manual bookkeeping
- Want to author queries in their host language with full editor support, and generate static artifacts as a build step
- Are working against a backend whose conventions aren't fully covered by a generic GraphQL client, and would prefer a layer designed for that backend over hand-rolling string templates
- Are not deeply familiar with raw GraphQL syntax and find it easier to think in their host language's primitives — objects, expressions, functions — than in a templated string DSL they have to internalize separately

Neither audience is wrong about its workflow. The DSL is one tool in a broad ecosystem, with its own affinities.

## Summary

The design accepts several tradeoffs in service of a coherent set of priorities:

- Explicit names over positional convention, accepting a learning curve in exchange for malleable composition and clearer role-labeling.
- First-class dynamic composition, accepting that static-query workflows gain less from the DSL than dynamic ones do.
- Shape-preservation inside selection-sets, accepting some local nesting in exchange for keeping return-value structure visible to readers.
- Extensibility as a first-class concern, accepting some additional abstraction in the core in exchange for a base that can outlive any one backend convention.

These are choices, not universal improvements. They serve some projects well and others poorly, and the goal of this document is to make the reasoning behind them legible.
