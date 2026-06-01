export {
	createComposer,
	registerPlugin,
	isGQLName,
};


// *****************************

// avoid common probes becoming tokens
var $tReserved = new Set([
	"then",
	"toString",
	"valueOf",
	"inspect",
	"constructor",
	"__proto__",
	"prototype",
	"caller",
	"callee",
	"arguments",
	"render",
]);

var $dReserved = new Set([
	"then",
	"toString",
	"valueOf",
	"inspect",
	"constructor",
	"__proto__",
	"prototype",
	"caller",
	"callee",
	"arguments",
	"render",
]);

selectionSet.none = () => selectionSet(null);


// *****************************

function createComposer() {
	return buildComposer().api;
}

function registerPlugin(opts = {}) {
	return buildComposer(opts);
}

function buildComposer(opts = {}) {
	// per-composer-instance private state
	var $fStateSym = Symbol("gql.field.state");
	var $tNameSym = Symbol("gql.name");
	var $dTokenSym = Symbol("gql.directive");
	var $fMeta = new WeakMap();
	var $tCache = new Map();


	// *** $t: bare-name token proxy (DESC, UTC_NOW, etc) ***
	// also supports variable refs: $t.$email => $email
	var $t = new Proxy(Object.create(null),{
		get(t,p,r) {
			if (typeof p == "symbol") return undefined;
			if ($tReserved.has(p)) return undefined;

			// $t.$whatever => token("$whatever")
			if (typeof p == "string" && p[0] == "$") {
				if (!isGQLName(p.slice(1))) return undefined;
				return nameToken(p);
			}

			if (!isGQLName(p)) return undefined;
			return nameToken(p);
		},
	});


	// *** $d: graphql directive proxy ***
	// $d.foo => single-directive clause (no args)
	// $d.foo(varArgs(..), litArgs(..)) => single-directive clause (with args)
	var $d = new Proxy(Object.create(null),{
		get(t,p,r) {
			if (typeof p == "symbol") return undefined;
			if ($dReserved.has(p)) return undefined;
			if (!isGQLName(p)) return undefined;

			return makeDirectiveClause(p,[]);
		},
	});


	// *** readability alias for "no selection set" ***
	$f.noSelection = null;


	// *** $f.on: inline type condition tokens ***
	// $f.on("User") or $f.on`User` => "... on User"
	// requires a sub-selection (via $m or computed property key) at render time
	// no alias, no field args; directives are allowed
	$f.on = function $f_on(stringsOrTypeName,...values) {
		// *** function-call mode ***
		if (!Array.isArray(stringsOrTypeName) || !("raw" in stringsOrTypeName)) {
			var firstArg = unwrapType(stringsOrTypeName);

			if (!(typeof firstArg == "string" && firstArg != "")) {
				throw new Error("$f.on(..) requires a type name (string or $t token) as first arg");
			}
			if (!isGQLName(firstArg)) {
				throw new Error(`$f.on(..) invalid GQL name: ${firstArg}`);
			}

			// reject alias form: a second string would be alias-intent
			if (values.length >= 1 && typeof values[0] == "string") {
				throw new Error("$f.on(..) does not support alias form (inline fragments have no alias)");
			}

			var state = makeOnState(firstArg);

			if (values.length > 0) {
				mergeFieldDefs(state,mergeChunks(values,"$f.on(..) combinator"));
			}

			rejectOnStateExtras(state);

			return makeFieldToken(state);
		}

		// *** tagged template mode ***
		var strings = stringsOrTypeName;
		var parsed = parseTaggedName(strings,values,{
			allowInterpolation: true,
			allowTrailingColon: false,
		});

		if (!isGQLName(parsed.name)) {
			throw new Error(`$f.on(..) invalid GQL name: ${parsed.name}`);
		}

		// reject $f tokens as interpolation — they'd silently no-op
		if (parsed.extra && is$fToken(parsed.extra)) {
			throw new Error("$f.on(..) does not accept $f tokens as interpolation");
		}

		var state = makeOnState(parsed.name);

		mergeFieldDefs(state,parsed.extra);

		rejectOnStateExtras(state);

		return makeFieldToken(state);
	};


	var api = {
		$f, $t, $v, $m, $d,
		varArgs, litArgs, varDefs, operationName,
		selectionSet, root, directives,
		raw, query, mutation, subscription,
		isGQLName,
	};

	var _internals = {
		makeFieldToken,
		is$fToken,
		get$fSymbol,
		$fMeta,
		nameToken,
		is$tToken,
		get$tTokenName,
		isDirectiveToken,
		getDirectiveTokenData,
	};

	return { api, _internals, };


	// ******************************

	function makeOnState(typeName) {
		return {
			stage: "final",
			pendingName: null,
			alias: null,
			field: null,
			inlineTypeCondition: typeName,
			argsWrapper: null,
			varArgs: null,
			litArgs: null,
			directives: null,
			sym: null,
		};
	}

	function rejectOnStateExtras(state) {
		if (state.varArgs != null || state.litArgs != null || state.argsWrapper != null) {
			throw new Error("$f.on(..) does not accept field args (inline fragments have no args)");
		}
	}

	function nameToken(name) {
		if ($tCache.has(name)) return $tCache.get(name);

		var tok = {
			[$tNameSym]: name,
			toString() { return name; },
			render(renderCtx) { return name; },
		};
		$tCache.set(name,tok);
		return tok;
	}

	function is$tToken(v) {
		return !!(v && typeof v == "object" && v[$tNameSym]);
	}

	function get$tTokenName(v) {
		return v[$tNameSym];
	}

	function unwrapType(v) {
		return is$tToken(v) ? get$tTokenName(v) : v;
	}

	function is$fToken(v) {
		return !!(typeof v == "function" && v[$fStateSym]);
	}

	function get$fSymbol(v) {
		return (typeof v == "symbol") ? v : v[Symbol.toPrimitive]("default");
	}

	function isDirectiveToken(v) {
		return !!(typeof v == "function" && v[$dTokenSym]);
	}

	function getDirectiveTokenData(v) {
		return v[$dTokenSym];
	}

	// returns a callable that is ALSO a single-directive clause.
	// - bare ($d.foo) usable directly as a clause: { directives: [<tok>] }
	// - called ($d.foo(..)) returns a fresh clause w/ args attached
	function makeDirectiveClause(name,args) {
		// the callable itself
		var tok = function directiveCallable(...combinators) {
			return makeDirectiveClause(name,combinators);
		};

		// directive-token brand + payload
		tok[$dTokenSym] = { name, args, };

		// render protocol: emits "@name" or "@name(args)"
		tok.render = function renderDirective(renderCtx) {
			return renderDirectiveToken(tok,renderCtx);
		};

		// clause shape: this callable IS a directives-clause containing itself
		Object.defineProperty(tok,"directives",{
			enumerable: true,
			configurable: false,
			get() { return [ tok ]; },
		});

		return tok;
	}

	// renders a single directive token to "@name" or "@name(args)"
	function renderDirectiveToken(tok,renderCtx) {
		var { name, args, } = getDirectiveTokenData(tok);

		if (!args || args.length == 0) {
			return `@${name}`;
		}

		// build a synthetic field-meta from the directive's arg combinators
		// and reuse the args-rendering pipeline
		var merged = mergeChunks(args,`$d.${name}(..) part`);

		var synthMeta = {
			field: name,
			argsWrapper: null,
			varArgs: merged.varArgs || null,
			litArgs: merged.litArgs || null,
		};

		var { varDefs, argsStr, } = renderCtx.renderFieldMeta(synthMeta);
		renderCtx.addVarDefs(varDefs,`$d.${name}`);

		// empty parens are invalid graphql — collapse to bare @name
		if (!argsStr || argsStr == "()") {
			return `@${name}`;
		}

		return `@${name}${argsStr}`;
	}

	function makeFieldToken(state) {
		var tok = function tokenTag(strings,...values) {
			var st = tok[$fStateSym];

			if (st.stage != "pending") {
				throw new Error("$f field ref cannot be tagged more than twice");
			}

			if (
				strings.length == 2 &&
				strings[0] === "" &&
				strings[1] === "" &&
				values.length == 1
			) {
				let extra = values[0];

				st.alias = st.pendingName;
				st.stage = "final";

				if (is$fToken(extra)) {
					let sym = get$fSymbol(extra);
					let meta = $fMeta.get(sym);
					if (!meta) {
						throw new Error("Invalid $f interpolation token");
					}
					if (meta.inlineTypeCondition) {
						throw new Error("Cannot alias an $f.on inline-type-condition token");
					}
					st.field = meta.field;
					st.argsWrapper = meta.argsWrapper || null;
					st.varArgs = meta.varArgs || null;
					st.litArgs = meta.litArgs || null;
					st.directives = meta.directives || null;
				}
				else {
					if (!(extra && typeof extra == "object")) {
						throw new Error("Interpolation must be an object or array of chunks");
					}
					if (Array.isArray(extra)) {
						extra = mergeChunks(extra,"$f interpolation chunk");
					}
					mergeFieldDefs(st,extra);
				}

				return tok;
			}

			var parsed = parseTaggedName(strings,values,{
				allowInterpolation: true,
				allowTrailingColon: false,
			});

			st.alias = st.pendingName;
			st.field = parsed.name;
			st.stage = "final";

			mergeFieldDefs(st,parsed.extra);

			return tok;
		};

		tok[$fStateSym] = state;

		tok[Symbol.toPrimitive] = function toPrim(hint) {
			var st = tok[$fStateSym];

			if (st.stage == "pending") {
				st.field = st.pendingName;
				st.stage = "final";
			}

			if (!st.sym) {
				st.sym = Symbol(st.field || st.inlineTypeCondition || "");

				$fMeta.set(st.sym,Object.freeze({
					field: st.field,
					alias: st.alias || null,
					argsWrapper: st.argsWrapper || null,
					varArgs: st.varArgs || null,
					litArgs: st.litArgs || null,
					directives: st.directives || null,
					inlineTypeCondition: st.inlineTypeCondition || null,
				}));
			}

			return st.sym;
		};

		return tok;
	}

	function $f(stringsOrAlias,...values) {
		// *** function-call mode ***
		if (!Array.isArray(stringsOrAlias) || !("raw" in stringsOrAlias)) {
			var firstArg = stringsOrAlias;

			if (is$fToken(firstArg)) {
				let sym = get$fSymbol(firstArg);
				let meta = $fMeta.get(sym);
				if (!meta) {
					throw new Error("Invalid $f token");
				}
				if (meta.inlineTypeCondition) {
					throw new Error("Cannot re-wrap an $f.on inline-type-condition token via $f(..)");
				}
				let state = {
					stage: "final",
					pendingName: null,
					alias: null,
					field: meta.field,
					inlineTypeCondition: null,
					argsWrapper: meta.argsWrapper || null,
					varArgs: meta.varArgs || null,
					litArgs: meta.litArgs || null,
					directives: meta.directives || null,
					sym: null,
				};
				return makeFieldToken(state);
			}

			if (!(typeof firstArg == "string" && firstArg != "")) {
				throw new Error("$f(..) requires a field/alias name or $a token as first arg");
			}
			if (!isGQLName(firstArg)) {
				throw new Error(`$f(..) invalid GQL name: ${firstArg}`);
			}

			if (values.length >= 1 && is$fToken(values[0])) {
				let tokIn = values[0];
				let sym = get$fSymbol(tokIn);
				let meta = $fMeta.get(sym);
				if (!meta) {
					throw new Error("Invalid $f token");
				}
				if (meta.inlineTypeCondition) {
					throw new Error("Cannot alias an $f.on inline-type-condition token");
				}
				let state = {
					stage: "final",
					pendingName: null,
					alias: firstArg,
					field: meta.field,
					inlineTypeCondition: null,
					argsWrapper: meta.argsWrapper || null,
					varArgs: meta.varArgs || null,
					litArgs: meta.litArgs || null,
					directives: meta.directives || null,
					sym: null,
				};
				if (values.length > 1) {
					mergeFieldDefs(state, mergeChunks(values.slice(1),"$f(..) combinator"));
				}
				return makeFieldToken(state);
			}

			var alias = null;
			var fieldName = firstArg;
			var combinators = values;

			if (
				values.length >= 1 &&
				typeof values[0] == "string" &&
				values[0] != "" &&
				isGQLName(values[0])
			) {
				alias = firstArg;
				fieldName = values[0];
				combinators = values.slice(1);
			}

			var state = {
				stage: "final",
				pendingName: null,
				alias,
				field: fieldName,
				inlineTypeCondition: null,
				argsWrapper: null,
				varArgs: null,
				litArgs: null,
				directives: null,
				sym: null,
			};

			if (combinators.length > 0) {
				mergeFieldDefs(state, mergeChunks(combinators,"$f(..) combinator"));
			}

			return makeFieldToken(state);
		}

		// *** tagged template mode ***
		var strings = stringsOrAlias;
		var parsed = parseTaggedName(strings,values,{
			allowInterpolation: true,
			allowTrailingColon: true,
		});

		var extraConfig = parsed.extra;

		if (is$fToken(extraConfig)) {
			let sym = get$fSymbol(extraConfig);
			let meta = $fMeta.get(sym);
			if (!meta) {
				throw new Error("Invalid $f interpolation token");
			}
			if (meta.inlineTypeCondition) {
				throw new Error("Cannot alias an $f.on inline-type-condition token");
			}
			extraConfig = {
				field: meta.field,
				argsWrapper: meta.argsWrapper,
				varArgs: meta.varArgs,
				litArgs: meta.litArgs,
				directives: meta.directives,
			};
		}

		var state = {
			stage: "pending",
			pendingName: parsed.name,
			alias: null,
			field: null,
			inlineTypeCondition: null,
			argsWrapper: null,
			varArgs: null,
			litArgs: null,
			directives: null,
			sym: null,
		};

		mergeFieldDefs(state,extraConfig);

		if (extraConfig && extraConfig.field) {
			state.alias = state.pendingName;
			state.pendingName = null;
			state.stage = "final";
		}

		return makeFieldToken(state);
	}

	function $v(...args) {
		if (
			args.length >= 1 &&
			!(typeof args[0] == "string" && args[0] != "")
		) {
			return mergeChunks(args,"$v(..) part");
		}

		let [ name, a, b ] = args;
		a = unwrapType(a);
		b = unwrapType(b);

		if (!(typeof name == "string" && name != "")) {
			throw new Error("$v(..) requires a field/arg name");
		}

		if (
			typeof a == "string" &&
			a != "" &&
			b === undefined
		) {
			return {
				[name]: a,
			};
		}

		if (
			typeof a == "string" &&
			a != "" &&
			typeof b == "string" &&
			b != ""
		) {
			return {
				[name]: { [a]: b },
			};
		}

		throw new Error("$v(..) expects (name,type) or (name,varName,type)");
	}

	function $m(name,...rest) {
		if (is$fToken(name) || typeof name == "symbol") {
			name = get$fSymbol(name);
		}
		else if (!(typeof name == "string" && name != "")) {
			throw new Error("$m(..) requires a property name, $f token, or symbol");
		}

		if (rest.length == 0) {
			throw new Error("$m(..) requires at least a name and value");
		}

		var inner;

		if (rest.length == 1) {
			inner = rest[0];
		}
		else if (rest.every(isChunkObject)) {
			inner = mergeChunks(rest,"$m(..) part");
		}
		else {
			throw new Error("$m(..) trailing args must be a single value or multiple chunk-objects");
		}

		return { [name]: inner, };
	}

	function mergeFieldDefs(state,extra) {
		if (!extra) return;

		var { field, argsWrapper, varArgs, varFilters, litArgs, litFilters, directives: dirs, } = extra;

		if (field != null) {
			if (!(typeof field == "string" && field.trim() != "")) {
				throw new Error("field must be a non-empty string");
			}
			field = field.trim();
			if (!isGQLName(field)) {
				throw new Error("field must be a valid GraphQL name");
			}
			state.field = field;
		}

		if (argsWrapper != null) {
			if (!(argsWrapper && typeof argsWrapper.render == "function")) {
				throw new Error("argsWrapper must be a render-protocol token");
			}
			state.argsWrapper = argsWrapper;
		}

		if (varArgs != null) {
			if (!(varArgs && typeof varArgs == "object" && !Array.isArray(varArgs))) {
				throw new Error("varArgs must be an object");
			}
			state.varArgs = Object.assign(Object.create(null),state.varArgs || null,varArgs);
		}

		if (varFilters != null) {
			if (!(varFilters && typeof varFilters == "object" && !Array.isArray(varFilters))) {
				throw new Error("varFilters must be an object");
			}
			if (state.varArgs == null) state.varArgs = Object.create(null);
			state.varArgs.filter = Object.assign(Object.create(null),state.varArgs.filter || null,varFilters);
		}

		if (litArgs != null) {
			if (!(litArgs && typeof litArgs == "object" && !Array.isArray(litArgs))) {
				throw new Error("litArgs must be an object");
			}
			state.litArgs = Object.assign(Object.create(null),state.litArgs || null,litArgs);
		}

		if (litFilters != null) {
			if (!(litFilters && typeof litFilters == "object" && !Array.isArray(litFilters))) {
				throw new Error("litFilters must be an object");
			}
			if (state.litArgs == null) state.litArgs = Object.create(null);
			state.litArgs.filter = Object.assign(Object.create(null),state.litArgs.filter || null,litFilters);
		}

		if (dirs != null) {
			if (!Array.isArray(dirs)) {
				throw new Error("directives must be an array of directive tokens");
			}
			for (let d of dirs) {
				if (!isDirectiveToken(d)) {
					throw new Error("directives entries must be $d directive tokens");
				}
			}
			// last-write-wins, consistent with other clause kinds
			state.directives = dirs.slice();
		}
	}

	function raw(...args) {
		var {
			root,
			namePrefix = "",
			nonPrefixedTypes = [],
			kind = "query",
			operationName = "",
			varArgs = null,
			litArgs = null,
			varDefs = null,
			varInputs = null,
			varFilters = null,
			litInputs = null,
			litFilters = null,
			selectionSet = "_docID",
		} = mergeChunks(args,"raw(..) arg");

		namePrefix = namePrefix || "";

		if (!(root && typeof root == "object" && typeof root.field == "string" && root.field != "")) {
			throw new Error("raw requires root.field");
		}

		if (!isGQLName(root.field)) {
			throw new Error(`raw: invalid GQL name for root field: ${root.field}`);
		}

		var omitOperationName = (operationName == null || operationName === "");
		operationName = omitOperationName ? null : operationName;

		var allVarDefs = Object.create(null);

		var rootMeta = {
			field: root.field,
			alias: root.alias || null,
			argsWrapper: root.argsWrapper || null,
			varArgs: null,
			litArgs: null,
			directives: (Array.isArray(root.directives) ? root.directives.slice() : null),
		};

		if (varInputs != null) {
			if (varArgs == null) varArgs = Object.create(null);
			varArgs.input = Object.assign(Object.create(null),varArgs.input || null,varInputs);
		}
		if (varFilters != null) {
			if (varArgs == null) varArgs = Object.create(null);
			varArgs.filter = Object.assign(Object.create(null),varArgs.filter || null,varFilters);
		}

		if (litInputs != null) {
			if (litArgs == null) litArgs = Object.create(null);
			litArgs.input = Object.assign(Object.create(null),litArgs.input || null,litInputs);
		}
		if (litFilters != null) {
			if (litArgs == null) litArgs = Object.create(null);
			litArgs.filter = Object.assign(Object.create(null),litArgs.filter || null,litFilters);
		}

		if (varArgs != null) {
			if (!(typeof varArgs == "object" && !Array.isArray(varArgs))) {
				throw new Error("varArgs must be a non-array object");
			}
			rootMeta.varArgs = Object.assign(Object.create(null),rootMeta.varArgs || null,varArgs);
		}

		if (litArgs != null) {
			if (!(typeof litArgs == "object" && !Array.isArray(litArgs))) {
				throw new Error("litArgs must be a non-array object");
			}
			rootMeta.litArgs = Object.assign(Object.create(null),rootMeta.litArgs || null,litArgs);
		}

		if (varDefs != null) {
			if (!(typeof varDefs == "object" && !Array.isArray(varDefs))) {
				throw new Error("varDefs must be a non-array object");
			}

			for (let [ varName, type, ] of Object.entries(varDefs)) {
				let normType = normalizeType(type,namePrefix,nonPrefixedTypes);
				addVarDefs({ [varName]: normType, }, "varDefs", allVarDefs);
			}
		}

		// top-level directives:[..] chunks attach to the OPERATION,
		// not the root field. root-field directives come via root().directives(..)
		var opDirectives = extractTopDirectives(args);

		var sel = (
			selectionSet ?
				renderSelectionSetEx(selectionSet,namePrefix,nonPrefixedTypes,"selectionSet") :
				null
		);
		if (sel) {
			addVarDefs(sel.varDefs,"selectionSet",allVarDefs);
		}

		// compute rootField + rootAlias (default behavior; root chunk may override)
		var rootFieldBase = (
			nonPrefixedTypes.includes(rootMeta.field) ?
				rootMeta.field :
				`${namePrefix}${rootMeta.field}`
		);
		var rootField = rootFieldBase;
		var rootAlias = (
			rootMeta.alias != null ?
				rootMeta.alias :
				(rootField !== rootMeta.field ? rootMeta.field : null)
		);

		// dispatch to root chunk's render() if present — lets defradb override
		// field/alias/args computation entirely (e.g., for `over`)
		if (root.render && typeof root.render == "function") {
			let result = root.render({
				namePrefix,
				nonPrefixedTypes,
				field: rootMeta.field,
				alias: rootMeta.alias,
				normalizeType: t => normalizeType(t,namePrefix,nonPrefixedTypes),
			});
			rootField = result.rootField;
			rootAlias = result.rootAlias;
		}

		var { varDefs: rootArgVarDefs, argsStr: rootArgsStr, } = renderArgsFromFieldMeta(
			rootMeta,
			namePrefix,
			nonPrefixedTypes,
			"root"
		);
		addVarDefs(rootArgVarDefs,"root",allVarDefs);

		var { varDefs: rootDirVarDefs, directivesStr: rootDirectivesStr, } = renderDirectivesFromFieldMeta(
			rootMeta,
			namePrefix,
			nonPrefixedTypes,
			"root"
		);
		addVarDefs(rootDirVarDefs,"root.directives",allVarDefs);

		// render operation-level directives FIRST (before allVarDefsStr is
		// built and before opName fallback) so any vars introduced by directive
		// args are folded into both
		var opDirectivesStr = "";
		if (opDirectives && opDirectives.length > 0) {
			let { varDefs: opDirVarDefs, directivesStr, } = renderDirectivesFromFieldMeta(
				{ directives: opDirectives, },
				namePrefix,
				nonPrefixedTypes,
				"operation"
			);
			addVarDefs(opDirVarDefs,"operation.directives",allVarDefs);
			opDirectivesStr = directivesStr;
		}

		var allVarDefsStr = (
			Object.entries(allVarDefs)
				.map(([varName,type]) => `$${varName}:${type}`)
				.join(",")
		);

		if (operationName == null) {
			operationName = (
				allVarDefsStr ?
					(
						kind == "mutation" ? "Mutation" :
						kind == "subscription" ? "Subscription" :
						"Query"
					) :
					null
			);
		}

		var aliasStr = rootAlias != null ? `${rootAlias}: ` : "";

		var queryText =
`${kind}${operationName != null ? ` ${operationName}` : ""}${allVarDefsStr ? `(${allVarDefsStr})` : ""}${opDirectivesStr} {
	${aliasStr}${rootField}${rootArgsStr}${rootDirectivesStr}${sel ? ` {
		${sel.text}
	}` : ""}
}`;

		return {
			text: queryText,
			opName: operationName,
			resName: (rootAlias || rootField),
			kind,
		};
	}

	// scans the raw(..) arg list (pre-merge) for any top-level
	// directives:[..] chunks. last-write-wins, consistent with Object.assign.
	// only ENUMERABLE own properties count — root()'s fluent .directives(..)
	// method is non-enumerable and must not be mistaken for a directives clause.
	function extractTopDirectives(rawArgs) {
		var found = null;
		for (let chunk of rawArgs) {
			if (chunk == null) continue;
			if (!isChunkObject(chunk)) continue;
			let desc = Object.getOwnPropertyDescriptor(chunk,"directives");
			if (!desc || !desc.enumerable) continue;
			let dirs = chunk.directives;
			if (!Array.isArray(dirs)) {
				throw new Error("directives must be an array of directive tokens");
			}
			for (let d of dirs) {
				if (!isDirectiveToken(d)) {
					throw new Error("directives entries must be $d directive tokens");
				}
			}
			found = dirs.slice();
		}
		return found;
	}

	function query(...args) {
		// preset kind:"query" — overrides any kind in passed chunks/objects
		return raw(...args,{ kind: "query", });
	}

	function mutation(...args) {
		// preset kind:"mutation" — overrides any kind in passed chunks/objects
		return raw(...args,{ kind: "mutation", });
	}

	function subscription(...args) {
		// preset kind:"subscription" — overrides any kind in passed chunks/objects
		return raw(...args,{ kind: "subscription", });
	}

	function renderArgsFromFieldMeta(meta,namePrefix,nonPrefixedTypes,sourceLabel) {
		var varDefs = Object.create(null);
		var argsMap = Object.create(null);

		if (meta.varArgs) {
			let built = buildArgsMapFromVarArgs(meta.varArgs,namePrefix,nonPrefixedTypes,sourceLabel);
			addVarDefs(built.varDefs,`${sourceLabel}.varArgs`,varDefs);

			for (let [ k, v, ] of Object.entries(built.argsMap)) {
				addActionArg(k,v,`${sourceLabel}.varArgs`,argsMap);
			}
		}

		if (meta.litArgs) {
			if (!(
				typeof meta.litArgs == "object" &&
				meta.litArgs != null &&
				!Array.isArray(meta.litArgs)
			)) {
				throw new Error("litArgs must be a non-array object");
			}

			var renderCtx = {
				namePrefix,
				nonPrefixedTypes,
				renderFieldMeta(meta) {
					return renderArgsFromFieldMeta(meta,namePrefix,nonPrefixedTypes,sourceLabel);
				},
				addVarDefs(defs,label) {
					addVarDefs(defs,label || sourceLabel,varDefs);
				},
			};

			for (let [ k, v, ] of Object.entries(meta.litArgs)) {
				if (v && typeof v.render == "function") {
					argsMap[k] = v.render(renderCtx);
					continue;
				}

				let litStr = renderLitValue(v,renderCtx);

				if (k == "filter" && argsMap.filter) {
					argsMap.filter = mergeObjLiteralStrings(argsMap.filter,litStr);
					continue;
				}

				if (k == "input" && argsMap.input) {
					argsMap.input = mergeObjLiteralStrings(argsMap.input,litStr);
					continue;
				}

				if (argsMap[k]) {
					throw new Error(`Duplicate field arg "${k}" between varArgs and litArgs (${sourceLabel})`);
				}
				argsMap[k] = litStr;
			}
		}

		var innerArgsStr = (
			Object.keys(argsMap).length > 0 ?
				Object.entries(argsMap).map(([k,v]) => `${k}:${v}`).join(",") :
				""
		);

		// if argsWrapper present, dispatch to its render() to produce wrapped args
		if (meta.argsWrapper) {
			let wrapperRenderCtx = {
				namePrefix,
				nonPrefixedTypes,
				normalizeType: t => normalizeType(t,namePrefix,nonPrefixedTypes),
				addVarDefs(defs,label) {
					addVarDefs(defs,label || sourceLabel,varDefs);
				},
			};
			return {
				varDefs,
				argsStr: meta.argsWrapper.render(wrapperRenderCtx,innerArgsStr),
			};
		}

		var argsStr = (innerArgsStr ? `(${innerArgsStr})` : "");

		return { varDefs, argsStr, };
	}

	function renderDirectivesFromFieldMeta(meta,namePrefix,nonPrefixedTypes,sourceLabel) {
		var varDefs = Object.create(null);

		if (!meta.directives || meta.directives.length == 0) {
			return { varDefs, directivesStr: "", };
		}

		var renderCtx = {
			namePrefix,
			nonPrefixedTypes,
			renderFieldMeta(m) {
				return renderArgsFromFieldMeta(m,namePrefix,nonPrefixedTypes,`${sourceLabel}.directive`);
			},
			addVarDefs(defs,label) {
				addVarDefs(defs,label || `${sourceLabel}.directive`,varDefs);
			},
		};

		var parts = meta.directives.map(d => d.render(renderCtx));
		return { varDefs, directivesStr: ` ${parts.join(" ")}`, };
	}

	function buildArgsMapFromVarArgs(varArgs,namePrefix,nonPrefixedTypes,sourceLabel) {
		if (!(
			typeof varArgs == "object" &&
			varArgs != null &&
			!Array.isArray(varArgs)
		)) {
			throw new Error("varArgs must be a non-array object");
		}

		var varDefs = Object.create(null);
		var argsMap = Object.create(null);

		for (let [ argName, spec, ] of Object.entries(varArgs)) {
			if ((argName == "input" || argName == "filter") &&
				spec != null &&
				typeof spec == "object" &&
				!Array.isArray(spec)
			) {
				let [ payloadVarDefs, payloadStr, ] = buildVarPayload(
						spec,
						namePrefix,
						nonPrefixedTypes,
						argName,
						{ inFilter: (argName == "filter"), }
					);

				addVarDefs(payloadVarDefs,`${sourceLabel}.varArgs(${argName})`,varDefs);

				addActionArg(
					argName,
					`{${payloadStr}}`,
					`${sourceLabel}.varArgs(${argName})`,
					argsMap
				);
			}
			else {
				let varName;
				let type;

				if (typeof spec == "string") {
					varName = argName;
					type = spec;
				}
				else if (
					spec != null &&
					typeof spec == "object" &&
					isVarMappingLeaf(spec)
				) {
					let [ vn, t, ] = Object.entries(spec)[0];
					varName = vn;
					type = t;
				}
				else {
					throw new Error(`Invalid varArgs spec for "${argName}"`);
				}

				let normType = normalizeType(type,namePrefix,nonPrefixedTypes);
				addVarDefs({ [varName]: normType, },`${sourceLabel}.varArgs(${argName})`,varDefs);

				addActionArg(
					argName,
					`$${varName}`,
					`${sourceLabel}.varArgs(${argName})`,
					argsMap
				);
			}
		}

		return { varDefs, argsMap, };
	}

	function buildVarPayload(payload,namePrefix,nonPrefixedTypes,argName,{ inFilter = false, fieldName = null, } = {}) {
		if (Array.isArray(payload)) {
			let allVarDefs = Object.create(null);
			let parts = [];

			for (let entry of payload) {
				if (!(
					entry &&
					typeof entry == "object" &&
					!Array.isArray(entry)
				)) {
					throw new Error("Invalid var payload spec");
				}

				let [ subVarDefs, subPayloadStr, ] = buildVarPayload(
					entry,
					namePrefix,
					nonPrefixedTypes,
					argName,
					{ inFilter, fieldName, }
				);
				addVarDefs(subVarDefs, `${argName}Args`, allVarDefs);

				parts.push(`{${subPayloadStr}}`);
			}

			return [ allVarDefs, `[${parts.join(",")}]`, ];
		}

		if (!(
			typeof payload == "object" &&
			payload != null &&
			!Array.isArray(payload)
		)) {
			throw new Error("Invalid var payload spec");
		}

		var allVarDefs = Object.create(null);
		var payloadStr = "";
		var isFirst = true;

		for (let [ field, spec, ] of Object.entries(payload)) {
			if (!isFirst) payloadStr += ",";
			isFirst = false;

			if (
				inFilter &&
				[ "_and", "_or", "_not", "_any", "_all", ].includes(field)
			) {
				if ([ "_not", "_any", "_all", ].includes(field)) {
					if (!(spec && typeof spec == "object" && !Array.isArray(spec))) {
						throw new Error("Invalid filter var payload spec: _not expects an object");
					}
					let [ subVarDefs, subPayloadStr, ] = buildVarPayload(
						spec,
						namePrefix,
						nonPrefixedTypes,
						argName,
						{ inFilter, fieldName, }
					);
					addVarDefs(subVarDefs, `${argName}Args`, allVarDefs);
					payloadStr += `${field}:{${subPayloadStr}}`;
				}
				else {
					if (!Array.isArray(spec)) {
						throw new Error("Invalid filter var payload spec");
					}
					let [ subVarDefs, subPayloadStr, ] = buildVarPayload(
						spec,
						namePrefix,
						nonPrefixedTypes,
						argName,
						{ inFilter, fieldName, }
					);
					addVarDefs(subVarDefs, `${argName}Args`, allVarDefs);
					payloadStr += `${field}:${subPayloadStr}`;
				}
				continue;
			}

			if (inFilter && fieldName != null && typeof spec == "string") {
				let normType = normalizeType(spec,namePrefix,nonPrefixedTypes);
				addVarDefs({ [fieldName]: normType, }, `${argName}Args`, allVarDefs);
				payloadStr += `${field}:$${fieldName}`;
				continue;
			}

			if (
				inFilter &&
				fieldName != null &&
				isVarMappingLeaf(spec) &&
				!Object.keys(spec)[0].startsWith("_")
			) {
				let [ varName, type, ] = Object.entries(spec)[0];
				let normType = normalizeType(type,namePrefix,nonPrefixedTypes);
				addVarDefs({ [varName]: normType, }, `${argName}Args`, allVarDefs);
				payloadStr += `${field}:$${varName}`;
				continue;
			}

			if (!inFilter && spec != null && typeof spec == "object" && !Array.isArray(spec) && isVarMappingLeaf(spec)) {
				let [ varName, type, ] = Object.entries(spec)[0];
				let normType = normalizeType(type,namePrefix,nonPrefixedTypes);

				addVarDefs({ [varName]: normType, }, `${argName}Args`, allVarDefs);
				payloadStr += `${field}:$${varName}`;
			}
			else if (Array.isArray(spec)) {
				let [ subVarDefs, subPayloadStr, ] = buildVarPayload(
					spec,
					namePrefix,
					nonPrefixedTypes,
					argName,
					{ inFilter, fieldName, }
				);
				addVarDefs(subVarDefs, `${argName}Args`, allVarDefs);
				payloadStr += `${field}:${subPayloadStr}`;
			}
			else if (spec != null && typeof spec == "object") {
				let nextFieldName = null;
				if (inFilter) {
					nextFieldName = (
						field.startsWith("_") && fieldName != null ?
							fieldName :
							field
					);
				}

				let [ subVarDefs, subPayloadStr, ] = buildVarPayload(
					spec,
					namePrefix,
					nonPrefixedTypes,
					argName,
					{ inFilter, fieldName: nextFieldName, }
				);
				addVarDefs(subVarDefs, `${argName}Args`, allVarDefs);
				payloadStr += `${field}:{${subPayloadStr}}`;
			}
			else if (typeof spec == "string") {
				let normType = normalizeType(spec,namePrefix,nonPrefixedTypes);
				addVarDefs({ [field]: normType, }, `${argName}Args`, allVarDefs);
				payloadStr += `${field}:$${field}`;
			}
			else {
				throw new Error("Invalid var payload spec");
			}
		}

		return [ allVarDefs, payloadStr, ];
	}

	function renderSelectionSetEx(selection,namePrefix,nonPrefixedTypes,sourceLabel = "selectionSet") {
		var allVarDefs = Object.create(null);

		return {
			varDefs: allVarDefs,
			text: render(selection,sourceLabel),
		};


		// ************************

		function mergeDefs(newDefs,label) {
			addVarDefs(newDefs,label,allVarDefs);
		}

		function render(sel,ctxLabel) {
			if (typeof sel == "string") {
				return sel;
			}
			else if (Array.isArray(sel)) {
				return sel.map(v => render(v,ctxLabel)).join(" ");
			}
			else if (typeof sel == "symbol" || is$fToken(sel)) {
				let sym = get$fSymbol(sel);
				let meta = $fMeta.get(sym);
				if (!meta) {
					throw new Error("Invalid selectionSet ($f token not registered)");
				}

				// inline-type-condition tokens must have a sub-selection;
				// they cannot appear bare at the top of a selection array.
				if (meta.inlineTypeCondition) {
					throw new Error("$f.on inline fragment requires a sub-selection; use $m or a computed property key");
				}

				let { varDefs, argsStr, } = renderArgsFromFieldMeta(
					meta,
					namePrefix,
					nonPrefixedTypes,
					`${ctxLabel}.${meta.alias || meta.field}`
				);
				mergeDefs(varDefs,`${ctxLabel}.${meta.field}.args`);

				let { varDefs: dirVarDefs, directivesStr, } = renderDirectivesFromFieldMeta(
					meta,
					namePrefix,
					nonPrefixedTypes,
					`${ctxLabel}.${meta.alias || meta.field}`
				);
				mergeDefs(dirVarDefs,`${ctxLabel}.${meta.field}.directives`);

				let aliasStr = meta.alias ? `${meta.alias}: ` : "";
				return `${aliasStr}${meta.field}${argsStr}${directivesStr}`;
			}
			else if (sel != null && typeof sel == "object") {
				let keys = Reflect.ownKeys(sel);

				if (keys.length == 1 && typeof keys[0] == "string") {
					let field = keys[0];
					let subSel = sel[field];
					return `${field} { ${render(subSel,`${ctxLabel}.${field}`)} }`;
				}

				if (keys.length >= 1 && keys.every(k => typeof k == "symbol")) {
					let parts = [];

					for (let k of keys) {
						let meta = $fMeta.get(k);
						if (!meta) {
							throw new Error("Invalid selectionSet (unknown symbol key)");
						}

						let subSel = sel[k];

						// inline-type-condition branch — different shape entirely:
						// "... on TypeName <directives> { subSel }"; no alias, no args.
						if (meta.inlineTypeCondition) {
							if (subSel == null) {
								throw new Error("$f.on inline fragment requires a sub-selection");
							}

							let typeName = normalizeType(
								meta.inlineTypeCondition,
								namePrefix,
								nonPrefixedTypes
							);

							let label = `${ctxLabel}.on(${meta.inlineTypeCondition})`;

							let { varDefs: dirVarDefs, directivesStr, } = renderDirectivesFromFieldMeta(
								meta,
								namePrefix,
								nonPrefixedTypes,
								label
							);
							mergeDefs(dirVarDefs,`${label}.directives`);

							parts.push(
								`... on ${typeName}${directivesStr} { ${render(subSel,label)} }`
							);
							continue;
						}

						let { varDefs, argsStr, } = renderArgsFromFieldMeta(
							meta,
							namePrefix,
							nonPrefixedTypes,
							`${ctxLabel}.${meta.alias || meta.field}`
						);
						mergeDefs(varDefs,`${ctxLabel}.${meta.field}.args`);

						let { varDefs: dirVarDefs, directivesStr, } = renderDirectivesFromFieldMeta(
							meta,
							namePrefix,
							nonPrefixedTypes,
							`${ctxLabel}.${meta.alias || meta.field}`
						);
						mergeDefs(dirVarDefs,`${ctxLabel}.${meta.field}.directives`);

						let aliasStr = meta.alias ? `${meta.alias}: ` : "";

						parts.push(
							`${aliasStr}${meta.field}${argsStr}${directivesStr}${
								subSel != null ? ` { ${render(subSel,`${ctxLabel}.${meta.field}`)} }` : ""
							}`
						);
					}

					return parts.join(" ");
				}

				throw new Error("Invalid selectionSet");
			}

			throw new Error("Invalid selectionSet");
		}
	}
}


// *****************************
// module-level pure helpers
// *****************************

function isGQLName(str) {
	return /^[_A-Za-z][_0-9A-Za-z]*$/.test(str);
}

function isChunkObject(v) {
	return !!(v && typeof v == "object" && !Array.isArray(v));
}

function mergeChunks(parts,label = "chunk") {
	var out = Object.create(null);

	for (let part of parts) {
		if (part == null) continue;
		// accept plain chunk objects, OR functions (e.g. directive tokens
		// whose enumerable own properties — like .directives — contribute).
		if (!isChunkObject(part) && typeof part != "function") {
			throw new Error(`Invalid ${label} (expected non-array object chunk)`);
		}
		Object.assign(out,part);
	}

	return out;
}

function parseTaggedName(strings,values,{ allowInterpolation, allowTrailingColon, } = {}) {
	if (!Array.isArray(strings) || !("raw" in strings)) {
		throw new TypeError("Must be used as a template tag");
	}

	var maxInterp = (allowInterpolation ? 1 : 0);
	if (values.length > maxInterp) {
		throw new Error("Too many interpolations");
	}

	if (values.length == 1) {
		if (strings.length != 2 || strings[1].trim() !== "") {
			throw new Error("Interpolation must come after the name");
		}
	}
	else if (strings.length != 1) {
		throw new Error("Invalid template");
	}

	var name = strings[0].trim();

	if (allowTrailingColon) {
		name = name.replace(/\s*:\s*$/,"").trim();
	}

	if (!isGQLName(name)) {
		throw new Error(`Invalid GraphQL name: ${name}`);
	}

	var extra = null;
	if (values.length == 1) {
		extra = values[0];

		if (typeof extra == "function") {
			return { name, extra, };
		}

		if (!(extra && typeof extra == "object")) {
			throw new Error("Interpolation must be an object or array of chunks");
		}

		if (Array.isArray(extra)) {
			extra = mergeChunks(extra,"$f interpolation chunk");
		}
	}

	return { name, extra, };
}

function mergeObjLiteralStrings(a,b) {
	a = a.trim();
	b = b.trim();

	if (!(a[0] == "{" && a[a.length - 1] == "}" && b[0] == "{" && b[b.length - 1] == "}")) {
		throw new Error("Expected object literal strings for merge");
	}

	let ai = a.slice(1,-1).trim();
	let bi = b.slice(1,-1).trim();

	if (!ai) return b;
	if (!bi) return a;

	return `{${ai},${bi}}`;
}

function addVarDefs(newDefs,sourceLabel,allVarDefs) {
	if (!newDefs) return;
	for (let [ varName, type, ] of Object.entries(newDefs)) {
		if (varName in allVarDefs) {
			if (allVarDefs[varName] != type) {
				throw new Error(
					`Conflicting type definitions for "${varName}" between ${sourceLabel} and previous varDefs: ${type} vs ${allVarDefs[varName]}`
				);
			}
		}
		else {
			allVarDefs[varName] = type;
		}
	}
}

function addActionArg(argName,argStr,sourceLabel,actionArgsMap) {
	if (!argStr) return;
	if (!(
		typeof argName == "string" &&
		argName != ""
	)) {
		throw new Error("Invalid arg name");
	}
	if (!(
		typeof argStr == "string" &&
		argStr != ""
	)) {
		throw new Error("Invalid arg string");
	}

	if (argName in actionArgsMap) {
		throw new Error(
			`Duplicate "${argName}" arg between ${sourceLabel} and previous args: ${argStr} vs ${actionArgsMap[argName]}`
		);
	}

	actionArgsMap[argName] = argStr;
}

function isVarMappingLeaf(spec) {
	return (
		spec != null &&
		typeof spec == "object" &&
		!Array.isArray(spec) &&
		Object.keys(spec).length == 1 &&
		typeof Object.values(spec)[0] == "string"
	);
}

function normalizeType(type,namePrefix,nonPrefixedTypes) {
	// unwrap self-rendering tokens via the render protocol
	if (type && typeof type.render == "function") {
		type = type.render({ namePrefix, nonPrefixedTypes, });
	}

	if (!(
		typeof type == "string" &&
		type != ""
	)) {
		throw new Error("Invalid GraphQL var type");
	}

	var leading = "";
	var trailing = "";
	while (type && type[0] == "[") {
		leading += "[";
		type = type.slice(1);
	}
	while (type && (type.endsWith("!") || type.endsWith("]"))) {
		trailing = type[type.length - 1] + trailing;
		type = type.slice(0,type.length - 1);
	}

	if (!nonPrefixedTypes.includes(type)) {
		if (!type.startsWith(namePrefix)) {
			type = `${namePrefix}${type}`;
		}
	}

	return `${leading}${type}${trailing}`;
}

function renderLitValue(v,renderCtx) {
	if (v && typeof v.render == "function") {
		return v.render(renderCtx);
	}

	if (v === null) return "null";
	if (v === true) return "true";
	if (v === false) return "false";

	if (typeof v == "number") {
		if (!Number.isFinite(v)) throw new Error("Invalid number literal in litArgs");
		return String(v);
	}

	if (typeof v == "string") {
		return JSON.stringify(v);
	}

	if (Array.isArray(v)) {
		return `[${v.map(item => renderLitValue(item,renderCtx)).join(",")}]`;
	}

	if (v && typeof v == "object") {
		let parts = (
			Object.entries(v)
				.filter(([ , vv, ]) => vv !== undefined)
				.map(([ k, vv, ]) => `${k}:${renderLitValue(vv,renderCtx)}`)
		);
		return `{${parts.join(",")}}`;
	}

	throw new Error("Unsupported literal in litArgs");
}

function selectionSet(...items) {
	if (items.length == 1 && items[0] == null) {
		return { selectionSet: null, };
	}
	return { selectionSet: items, };
}

function root(field,alias) {
	var r = { field, };
	if (alias !== undefined) r.alias = alias;
	var chunk = { root: r, };

	// non-enumerable fluent .directives(..) — doesn't leak into mergeChunks
	Object.defineProperty(chunk,"directives",{
		enumerable: false,
		configurable: false,
		writable: false,
		value: function attachDirectives(...dirs) {
			validateDirectiveTokens(dirs,"root().directives(..)");
			return {
				root: Object.assign(Object.create(null),r,{ directives: dirs.slice(), }),
			};
		},
	});

	return chunk;
}

function varArgs(...chunks) {
	return { varArgs: mergeChunks(chunks,"varArgs(..) part"), };
}

function litArgs(...chunks) {
	return { litArgs: mergeChunks(chunks,"litArgs(..) part"), };
}

function varDefs(...chunks) {
	return { varDefs: mergeChunks(chunks,"varDefs(..) part"), };
}

function operationName(name) {
	return { operationName: name, };
}

function directives(...dirs) {
	validateDirectiveTokens(dirs,"directives(..)");
	return { directives: dirs.slice(), };
}

function validateDirectiveTokens(dirs,label) {
	// duck-type: must be a function with a render method and a directives
	// getter that returns a single-element array containing itself.
	for (let d of dirs) {
		if (!(
			typeof d == "function" &&
			typeof d.render == "function" &&
			Array.isArray(d.directives) &&
			d.directives.length == 1 &&
			d.directives[0] === d
		)) {
			throw new Error(`${label} only accepts $d directive tokens`);
		}
	}
}
