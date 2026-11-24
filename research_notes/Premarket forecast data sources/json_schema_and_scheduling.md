# JSON Schema design and enforcement for the daily ForecastRecord, and running it reliably so the report exists by 4:30am ET

Research date: 2026-11-24. I checked package versions against the npm registry (`npm view`) and PyPI's JSON API on that date. I checked the repo's hard-coded holiday list by running pandas_market_calendars 5.6.1 in a scratch virtualenv; no repository files were changed. Repo paths below are relative to `/home/user/pre-market-session-forecast-report-generator`.

The "repo context" findings describe the code as it was when this research started. While I was working, someone else added `schemas/forecast-record.schema.json` (2020-12, `$id` `https://meridian-quant.local/schemas/forecast-record/1.1.0/...`), `server/forecastValidation.ts` (Ajv2020 + ajv-formats, `PROB_TOLERANCE = 0.0005`), a validation call in `saveForecast()`, `npm test` / `validate:forecasts` CI steps, and `chronos_service/requirements-dev.txt` with `jsonschema[format-nongpl]`. As a result, the claims that there is "no schema/validation in CI" and that "saveForecast does not validate" are out of date. The `readForecasts()` behaviour of silently returning `[]` on a parse error was still present at last check.

Versions in use on 2026-11-24:

| Package | Latest | Published | Note |
|---|---|---|---|
| ajv | 8.20.0 | 2026-04-24 | [npm](https://www.npmjs.com/package/ajv) |
| ajv-formats | 3.0.1 | 2024-03-30 | [npm](https://www.npmjs.com/package/ajv-formats) |
| ajv-cli | 5.0.0 | 2023-04-28 | Stale. Prefer the JS API for standalone builds. [npm](https://www.npmjs.com/package/ajv-cli) |
| zod | 4.6.7 | 2026-10-12 | [npm](https://www.npmjs.com/package/zod) |
| typebox (1.x) | 1.4.7 | 2026-11-12 | `@sinclair/typebox` 0.34.52 is the 0.x LTS line. [npm](https://www.npmjs.com/package/typebox) |
| ts-json-schema-generator | 2.10.0 | 2026-11-20 | Depends on `typescript ">=5.9 <7"`. [npm](https://www.npmjs.com/package/ts-json-schema-generator) |
| typescript-json-schema | 0.68.0 | 2026-07-14 | [npm](https://www.npmjs.com/package/typescript-json-schema) |
| json-schema-to-typescript | 16.0.0 | 2026-08-28 | [npm](https://www.npmjs.com/package/json-schema-to-typescript) |
| typescript | 7.0.2 | 2026-07-08 | The repo uses `^7.0.2`. [npm](https://www.npmjs.com/package/typescript) |
| fast-check | 4.11.0 | 2026-11-21 | [npm](https://www.npmjs.com/package/fast-check) |
| jsonschema (Python) | 4.26.0 | 2026-01-07 | Python >= 3.10. [PyPI](https://pypi.org/project/jsonschema/) |
| pydantic | 2.14.4 | 2026-11-19 | [PyPI](https://pypi.org/project/pydantic/) |
| fastjsonschema | 2.22.3 | 2026-11-01 | [PyPI](https://pypi.org/project/fastjsonschema/) |
| datamodel-code-generator | 0.101.0 | 2026-11-24 | Python >= 3.11. [PyPI](https://pypi.org/project/datamodel-code-generator/) |
| hypothesis | 6.170.17 | 2026-11-20 | Python >= 3.11. [PyPI](https://pypi.org/project/hypothesis/) |
| hypothesis-jsonschema | 0.23.2 | 2026-10-27 | Python >= 3.11. [PyPI](https://pypi.org/project/hypothesis-jsonschema/) |
| check-jsonschema | 0.39.0 | 2026-10-26 | Python >= 3.11. [PyPI](https://pypi.org/project/check-jsonschema/) |
| pandas_market_calendars | 5.6.1 | 2026-11-14 | Python >= 3.10. [PyPI](https://pypi.org/project/pandas-market-calendars/) |
| exchange_calendars | 4.13.3 | 2026-11-14 | Python >= 3.10, < 4. [PyPI](https://pypi.org/project/exchange-calendars/) |

## (A1) Which JSON Schema draft and which validators: Ajv, python-jsonschema, Pydantic v2, fastjsonschema; strict mode, formats, build-time compilation

### Takeaway
Declare JSON Schema 2020-12. It is still the current published version, Pydantic v2 emits it natively, and both Ajv (`Ajv2020`) and python-jsonschema (`Draft202012Validator`) support it fully. Write the schema in a "portable subset" of keywords that mean the same thing in draft-07, so draft-04/06/07-only tools (fastjsonschema, hypothesis-jsonschema, json-schema-to-typescript's draft-4 model) still work. In Node, run Ajv with `strict: true`, `allErrors: true` and ajv-formats in full mode. In Python, run python-jsonschema with an explicit `FORMAT_CHECKER` and the `jsonschema[format-nongpl]` extra; without that extra, `date-time` checks pass silently.

### Cited Findings
- JSON Schema's site says "The current version is 2020-12! The previous version was 2019-09." It lists no newer release, only "the latest unreleased version". — [json-schema.org/specification](https://json-schema.org/specification)
- Ajv's default export is draft-07. Draft 2019-09 and 2020-12 each need a different Ajv class. "draft-2020-12 is not backwards compatible", so it cannot be mixed with earlier drafts in one Ajv instance. In 2020-12, `prefixItems` replaces array-form `items` and `additionalItems` is not supported. `$dynamicAnchor`/`$dynamicRef` are supported. `discriminator` is an OpenAPI keyword that needs `discriminator: true`. — [Ajv: JSON Schema](https://ajv.js.org/json-schema.html)
- The 2020-12 class is imported from `ajv/dist/2020` (e.g. `import Ajv2020 from "ajv/dist/2020"`). This comes from a third-party summary; the official code block did not render in my fetch. — [tessl Ajv schema-2020 summary](https://tessl.io/registry/tessl/npm-ajv/files/docs/schema-2020.md)
- Ajv strict mode:
  - "By default Ajv fails schema compilation when unknown keywords are used." Allowed extras must be registered with `ajv.addKeyword(...)` or `ajv.addVocabulary([...])`, which matters for annotation keywords like `x-unit`.
  - `strictTypes` defaults to `"log"`. Type unions *with null*, such as `type: ["object","null"]`, are allowed. Other unions need `allowUnionTypes: true`.
  - `strictRequired` is off by default.
  - By default `{"type":"number"}` fails for `Infinity` and `NaN` (`strictNumbers`).
  - `strict: true|false|"log"` sets all of these at once.
  - Source: [Ajv strict mode](https://ajv.js.org/strict-mode.html)
- ajv-formats:
  - `date-time` means "date-time (time-zone is mandatory)". `iso-date-time` allows an optional time zone.
  - Full mode is the default. In "fast" mode, `date`, `time` and `date-time` "do not validate ranges ... only string structure".
  - It adds `formatMinimum`/`formatMaximum` (and exclusive variants) for ordered formats.
  - Source: [ajv-formats README](https://github.com/ajv-validator/ajv-formats)
- Ajv standalone code:
  - Enable it with `code: {source: true}` and pass the instance to `standaloneCode` from `ajv/dist/standalone`. `code.esm` emits ESM.
  - Formats need `code.formats`, which ajv-formats sets automatically.
  - "Only `code` and `macro` user-defined keywords are supported."
  - Generated code still depends on Ajv's runtime folder unless bundled.
  - Benefits: compilation "will happen during build time", and no `Function` constructor is used (good under a CSP).
  - The CLI form needs ajv-cli >= 4.
  - Source: [Ajv standalone](https://ajv.js.org/standalone.html)
- ajv-cli was last published 2023-04-28 (v5.0.0); ajv itself is at 8.20.0 (2026-04-24). — [npm ajv-cli](https://www.npmjs.com/package/ajv-cli); [npm ajv](https://www.npmjs.com/package/ajv)
- python-jsonschema (docs for 4.26.0):
  - Offers `Draft202012Validator`, `Draft201909Validator`, `Draft7Validator`, `Draft6Validator`, `Draft4Validator` and `Draft3Validator`.
  - Format validation is off by default ("no validation is enforced"). Enable it with `format_checker=Draft202012Validator.FORMAT_CHECKER`.
  - `date-time` needs `rfc3339-validator`. The docs recommend `pip install jsonschema[format]` or `jsonschema[format-nongpl]`.
  - If a format dependency is missing, validation passes silently.
  - Source: [python-jsonschema: Schema Validation](https://python-jsonschema.readthedocs.io/en/stable/validate/)
- Pydantic v2:
  - Generated schemas "comply with JSON Schema Draft 2020-12 and OpenAPI Specification v3.1.0".
  - `Optional` fields become `anyOf` with `{"type":"null"}`.
  - `model_json_schema(mode='validation'|'serialization')` differs for some types; e.g. `Decimal` is number-or-string in validation mode and string in serialization mode.
  - Customisation works through a `GenerateJsonSchema` subclass and `json_schema_extra`.
  - Default output does not include `$schema`; the docs' custom-generator example adds `self.schema_dialect`.
  - Source: [Pydantic: JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/json_schema/)
- fastjsonschema "implements JSON schema drafts 04, 06, and 07" and does not support 2019-09/2020-12. It defaults to draft-07 when `$schema` is absent. Formats are asserted by default (`use_formats=False` turns them off). `compile_to_code` emits a module. Its own benchmark is far faster than `jsonschema` (about 0.099 s vs 5.22 s for the valid-input case). — [fastjsonschema docs](https://horejsek.github.io/python-fastjsonschema/)
- hypothesis-jsonschema: "JSONSchema drafts 04, 05, and 07 are fully tested and working"; 2019-09/2020-12 are not mentioned. — [hypothesis-jsonschema README](https://github.com/python-jsonschema/hypothesis-jsonschema)
- Repo context:
  - `payload.as_of` comes from Python `datetime.now().astimezone().isoformat()` (offset included). [chronos_service/app.py](../../chronos_service/app.py)
  - The stored record has `as_of`/`created_at` like `2026-11-24T02:50:08.766Z`. Both satisfy ajv-formats' `date-time`, which requires a zone. [data/forecasts.json](../../data/forecasts.json)

### Inferences
- **Dialect:** put `"$schema": "https://json-schema.org/draft/2020-12/schema"` in every schema file. In Node use `Ajv2020`; in Python use `Draft202012Validator`. Pydantic and FastAPI's OpenAPI 3.1 output already speak 2020-12, so there is no reason to pick draft-07 as the declared dialect.
- **Portable subset:** keep to keywords that behave the same in draft-07: `type` (including `["number","null"]`), `properties`, `required`, `additionalProperties`, `enum`, `const`, `minimum`/`maximum`, `exclusiveMinimum`, `minItems`/`maxItems`, single-schema `items`, `pattern`, `format`, and `$ref` to `#/$defs/...` (a plain JSON-pointer fragment). Avoid `prefixItems`, `unevaluatedProperties`, `dependentSchemas` and `$dynamicRef` unless a real need appears. fastjsonschema, hypothesis-jsonschema and json-schema-to-typescript then still give correct results. Confirm that `$defs` resolves under the draft-07 tools with a fixture test; I did not test it.
- **Node runtime settings:**
  - `new Ajv2020({ strict: true, allErrors: true })`, then `addFormats(ajv)` in full mode.
  - `ajv.addVocabulary(["x-unit","x-tolerance","x-provenance"])` if annotation keywords are used.
  - `allowUnionTypes` is not needed, because only `T | null` unions are used.
  - The Express server is long-lived, so compiling once at startup is enough. Standalone build-time code is optional and helps mainly with cold starts or browser use. If used, generate it with the JS API (`standaloneCode`) in an npm script, not the stale ajv-cli.
- **Python settings:** `Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)` plus `jsonschema[format-nongpl]` in requirements. Add a unit test that asserts a malformed `date-time` is rejected, so a missing `rfc3339-validator` cannot silently disable the check. Use fastjsonschema only if validation speed ever matters, and only on the portable subset; it is not needed for one record a day.
- **Pydantic is a parallel check, not a replacement:** `model_validate` at the FastAPI boundary is good, but it is a second validator. The JSON Schema file stays the cross-language contract. Pydantic writes nullable as `anyOf` while a hand-written schema uses type arrays. They mean the same thing, so check drift by validating fixtures, not by diffing schema text.

### Gaps
- I could not confirm from the fetched Pydantic docs that `ConfigDict(extra='forbid')` produces `"additionalProperties": false`. It is widely relied on, but a test should check it.
- I did not find whether an Ajv v9 is planned; 8.20.0 is the latest on npm.

## (A2) Single source of truth: keeping Python and TypeScript in sync, and catching drift in CI

### Takeaway
The repo is on TypeScript 7, which ships no compiler API, so TS-types-to-schema generators (ts-json-schema-generator, typescript-json-schema) are a poor fit now. The most robust option is **schema-first**: hand-written JSON Schema 2020-12 files are the contract. TS types come from json-schema-to-typescript and Pydantic v2 models from datamodel-code-generator, with a CI step that regenerates and fails on any diff. TypeBox 1.x (built for TS 7, native 2020-12) is the best "author in TypeScript" alternative. Zod 4 is viable but its refinements are not documented as exportable, and Python would still consume an exported file.

### Cited Findings
- TypeScript 7.0 (announced 2026-07-08): "While TypeScript 7.0 is here, it does not ship with an API." "We expect TypeScript 7.1 to ship with a new (and different) API." Microsoft ships `@typescript/typescript6` (a `tsc6` binary that re-exports the 6.0 API) for tools that need the old API. — [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- The repo's `devDependencies` include `"typescript": "^7.0.2"`, and `npm run lint` runs `tsc --noEmit`. — [package.json](../../package.json)
- ts-json-schema-generator 2.10.0 (2026-11-20) has a direct dependency `"typescript": ">=5.9 <7"`, so it brings its own TS 5.9/6.x compiler and does not use the project's TS 7 (from `npm view ts-json-schema-generator dependencies`). — [npm ts-json-schema-generator](https://www.npmjs.com/package/ts-json-schema-generator)
- ts-json-schema-generator options include `--type`, `--additional-properties` ("default: false"), `--strict-tuples`, `--no-type-check` and `--jsDoc none|basic|extended` (default extended). Overrides like `@format` are supported. The README does not say which draft it outputs or anything about TS 7. — [ts-json-schema-generator README](https://github.com/vega/ts-json-schema-generator)
- A secondary write-up lists ts-json-schema-generator and similar schema/DTO emitters among tools that depend on the Compiler API under TS 7. — [DEV: TypeScript 7.0 shipped](https://dev.to/fernforge/typescript-70-shipped-a-green-tsc-is-not-a-green-migration-4hil)
- json-schema-to-typescript (16.0.0, 2026-08-28) — [README](https://github.com/bcherny/json-schema-to-typescript):
  - It models schemas as draft 4 and handles later keywords one by one. `$defs` is supported, `unevaluatedProperties` is partial, 2020-12 `prefixItems` is ignored (emits `unknown[]`), and `$dynamicRef`/`$dynamicAnchor` are ignored.
  - `additionalProperties` defaults to `true` when the schema does not set it.
  - `tsType` overrides a generated type.
  - `minimum`, `maximum`, `pattern`, `multipleOf`, `uniqueItems` and `format` are "Not expressible in TypeScript".
- datamodel-code-generator generates Pydantic v2 models from JSON Schema (`--input-file-type jsonschema --output-model-type pydantic_v2.BaseModel`). "datamodel-codegen --check exits with 1 when the files on disk differ from what the schema generates, so CI catches drift." Version 0.101.0 needs Python >= 3.11. — [datamodel-code-generator README](https://github.com/koxudaxi/datamodel-code-generator); [PyPI](https://pypi.org/project/datamodel-code-generator/)
- Zod 4 `z.toJSONSchema()` — [Zod: JSON Schema](https://zod.dev/json-schema):
  - The default target is draft-2020-12; `draft-07`, `draft-04` and `openapi-3.0` are also available.
  - `z.nullable()` produces `type: [T, "null"]`.
  - `io: "input"|"output"` chooses which side's type is exported.
  - Unrepresentable types (transform, date, bigint, custom...) throw by default, or become `{}` with `unrepresentable: "any"`.
  - `z.fromJSONSchema()` "is experimental".
  - The page does not say how `.refine`/`.superRefine` are exported.
- TypeBox 1.x (`npm install typebox`, 1.4.7 on 2026-11-12) — [TypeBox README](https://github.com/sinclairzx81/typebox):
  - It is "Developed against the TypeScript 7 native compiler", ESM-only, and supports TS 6.0–7.0+.
  - It has "native JSON Schema 2020-12 support".
  - An optional JIT compiler (`typebox/schema`, `Schema.Compile(...).Check()/Parse()`) is included, and `Type.Static<typeof T>` infers TS types.
  - 0.x (`@sinclair/typebox`) is the LTS line for TS 5.0–6.0.
  - Benchmarks against Ajv are self-reported.
- Pydantic emits 2020-12 schemas, including `mode='serialization'` output. — [Pydantic: JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/json_schema/)
- Repo context:
  - `ForecastRecord` is assembled in TypeScript: `payload`/`snapshot` come from the Python service or the TS adapter, and `audit` from `server/mathAudit.ts`. The TS interfaces in `src/types/forecast.ts` are the only definition today.
  - Python builds `raw_payload` as untyped dicts; Pydantic models exist only for requests (`ForecastRequest`, `VerifyRequest`, `HorizonSpec`, `HorizonBin`).
  - Sources: [src/types/forecast.ts](../../src/types/forecast.ts); [chronos_service/app.py](../../chronos_service/app.py)

### Inferences
- **Option 1, schema-first (recommended).**
  - Layout: `schemas/forecast-record/1.1.0.schema.json` plus `$defs` for `HorizonForecast`, `BinItem`, `MarketSnapshot`, `InputObservation`, etc.
  - Generate `src/types/forecast.generated.ts` with json-schema-to-typescript (set `additionalProperties: false` explicitly in the schema, because the tool's default is `true`).
  - Generate `chronos_service/forecast_models.py` with `datamodel-codegen --output-model-type pydantic_v2.BaseModel --target-python-version 3.11`.
  - Have `src/types/forecast.ts` re-export the generated types, so existing imports keep working.
  - CI: `npm run gen:types && git diff --exit-code` and `datamodel-codegen ... --check`.
  - Pros: neutral to both languages, which is exactly what was asked. It does not depend on the TS compiler API (safe on TS 7) and treats Python and TS equally.
  - Cons: JSON is verbose to write, and generated Pydantic models need hand-written subclasses or wrappers for the semantic checks.
- **Option 2, TypeBox-first in TS.** Define schemas with `Type.Object(...)`, export `Type.Static` types, and write the schema objects to `schemas/*.json` in a build step. Python validates against the exported file and can optionally run datamodel-codegen on it. This fits if TS stays the owner of the record. TypeBox's compiler or Ajv can validate at runtime.
- **Option 3, Zod 4.** Also works if the TS team prefers Zod (`z.toJSONSchema(..., {target: "draft-2020-12", io: "output"})`). The semantic sum-to-1 rules would live in `.superRefine`, which (apparently) does not export, so Python would need its own copy. That is the same as every other option, just without the benefit of a neutral contract file.
- **Option 4, TS interfaces to schema (ts-json-schema-generator / typescript-json-schema).** Avoid while the project is on TS 7. The tool would quietly use its own TS 6 compiler; that probably works for plain interfaces but is a long-term maintenance risk until TS 7.1's API lands. Constraints would sit in JSDoc tags.
- **Option 5, Pydantic-first.** Reasonable because Python produces most of the payload. However, `audit`, `verification` and the record envelope are built in TS, so Pydantic would have to model parts it never produces. Use this only if the TS math audit moves into Python.
- **Drift detection regardless of option:**
  1. Codegen-diff checks in CI.
  2. A shared fixture corpus (`schemas/fixtures/valid/*.json`, `schemas/fixtures/invalid/*.json`, each invalid file paired with the expected failing keyword or path). Ajv and python-jsonschema both run it and must give the same verdict on every file.
  3. A Python test that validates real `_generate_forecast()` output, from mocked market data, against the schema file.
  4. The existing `tsc --noEmit` catches TS code that no longer matches the generated types.

### Gaps
- No official statement found on ts-json-schema-generator's or typescript-json-schema's support plans for TS 7 or 7.1. I did not check typescript-json-schema's TS dependency range.
- Zod 4 docs do not say whether `.refine`/`.superRefine` appear in `toJSONSchema` output (most likely omitted).

## (A3) What JSON Schema can and cannot express for ForecastRecord; handling cross-field rules and floating-point tolerance

### Takeaway
Standard JSON Schema can enforce structure: enums, required keys, closed objects, nullable numbers, ranges, exactly 10 bins and exactly 5 named horizons, patterns, and RFC 3339 timestamps. It cannot enforce arithmetic across fields: probabilities summing to 1, a monotone CDF, quantile ordering, or strategy weights summing to 1. Put those rules in a separate, versioned semantic validation layer with explicit tolerances, run in both TS and Python against shared fixtures. Ajv's non-standard `$data` and custom keywords can cover some of them, but only on the Ajv side.

### Cited Findings
- Ajv `$data` (enabled with `new Ajv({$data: true})`) — [Ajv: combining schemas / $data](https://ajv.js.org/guide/combining-schemas.html):
  - It lets keywords like `minimum`, `maximum`, `exclusiveMinimum`, `const`, `enum`, `minItems` and `formatMinimum` read values from the data being validated, via absolute or relative JSON pointers. Example: `smaller: {type:"number", maximum: {$data:"1/larger"}}`.
  - It is presented as an Ajv option, not as standard JSON Schema.
  - If the reference resolves to `undefined`, validation succeeds (except for `const`).
- Ajv user-defined keywords come in four kinds: `code` ("the best approach"), `validate` (a runtime function returning a boolean, which can attach `.errors`), `compile`, and `macro` (expands to schema). Each error needs `keyword`, `message` and `params`. — [Ajv: user-defined keywords](https://ajv.js.org/keywords.html)
- Standalone compiled code supports "Only `code` and `macro` user-defined keywords". — [Ajv standalone](https://ajv.js.org/standalone.html)
- Ajv's default `strictNumbers` rejects `NaN`/`Infinity` for `type: number`. — [Ajv strict mode](https://ajv.js.org/strict-mode.html)
- `JSON.stringify` turns `NaN` and `Infinity` into `null` (`JSON.stringify([NaN, null, Infinity]) // '[null,null,null]'`) and drops object properties whose value is `undefined`. — [MDN JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- Python's `json` module emits `NaN`/`Infinity` by default (`allow_nan=True`), which "is not JSON specification compliant". `allow_nan=False` raises `ValueError` instead. — [Python 3.11 json docs](https://docs.python.org/3.11/library/json.html)
- Repo context:
  - The math audit already applies tolerances: `Math.abs(h.reconciled_prob_sum - 1) < 0.0002`, `Math.abs(weightResult.reconciledSum - 1) < 0.001`, and a terminal-CDF check `> 0.0002`. [server/mathAudit.ts](../../server/mathAudit.ts)
  - The audit stores booleans `cdf_monotonic` and `quantiles_coherent`. [src/types/forecast.ts](../../src/types/forecast.ts)
  - Python's `_safe_last` turns non-finite values into `None`. [chronos_service/app.py](../../chronos_service/app.py)
  - The stored record has 10 bins per horizon and quantile keys p01/p05/p25/p75/p95/p99; there is no p50 key, and the median is a separate `median_pct`. [data/forecasts.json](../../data/forecasts.json)

### Inferences
- **Structural rules for the schema:**
  - **Enums:** `regime`, `volatility_state`, `skew_bias`, `overnight_gap_risk`, `source_coverage`, `impact`, `trigger`, `calibration_mode`, `run_window` and `target_horizon` each get `enum: [...]`. `return_type` gets `const: "simple_pct"`.
  - **Closed objects:** `additionalProperties: false` on every object, plus a full `required` list. Optional TS fields (`base_session_date?`, `futures_daily_change_pct?`, `verification?`) stay out of `required`.
  - **Nullable numbers:** every `number | null` snapshot field becomes `{"type": ["number","null"]}`, which Ajv strict mode allows.
  - **Probabilities:** `prob`, `cdf`, `underflow_prob`, `overflow_prob`, `prob_positive`, `confidence_score`, `kelly_fraction_cap` and each strategy weight get `minimum: 0, maximum: 1`.
  - **Bins:** `bins` gets `type: array, items: {$ref: "#/$defs/BinItem"}, minItems: 10, maxItems: 10`.
  - **Horizons:** model them as an object, not an array: `required: ["tomorrow","next_week","next_month","next_quarter","next_year"]` and `additionalProperties: false`, which means exactly five.
  - **Other ranges and patterns:** `trading_days` gets `type: integer, minimum: 1`. `bin_width_pct` gets `exclusiveMinimum: 0`. `base_price` gets `exclusiveMinimum: 0`. Symbol gets a `pattern` such as `^[A-Z][A-Z0-9.^=-]{0,14}$`; it must admit tickers like `^VIX` or `NQ=F` if those land in `underlying_symbol`/`overnight_futures_symbol`. `base_session_date` gets `format: "date"`. All `*_at`/`as_of*`/`time_utc` fields get `format: "date-time"`. `time_et` gets `pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"`.
  - **Version:** `schema_version` gets `const: "1.1.0"` inside the 1.1.0 schema file.
- **Composition pitfall:** `additionalProperties: false` only sees `properties` in the same schema object, so it rejects fields brought in through `allOf`/`$ref`. Either keep each object self-contained or use `unevaluatedProperties: false`. The latter is 2020-12/2019-09 only and only partly supported by json-schema-to-typescript. This is standard JSON Schema behaviour; I did not fetch a dedicated page for it.
- **Semantic layer:** a pure `validateForecastSemantics(record, tolerances) -> Issue[]`, with each `Issue = {path, rule, observed, expected, tolerance, severity}`, implemented in TS next to `mathAudit.ts` and mirrored in Python. It should recompute from the data and not trust the stored audit booleans. Rules per horizon:
  1. `|Σ bins.prob + underflow_prob + overflow_prob − 1| ≤ ε_sum`.
  2. `cdf[i] ≈ underflow_prob + Σ_{j≤i} prob[j]` within ε, and `cdf` is non-decreasing.
  3. Bins are contiguous and ascending: `max_pct[i] == min_pct[i+1]`, `min_pct < max_pct`, and the width matches `bin_width_pct` within ε.
  4. Quantiles: `p01 ≤ p05 ≤ p25 ≤ median_pct ≤ p75 ≤ p95 ≤ p99`.
  5. `std_pct ≥ 0`, `expected_shortfall_5pct ≤ p05`; check the latter's sign convention against the code.
  6. `trading_days` strictly increases across horizons in key order.
- **Record-level semantic rules:** strategy weights sum to 1 ± ε_w; `payload.symbol == snapshot.symbol`; `as_of ≤ created_at`; `audit.all_passed` agrees with the recomputed result; `snapshot.missing_inputs ⊆` known input IDs.
- **Tolerances:** derive ε from rounding precision rather than guessing. If n values are each rounded to d decimals, the worst-case sum error is n·0.5·10^-d; for 12 terms at 4 dp that is 0.0006. That is larger than the current 0.0002, so either round after reconciling or set ε deliberately. Keep the tolerances in one shared JSON constants file (e.g. `schemas/tolerances.json`, or `x-tolerance` annotations in the schema) read by both languages, and record which tolerance set was applied in the record's validation block.
- **Ajv-only shortcut:** quantile ordering could be written with `$data`, e.g. `p05: {type:"number", minimum: {$data: "1/p01"}}`. python-jsonschema would not understand it, so the contract would no longer be portable. Prefer the semantic layer. Use Ajv `code` keywords only if one compiled validator is wanted on the Node side; standalone mode cannot use `validate`-type keywords.
- **NaN/Infinity:** JSON cannot carry them. Python should dump with `allow_nan=False`, so a bug fails loudly. In TS, run Ajv on the in-memory object before `JSON.stringify` (strictNumbers rejects NaN), or check finiteness in the semantic layer. Otherwise a NaN in a nullable snapshot field silently becomes a valid `null`.

### Gaps
- I found no authoritative source recommending a specific floating-point tolerance for probability vectors in data contracts. The n·0.5·10^-d bound is my own derivation.

## (A4) Schema versioning, evolution, `$id`/`$schema`, and validating historical `data/forecasts.json`

### Takeaway
Give every schema version an immutable, versioned `$id`, keep every old version in the repo, and pick the validator for each record by the version stamped in it. Use SchemaVer semantics (MODEL = breaks all history, REVISION = may break some, ADDITION = compatible with all history) to decide how to bump, even if the string keeps SemVer dots. Add an envelope-level version, because today only `payload.schema_version` exists, while `snapshot`, `audit` and `verification` will also change.

### Cited Findings
- SchemaVer is `MODEL-REVISION-ADDITION` — [Snowplow: Introducing SchemaVer](https://snowplow.io/blog/introducing-schemaver-for-semantic-versioning-of-schemas):
  - MODEL: "a breaking schema change which will prevent interaction with any historical data".
  - REVISION: "may prevent interaction with some historical data".
  - ADDITION: "compatible with all historical data".
  - "Versioning starts from 1, not 0 as in SemVer"; hyphens are used to tell it apart from SemVer.
- Snowplow's current docs say "All previous versions of a schema remain available" and "Aim to treat each schema version as immutable". Changing a schema without a version bump can invalidate earlier events and break consumers; patching is only for versions "that aren't in production yet". — [Snowplow docs: schema versioning](https://docs.snowplow.io/docs/api-reference/iglu/common-architecture/schemaver/)
- OpenLineage requires each facet's `_schemaURL` to be immutable (e.g. contain a git SHA rather than a branch name), with one canonical URL per schema version. — [OpenLineage: facets](https://openlineage.io/docs/spec/facets/)
- 2020-12 cannot be mixed with earlier drafts in one Ajv instance. — [Ajv: JSON Schema](https://ajv.js.org/json-schema.html)
- Repo context:
  - `"schema_version": "1.1.0"` is hard-coded in the Python payload. [chronos_service/app.py](../../chronos_service/app.py)
  - `data/forecasts.json` currently holds one record, at schema 1.1.0. [data/forecasts.json](../../data/forecasts.json)
  - Storage keeps the newest 120 records (`.slice(0, 120)`). `readForecasts()` returns `[]` on any parse error, and `verification` is added to existing records later. [server/storage.ts](../../server/storage.ts); [src/types/forecast.ts](../../src/types/forecast.ts)

### Inferences
- **Identifiers:**
  - `$id`: `https://<your-domain-or-repo>/schemas/forecast-record/1.1.0.schema.json`, or a raw GitHub URL pinned to a tag or SHA. It must never be reused for different content.
  - `$schema`: the 2020-12 meta-schema.
  - Optionally add `"schema_id": "<$id>"` to each record so a record names exactly what it claims to follow.
- **Two version fields:** keep `payload.schema_version` and add `record_schema_version` (or `schema_id`) on the `ForecastRecord` envelope. The snapshot and provenance changes planned for new data inputs are envelope changes.
- **Bump rules (SchemaVer):**
  - ADDITION: adding an optional field, or loosening an enum by adding a value. Every old record stays valid.
  - REVISION: making an optional field required, tightening a range, or renaming an enum value.
  - MODEL: restructuring horizons or bins.
  - If the SemVer-looking string stays, write the mapping down: MAJOR = MODEL, MINOR = REVISION, PATCH = ADDITION. The current "1.1.0" then becomes the baseline.
- **Closed vs open content model:** with `additionalProperties: false`, adding an optional field is backward compatible (old records still pass the new schema), but new records fail the *old* schema. That is acceptable here because the producer and consumer are deployed together. Every reader must pick the schema by the record's version, not "latest". An open model (extra fields allowed) would hide typos, which is the failure the user wants to catch.
- **Historical validation:**
  - Keep a registry, `{ "1.1.0": validator_1_1_0, "1.2.0": ... }`, built from `schemas/forecast-record/*.schema.json`. Each record is validated against the version it declares.
  - Add a CI job (and a `npm run validate:data` script) that checks every record in `data/forecasts.json` and any archived JSON, and fails on unknown versions.
  - Never rewrite old records to fit a new schema; upgrade them on read for the UI if needed.
  - Because `verification` changes a record after creation, validate on every write, not only on creation.
- **Data-loss risk tied to validation:** `readForecasts()` turns a corrupt file into `[]`, and the next `saveForecast()` then writes only the new record. That silently wipes history. A schema-validated read path should fail loudly, or move the bad file aside, instead of returning `[]`.

### Gaps
- No source found that compares SchemaVer and SemVer adoption for JSON data contracts specifically in finance or forecasting.

## (A5) Recording provenance for each input (source, as-of time, retrieval time, staleness, delayed vs real-time, licensing)

### Takeaway
No lightweight standard fits a single JSON record exactly. The common approach is to borrow vocabulary: W3C PROV's Entity/Activity/Agent with `used`, `wasGeneratedBy`, `wasDerivedFrom` and `wasAttributedTo`, and OpenLineage's per-dataset "facets" with immutable schema URLs. On top of that, give each input a small `InputObservation` object with value, status, source, `observed_at`, `retrieved_at`, staleness and latency class. Keep the existing flat snapshot fields for backward compatibility.

### Cited Findings
- PROV-O, a W3C Recommendation of 30 April 2013 — [W3C PROV-O](https://www.w3.org/TR/prov-o/):
  - Starting-point classes are Entity, Activity and Agent.
  - Starting-point properties are `wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo`, `used`, `startedAtTime`, `endedAtTime` and `wasAssociatedWith`.
  - `generatedAtTime`/`invalidatedAtTime` are "Expanded" terms marking when an entity starts and stops being usable.
- OpenLineage — [OpenLineage: facets](https://openlineage.io/docs/spec/facets/):
  - Metadata is attached as "facets" to Run, Job and Dataset (inputs and outputs).
  - Custom facets use a `{prefix}_{name}` key and a `{Prefix}{Name}{Entity}Facet` type name.
  - Each facet carries an immutable `_schemaURL`.
  - Re-emitting a facet with the same name replaces it.
- OpenLineage's standard dataset facets include Datasource, Data Quality Assertions, Data Quality Metrics, Schema, Version, Lifecycle State Change, Ownership, Storage, Symlinks, Column Level Lineage, Tags, Dataset Type, Catalog and Lineage. There is an input-only `data_quality_metrics` facet and an output-only `output_statistics` facet. — [OpenLineage: dataset facets](https://openlineage.io/docs/spec/facets/dataset-facets/)
- Repo context:
  - The snapshot today records provenance only as `missing_inputs: string[]`, a `source_coverage` enum, a `confidence_score` and free-text `raw_research_notes`. `sources[]` has only `title/uri/domain`. [src/types/forecast.ts](../../src/types/forecast.ts)
  - Python `/health` reports `"Yahoo Finance via yfinance (unofficial; personal research use only)"`, a licensing caveat that is not in the record. [chronos_service/app.py](../../chronos_service/app.py)
  - The "30m" premarket fields are computed from 1-minute bars between 04:00 and 04:29 ET (`between_time("04:00", "04:29")`). [chronos_service/app.py](../../chronos_service/app.py)

### Inferences
- **Per-input object.** Add `snapshot.inputs: { [input_id]: InputObservation }`, which is an ADDITION:

  ```json
  "InputObservation": {
    "type": "object", "additionalProperties": false,
    "required": ["value", "status", "source", "observed_at", "retrieved_at", "staleness_seconds", "latency_class"],
    "properties": {
      "value": {"type": ["number", "string", "null"]},
      "unit": {"type": "string"},
      "status": {"enum": ["ok", "stale", "missing", "error", "not_applicable", "estimated"]},
      "source": {"type": "object", "additionalProperties": false, "required": ["provider"],
        "properties": {"provider": {"type": "string"}, "product": {"type": "string"},
                       "instrument_id": {"type": "string"}, "uri": {"type": "string", "format": "uri"}}},
      "observed_at": {"type": ["string", "null"], "format": "date-time", "description": "as-of time of the datum itself (prov:generatedAtTime)"},
      "window": {"type": "object", "properties": {"start": {"type": "string", "format": "date-time"}, "end": {"type": "string", "format": "date-time"}, "bars": {"type": "integer"}}},
      "retrieved_at": {"type": "string", "format": "date-time", "description": "when the run fetched it (prov:used by the run activity)"},
      "staleness_seconds": {"type": ["number", "null"], "minimum": 0},
      "max_staleness_seconds": {"type": ["number", "null"], "minimum": 0},
      "latency_class": {"enum": ["real_time", "delayed_15m", "delayed_other", "end_of_day", "static", "unknown"]},
      "derived_from": {"type": "array", "items": {"type": "string"}, "description": "input_ids (prov:wasDerivedFrom)"},
      "method": {"type": "string"},
      "license": {"type": "object", "properties": {"terms": {"type": "string"}, "redistribution": {"enum": ["allowed", "restricted", "unknown"]}}},
      "error": {"type": ["string", "null"]}
    }
  }
  ```

  Note that `type: ["number","string","null"]` is a non-null union, which Ajv strict mode needs `allowUnionTypes: true` for. Alternatively, split it into `value_number`/`value_text`.
- **Run provenance block.** Add a run-level block (the PROV Activity, or OpenLineage "run" facet) with these fields:
  - `run_id`
  - `trigger`
  - `scheduled_for` (Cloud Scheduler's `X-CloudScheduler-ScheduleTime`, if used)
  - `started_at` and `ended_at`
  - `code_version` (git SHA)
  - `model_id`, plus model revision/hash
  - `service_versions`
  - `schema_id`
  - `calendar` (library + version)
  - `validation` (see A6)

  The Python `diagnostics` dict already holds much of this and is currently not stored in the record.
- **Derived values.** Derive `missing_inputs` (keep it for compatibility) and `source_coverage` from the statuses in `inputs`, instead of maintaining them by hand.
- **Staleness policy.** Set a policy per input class, e.g. premarket bars at most 5 min old at run time, VIX/futures from the last session close allowed, news at most 12 h. Breaching it sets `status: "stale"`, which feeds `confidence_score`.
- **Premarket window.** Record its actual bounds and bar count (`window`). A 04:00–04:29 window is only complete at about 04:30, so the "30m" fields cannot be complete in a report that must exist *by* 04:30 (see B1).
- **Don't over-adopt standards.** Full PROV-JSON or OpenLineage event emission is overkill for one record a day. Borrow the terms and the immutable-schema-URL discipline, and add OpenLineage events later only if a lineage backend (e.g. Marquez) is adopted.

### Gaps
- I found no finance-specific standard for "delayed vs real-time" provenance labels. Vendor terms (e.g. 15-minute delayed quotes) differ by exchange and vendor, so the enum above is a suggestion.
- Licensing and redistribution terms for Yahoo Finance and other vendors were not researched here; other researchers are covering data sources.

## (A6) Testing: validating fixtures and generated output in CI, property-based tests, and failing or flagging instead of silently publishing at 4:30am

### Takeaway
Add three kinds of tests to CI:
1. Schema and codegen integrity.
2. A shared valid/invalid fixture corpus run through Ajv and python-jsonschema.
3. Property-based tests of the reconcile/audit math against the semantic rules.

At runtime, validate before `saveForecast()`. An invalid record must never become "latest"; quarantine it, alert, and fall back to a clearly flagged degraded report.

### Cited Findings
- Current CI runs `npm install`, `npm run lint` (`tsc --noEmit`) and `npm run build` for Node, and `py_compile` plus `unittest discover` for Python. It does no schema or data validation. — [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- `datamodel-codegen --check` exits 1 on drift. — [datamodel-code-generator README](https://github.com/koxudaxi/datamodel-code-generator)
- python-jsonschema passes silently when a format dependency is missing. — [python-jsonschema: Schema Validation](https://python-jsonschema.readthedocs.io/en/stable/validate/)
- hypothesis-jsonschema fully tests drafts 04/05/07 only. — [hypothesis-jsonschema README](https://github.com/python-jsonschema/hypothesis-jsonschema)
- Current versions: fast-check 4.11.0 (2026-11-21), hypothesis 6.170.17 (2026-11-20), hypothesis-jsonschema 0.23.2 (2026-10-27), check-jsonschema 0.39.0 (2026-10-26). — [npm fast-check](https://www.npmjs.com/package/fast-check); [PyPI hypothesis](https://pypi.org/project/hypothesis/); [PyPI hypothesis-jsonschema](https://pypi.org/project/hypothesis-jsonschema/); [PyPI check-jsonschema](https://pypi.org/project/check-jsonschema/)
- Repo context:
  - `saveForecast()` writes without any validation. [server/storage.ts](../../server/storage.ts)
  - The in-process scheduler writes `last_scheduled_run_date_et = today` *before* running. A failure only updates `last_run_status`, so a failed 04:30 run is never retried that day.
  - `POST /api/tasks/premarket` does not check whether today's run already happened, so a retried or duplicate trigger reruns and saves again.
  - Source for both: [server.ts](../../server.ts)

### Inferences
- **CI job "contract":**
  1. Compile every schema with Ajv2020 `strict: true` (this fails on unknown keywords) and run `Draft202012Validator.check_schema` in Python.
  2. Check codegen drift (TS + Pydantic).
  3. Run the fixture corpus through both validators and require the same verdicts.
  4. Validate `data/forecasts.json` record by record against the version each declares.
  5. Run the semantic validator on all valid fixtures; invalid-semantics fixtures must produce the expected `rule` IDs.
  - `check-jsonschema` can serve as a ready-made CLI/pre-commit hook for step 4. I did not fetch its docs to confirm options.
- **CI job "generated output":** run the Python `_generate_forecast` and the TS `runForecastPipeline` with network calls mocked (recorded yfinance frames as fixtures) and a tiny model stub. Validate the full `ForecastRecord`. This catches producer-side drift that the fixtures would miss.
- **Property-based tests:**
  - fast-check: generate random raw bin vectors and weights, including degenerate ones (all zeros, NaN, negative, values summing to 0.97 or 1.03), run them through `mathAudit` reconcile, and assert the output always passes schema + semantics or is flagged `all_passed: false`. It must never pass while being wrong.
  - Hypothesis does the same for `_execution_signals` and the distribution builders.
  - hypothesis-jsonschema can generate random *valid* records from the portable-subset schema to fuzz the UI and readers. That only works if the schema stays draft-07-compatible.
- **Runtime gate at 4:30am:**
  1. `validateStructural(record)` (Ajv).
  2. `validateSemantics(record)`.
  3. Attach `record.validation = {schema_id, validator: "ajv@8.20.0", tolerances_id, validated_at, structural_ok, semantic_ok, issues[]}`.
  4. If everything passes, save it and mark it as today's published record.
  5. If it fails, write it to `data/quarantine/<date>-<run_id>.json`, do not replace the latest published record, set `last_run_status` to the failure, send the healthcheck `/fail` signal or an alert, and let the deadline fallback (B1) publish a degraded record with `source_coverage: "degraded"` and the issues listed.
  - Python should also serialize with `allow_nan=False`.
- **Scheduler idempotency fixes that tests should cover:**
  - Mark the date as done only after a *validated* success.
  - Key runs by `(trading_date_et, run_window, symbol)`.
  - Make the HTTP task endpoint return "already completed" for a duplicate trigger unless `force` is set.

### Gaps
- I did not find documentation on how well hypothesis-jsonschema handles `$defs` or 2020-12 `$schema` declarations in practice. Test it against the real schema.

## (B1) Scheduling reliability (GitHub Actions, Cloud Scheduler + Cloud Run, VM cron) and a pattern that guarantees a validated report by 4:30am ET

### Takeaway
GitHub Actions `schedule` now accepts an IANA `timezone` (since 2026-03-19), but GitHub documents it as best-effort: delays under load, worst at the top of the hour, and dropped jobs. It should not be the only trigger for a hard 4:30am deadline. Use **Cloud Scheduler** with `time_zone: America/New_York` as the primary trigger, plus a redundant secondary trigger on separate infrastructure and a dead-man's-switch alarm. Make runs idempotent per trading day. Pre-warm or bake in the Chronos-2 model to avoid cold-start risk. Add a deadline fallback that publishes a flagged degraded report. Also reconcile a design conflict: the 04:00–04:29 premarket window cannot be complete in a report due at 04:30.

### Cited Findings
- **GitHub Actions** — [GitHub Docs: schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule):
  - "By default, scheduled workflows run in UTC", and you "can optionally specify a timezone using an IANA timezone string".
  - The minimum interval is 5 minutes.
  - "The `schedule` event can be delayed during periods of high loads... High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped."
  - Schedules run only on the default branch.
  - In public repos, schedules are disabled after 60 days without activity.
- GitHub syntax example: `- cron: '30 5 * * 1-5'` with `timezone: "America/New_York"`. "Scheduled workflows in skipped hours advance to the next valid time" (2:30 AM becomes 3:00 AM at spring-forward). — [GitHub Docs: workflow syntax on.schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
- The timezone feature was announced 2026-03-19: "You can now specify an IANA timezone on your cron schedules instead of being locked to UTC." — [GitHub Changelog, late March 2026](https://github.blog/changelog/2026-03-19-github-actions-late-march-2026-updates/)
- In a July 2026 community report, a daily `schedule` on a new public repo ran 8–14.5 h late on most days and was skipped on some. Moving off minute `:00` did not help, and there was no GitHub staff response. Suggested workaround: an external cron calling `workflow_dispatch`/`repository_dispatch`. This is one anecdotal report. — [GitHub Community #201738](https://github.com/orgs/community/discussions/201738)
- **Cloud Scheduler time zones** — [Cloud Scheduler: cron schedules](https://docs.cloud.google.com/scheduler/docs/configuring/cron-job-schedules):
  - The time zone is a tz-database name (default UTC), and "Cloud Scheduler runs on wall clock time".
  - "For some time zones, daylight saving time can cause jobs to run or not run unexpectedly". Jobs at times that happen twice may misbehave, and UTC is recommended to avoid this entirely.
- **Cloud Scheduler retries:**
  - `retryCount` defaults to 0, and values above 5 are rejected.
  - `maxRetryDuration` defaults to 0 (unlimited).
  - `minBackoffDuration` defaults to 5 s; `maxBackoffDuration` defaults to 1 h; `maxDoublings` defaults to 5 (example: 10 s, 20 s, 40 s, 80 s, 160 s).
  - Source: [Cloud Scheduler: retry jobs](https://docs.cloud.google.com/scheduler/docs/configuring/retry-jobs)
- **Cloud Scheduler HTTP targets and deduplication** — [Cloud Scheduler REST: Job](https://docs.cloud.google.com/scheduler/docs/reference/rest/v1/projects.locations.jobs):
  - `attemptDeadline`: "the default is 3 minutes. The deadline must be in the interval [15 seconds, 30 minutes]."
  - "Cloud Scheduler will never allow two simultaneously outstanding executions."
  - The `X-CloudScheduler-ScheduleTime` header "Remains constant across retries and can be used for job request deduplication."
- Cloud Scheduler can attach an OIDC token (`--oidc-service-account-email`; the audience defaults to the target URI). — [gcloud scheduler jobs create http](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/create/http)
- Cloud Scheduler can trigger Cloud Run *jobs* through `POST https://run.googleapis.com/v2/projects/PROJECT/locations/REGION/jobs/JOB:run` with an OAuth service account. The Terraform example sets `retry_config { retry_count = 3 }`. — [Cloud Run: execute jobs on a schedule](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
- Cloud Run job tasks time out after 10 minutes by default; the maximum is 168 hours. Retries are recommended for all jobs. — [Cloud Run: task timeout](https://docs.cloud.google.com/run/docs/configuring/task-timeout)
- **Cloud Run cold starts** — [Cloud Run: general tips](https://docs.cloud.google.com/run/docs/tips/general):
  - Startup means downloading the image, running the entrypoint, then waiting for the port. When scaling from zero, "a request must wait for a new instance to start".
  - Minimum instances reduce cold starts.
  - Startup CPU boost "temporarily increase[s] CPU allocation during instance startup".
  - Global initialization adds to startup time; lazy loading moves that cost to the first request.
- Chronos-2 is a "120M-parameter, encoder-only time series foundation model" that supports CPU and GPU inference, with F32 tensors. The model card gives no CPU load time or latency. — [Hugging Face: amazon/chronos-2](https://huggingface.co/amazon/chronos-2)
- **Healthchecks.io** cron checks take a cron expression and a time zone. Grace time is "how long to wait before sending an alert for a late check". After a "start" signal, a "success" is expected within grace time, otherwise the check fails and alerts go out. — [Healthchecks.io: configuring checks](https://healthchecks.io/docs/configuring_checks/)
- **DST check (local run of pandas_market_calendars 5.6.1):** NYSE pre-market start is 09:00 UTC on 2026-03-06 (EST) and 08:00 UTC on 2026-03-09 (EDT), confirming the one-hour UTC shift around the 2026-03-08 DST change. — [pandas_market_calendars on PyPI](https://pypi.org/project/pandas-market-calendars/) (verified locally)
- **Repo context** — [server.ts](../../server.ts); [server/storage.ts](../../server/storage.ts); [chronos_service/app.py](../../chronos_service/app.py):
  - The Node server polls every 30 s (`setInterval(..., 30_000)`), and the default `time_et` is `'04:30'`. That is the *start* time, so the run cannot finish by 04:30.
  - The scheduler state lives in a local `data/schedule.json`.
  - `POST /api/tasks/premarket` runs synchronously inside the HTTP request, is protected by a static `CRON_SECRET` bearer token, and skips non-trading days via `getEasternClock()`.
  - Python loads Chronos-2 in the FastAPI lifespan, so a cold start pays the full model load, and `/health` reports `model_loaded`.

### Inferences
- **Recommended timeline (America/New_York, Mon–Fri; the app decides whether it is a trading day):**
  1. **03:45, warm-up:** Cloud Scheduler job A calls the Chronos service `/health` until `model_loaded: true`. Alternatively, set Cloud Run min-instances = 1 during 03:30–10:00 and enable startup CPU boost. Bake the model weights into the image so a cold start does not download from Hugging Face.
  2. **04:05, primary run:** Cloud Scheduler job B (`5 4 * * 1-5`, `--time-zone=America/New_York`, OIDC auth instead of a shared secret, `retryCount: 3`, `minBackoff: 30s`, `maxBackoff: 120s`, `maxRetryDuration: 15m`).
     - Target a Cloud Run **job** (task timeout about 15 min), or an HTTP endpoint that returns 202 at once with a `run_id`. Do not hold the 3-minute default `attemptDeadline` open; if the endpoint must stay synchronous, raise `attemptDeadline` towards its 30-min maximum.
     - Use `X-CloudScheduler-ScheduleTime` plus `(trading_date_et, run_window, symbol)` as the idempotency key.
  3. **04:15, secondary trigger on independent infrastructure:** e.g. a GitHub Actions workflow with `cron: '15 4 * * 1-5'` and `timezone: America/New_York`, off minute 0, which calls the same endpoint, or a second Cloud Scheduler job in another region. It does nothing if today's validated record exists.
  4. **04:25, deadline watchdog:** if no validated record exists, publish a degraded fallback, e.g. a forecast anchored on the last close using only end-of-day inputs, or yesterday's distribution re-anchored. Label it `source_coverage: "degraded"`, `data_quality.missing_inputs` populated, and `trigger: "fallback"`; the last one needs an enum ADDITION. Then alert.
  5. **Dead-man's switch:** a Healthchecks.io cron check `5 4 * * 1-5`, tz America/New_York, grace about 25 min. The app pings `/start` when a run begins, success only after a *validated* publish, and `/fail` when validation fails. On exchange holidays the app should still ping success with "skipped: holiday", because a generic monitor knows only weekdays (inference).
- **DST:** with `America/New_York` set in Cloud Scheduler or GitHub Actions, 04:05 is outside the 01:00–03:00 transition window, so neither the skipped-hour nor the repeated-hour issue applies. For UTC-only schedulers (plain VM cron, older setups), schedule both 08:05 and 09:05 UTC and let the app gate on ET wall-clock time plus idempotency; the extra trigger does nothing.
- **Premarket-window conflict:** the "30m" fields use 04:00–04:29 bars, so a complete window exists only after about 04:30, plus any vendor lag. Choose one of:
  - (a) Shorten the window to the first 15–20 min (04:00–04:19), name it as such and record `window` provenance.
  - (b) Publish a `run_window: "pre_market"` report by 04:30 with a partial window, then a `pre_bell` revision later. The app already has this enum.
  - (c) Move the deadline. Option (b) fits the existing data model best.
- **Fix the in-process timer before keeping it as a tertiary trigger:**
  - Default `time_et` to about `04:05`, not `04:30`.
  - Record "attempted" and "succeeded" separately, so failures retry within a window (e.g. until 04:25).
  - Do not rely on it alone; it disappears whenever the Node process is down or scaled to zero.
- **Why not GitHub Actions as primary:** it is documented as best-effort and has had anecdotal multi-hour delays. Public-repo schedules also turn off after 60 days of inactivity. A daily bot commit would count as activity, but GitHub does not guarantee that.
- **VM cron:** a VM with cron or a systemd timer is simple and precise, but it is a single machine with no built-in retries or alerting. If used, pair it with the same idempotency, retry loop, dead-man's switch and deadline fallback. I did not research `CRON_TZ`/systemd `OnCalendar` time-zone specifics with sources.

### Gaps
- No official GitHub statistics on typical `schedule` delay; the evidence is anecdotal.
- Cloud Scheduler's fetched pages say nothing explicit about at-least-once delivery or start-time accuracy.
- Chronos-2 CPU load time and inference latency are undocumented. Measure the real cold-start-to-first-forecast time on the chosen Cloud Run CPU/memory size; that number decides between min-instances and a warm-up ping.
- The publish lag of yfinance 1-minute premarket bars, i.e. when the 04:29 bar becomes available, was not researched.
- Healthchecks.io `/start` and `/fail` URL details are in a separate "Signaling failures" doc that I did not fetch.

## (B2) Exchange holiday and early-close calendars: pandas_market_calendars or exchange_calendars vs hard-coded lists

### Takeaway
Use one calendar authority. The Python service already depends on pandas_market_calendars, and it should feed the Node scheduler, either through an endpoint or a generated JSON calendar file checked in CI. The hard-coded TS list matches pandas_market_calendars exactly for 2026–2027 today. It ends on 2027-12-24, so from 2028 every weekday would silently count as a trading day, and it has no early closes. Library calendars also need package upgrades to pick up ad-hoc closures.

### Cited Findings
- pandas_market_calendars — [pandas_market_calendars README](https://github.com/rsheftel/pandas_market_calendars); [PyPI](https://pypi.org/project/pandas-market-calendars/):
  - It "provides a mirror of all the calendars from the exchange_calendars package" (since v2.0), using the locally installed version.
  - Calendars "are shipped as package code", and the package "does not request market hours from a server at runtime". To get corrections you must "install a newer package release".
  - The README says the minimum Python is 3.9 (as of v5.0) and the minimum pandas is 2.3 (as of v5.6.0). PyPI metadata for 5.6.1 (2026-11-14) says `requires_python >= 3.10`, which conflicts with the README.
- pandas_market_calendars API: `schedule(start_date, end_date)`, `early_closes(schedule)`, `holidays()`, `valid_days(start, end)` and `open_at_time(schedule, ts, only_rth=...)`. `schedule(..., start="pre", end="post")` adds extended-hours columns, and the `special_{market_time}_adhoc` properties define exceptions in a subclass. — [pandas_market_calendars usage](https://pandas-market-calendars.readthedocs.io/en/latest/usage.html)
- exchange_calendars (4.13.3, 2026-11-14, Python >= 3.10, < 4) — [exchange_calendars README](https://github.com/gerrymanoim/exchange_calendars); [PyPI](https://pypi.org/project/exchange-calendars/):
  - It covers 50+ exchanges by ISO-10383 MIC, including XNYS, with `is_session`, `sessions_in_range`, `next_session`/`previous_session` and minute-level methods.
  - "All of the exchange calendars are maintained by user contributions" via pull requests.
  - It was forked from quantopian/trading_calendars.
- **Local run of pandas_market_calendars 5.6.1, NYSE and NASDAQ, 2026-01-01 to 2027-12-31:**
  - Weekday closures: 2026-01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07, 11-26, 12-25; 2027-01-01, 01-18, 02-15, 03-26, 05-31, 06-18, 07-05, 09-06, 11-25, 12-24.
  - That is identical to the `US_MARKET_HOLIDAYS` set in `server.ts`, with nothing missing and nothing extra.
  - Early closes at 13:00 ET: 2026-11-27, 2026-12-24, 2027-11-26.
  - Source: [PyPI pandas_market_calendars](https://pypi.org/project/pandas-market-calendars/) (verified locally); [server.ts](../../server.ts)
- Repo context:
  - Python uses `mcal.get_calendar("NASDAQ")` for session phase and `_future_market_sessions` for horizon dates. [chronos_service/app.py](../../chronos_service/app.py)
  - Node uses a separate hard-coded 2026–2027 list plus a weekend check and has no early-close awareness. [server.ts](../../server.ts)
  - `requirements.txt` pins `pandas-market-calendars>=4.4,<6.0` and `pandas>=2.2,<4.0`. [chronos_service/requirements.txt](../../chronos_service/requirements.txt)

### Inferences
- **One calendar authority.** Either:
  - (a) Add `GET /calendar?date=YYYY-MM-DD` to the Python service, returning `{is_trading_day, pre_open, open, close, early_close, next_session}` from pandas_market_calendars, which the Node scheduler calls with a cached fallback; or
  - (b) Have a script write `data/market_calendar.json` (24 months ahead, schema-validated, with the library version stamped in) for Node to read. Add a CI test that fails when coverage is under about 13 months ahead or when the file disagrees with pandas_market_calendars.
  - Either removes the TS/Python drift risk and the 2028 cliff.
- **Library choice:** pandas_market_calendars and exchange_calendars share calendar data (pandas_market_calendars mirrors exchange_calendars), so the choice is about API style. pandas_market_calendars is already installed and offers `start="pre"` extended-hours columns, which suit a premarket scheduler.
- **Ad-hoc closures** (e.g., national days of mourning) arrive only with package releases. Keep a small schema-validated `calendar_overrides.json` that the calendar authority applies on top. Bump pandas_market_calendars regularly (e.g. Dependabot, or a weekly scheduled CI job comparing against the latest release).
- **Early closes don't move the 04:05 trigger,** but they matter in three places:
  - EOD `run_window` timing (13:00 close on 2026-11-27).
  - Horizon semantics around holidays. For example, a run on Wed 2026-11-25 has "tomorrow" = Fri 2026-11-27, a half day.
  - Verification of the "tomorrow" close.

  Record the next session's date and early-close flag in the payload.
- **Calendar choice vs listing venue:** TQQQ is Nasdaq-listed and the Python service uses the NASDAQ calendar, which matched NYSE for 2026–2027 in the local check. Using either is fine; say which one in the provenance block.

### Gaps
- Neither library's docs, as fetched, explain how ad-hoc closures are added or how fast. Historical precedent for release speed after a surprise closure was not researched.
- No maintained JavaScript/TypeScript NYSE calendar library was evaluated; I recommend letting the Python service be the authority instead.
