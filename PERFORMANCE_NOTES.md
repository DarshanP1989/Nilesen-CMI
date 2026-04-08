# npm check performance notes for Excel workflow

If your Excel flow already works but `npm check` is slow, use this faster pattern:

## 1) Run lightweight checks during development

Use a quick dependency check instead of a full audit every run:

```bash
npm ls --depth=0
```

Then run a full audit only when needed (for example before release):

```bash
npm audit --production
```

## 2) Install faster with cache/offline preferences

Use:

```bash
npm ci --prefer-offline --no-audit --progress=false
```

This reduces repeated network and audit overhead.

## 3) For Excel-heavy scripts, avoid loading whole files in memory

If you are using the `xlsx` package, large files can be slow. Prefer:
- reading only required sheets,
- processing rows in chunks,
- avoiding repeated workbook parse/write in a loop.

If your workload is very large, consider a streaming parser/writer package.

## 4) Keep secret files out of slow scans

If you keep local-only secrets or operator files, ensure they are excluded from tooling scans where possible (for example via `.gitignore`):

- Add only required source directories to lint/check commands.
- Avoid broad glob patterns over the whole project root.
- Keep secret/local-only files ignored by git and excluded from scanners.

## 5) Example npm scripts split (fast vs full)

```json
{
  "scripts": {
    "check:fast": "npm ls --depth=0",
    "check:full": "npm audit --production"
  }
}
```

Use `check:fast` while iterating and `check:full` in CI/release.
