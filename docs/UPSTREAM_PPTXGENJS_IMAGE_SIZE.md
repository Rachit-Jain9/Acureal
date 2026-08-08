# Upstream report draft — pptxgenjs / image-size advisory

**Status:** drafted 2026-08-08, **not yet filed**. Posting it is an outward-facing
action under the operator's GitHub identity, so it waits for an explicit go-ahead.

**Where it goes:** <https://github.com/gitbrent/PptxGenJS/issues>

**Why file it at all.** `image-size` carries two unfixable HIGH advisories, and
`pptxgenjs` is the sole declarant of that dependency. Every project that
installs pptxgenjs inherits a `npm audit` failure for code that — as far as we
can determine — the library never executes. We have already had to build a
waiver mechanism in CI to keep merging. Upstream can remove the problem for
every consumer at once by dropping a dependency it does not appear to use.

**Everything below was verified in this repo on 2026-08-08**, against
`pptxgenjs@4.0.1` and `image-size@1.2.1` as installed by npm.

---

## Suggested title

`image-size is a hard dependency but appears unused — every consumer inherits two unfixable HIGH advisories`

## Suggested body

> **Summary**
>
> `pptxgenjs` declares `image-size` as a runtime dependency. `image-size` currently
> carries two HIGH advisories with **no patched version available**:
>
> - [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) — DoS in the ICNS parser
> - [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) — DoS in the JXL and HEIF parsers
>
> Both cover `<=2.0.2`, and `2.0.2` is the latest published version of
> `image-size` (unchanged since 2025-04-02). There is nothing to pin to.
>
> `npm audit`'s only offered remediation is downgrading `pptxgenjs` from `4.0.1`
> to `1.1.5` — four major versions back — which is not a realistic option for
> anyone using the library.
>
> The result is that every project depending on pptxgenjs fails a
> `npm audit --audit-level=high` gate, indefinitely, with no action available to
> them.
>
> **The dependency appears to be unused.**
>
> Four independent observations, from the installed package:
>
> 1. **Nothing in the shipped tree imports it.** Searching the installed
>    `pptxgenjs` package for `require('image-size')`, `from 'image-size'` and
>    `import('image-size')` returns no matches in any shipped bundle.
> 2. **The one call site is commented out.** The only `sizeOf` reference in the
>    CJS/ESM bundles sits inside a `getSizeFromImage()` block annotated
>    `FIXME: TODO: currently unused` — and it names a package that does not
>    exist (`require('sizeof')`, not `image-size`). The minified bundles omit it
>    entirely.
> 3. **Confirmed empirically, not by reading.** Hooking `Module.prototype.require`
>    and generating a full PPTX *including an embedded image* loads 90+ modules.
>    `image-size` is not among them.
> 4. **`browser` field already stubs it.** `pptxgenjs`'s own `package.json` maps
>    `image-size` to `false` for browser builds, which suggests it is not
>    considered load-bearing there either.
>
> **Request**
>
> If `image-size` is genuinely unreferenced, removing it from `dependencies`
> (or moving it to `optionalDependencies` / `devDependencies` as appropriate)
> would clear the advisory for every downstream consumer without any behaviour
> change.
>
> If it *is* needed on some path we did not exercise, it would be very helpful
> to know which — we would rather fix our understanding than carry a waiver.
>
> Happy to open a PR if that is useful.
>
> **Environment**
> - `pptxgenjs@4.0.1` (latest at time of writing)
> - `image-size@1.2.1` (as resolved by npm for this tree)
> - Node 20, npm 10

---

## Before posting — re-verify

Advisory state moves. Re-run these two checks immediately before filing, and
update the numbers in the body if they have changed:

```bash
npm view image-size version          # expect 2.0.2 — if higher, a fix may exist
npm view pptxgenjs version           # expect 4.0.1 — if higher, check its deps first
```

If `image-size` has published a version above `2.0.2`, **do not file this** —
pin the fix instead and delete the waivers in `scripts/check-npm-advisories.js`.
The CI gate now detects that case automatically and fails with instructions.

## Related

- Waivers and their evidence: `scripts/check-npm-advisories.js`
- Gate behaviour and tests: `backend/tests/checkNpmAdvisories.test.js`
- Waiver expiry: **2026-11-06**
