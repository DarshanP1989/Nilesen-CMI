# PBIT/PBIX Security Guidance for GitHub (Databricks Connections)

## Short answer
Uploading a `.pbit`/`.pbix` file to GitHub is **not fully safe by default**.

If your report contains Databricks connection details, query text, parameters, or accidentally embedded credentials/tokens, that information can be exposed to anyone who can access the repo (or the public internet if the repo is public).

## What can leak from Power BI template/report files
Depending on how the file was authored, these items may be present:
- Server/hostnames and HTTP paths for Databricks SQL warehouse/cluster.
- Workspace/catalog/schema/table names.
- M queries and SQL text.
- Parameter defaults (sometimes sensitive).
- Data source metadata and model structure.
- In bad setups: personal access tokens, DSN strings, or secrets pasted into parameters.

## Databricks-specific risk
For Databricks, exposure of the following is high-risk:
- Personal Access Tokens (PAT)
- Client secrets
- JDBC/ODBC strings containing secrets
- Any hardcoded bearer token in query/parameter code

Even if credentials are not present, infrastructure metadata can still be sensitive.

## Safer approach before pushing to GitHub
1. Keep the repository **private**.
2. Never store tokens/secrets in `.pbit/.pbix` parameters.
3. Move sensitive values to secure runtime stores (Key Vault / secret manager).
4. Use service principals/OAuth with least privilege.
5. Rotate Databricks tokens immediately if you suspect exposure.
6. Run a secret scan before push (e.g., gitleaks/trufflehog).
7. Add repository secret scanning + branch protection.
8. Share a sanitized template with placeholders only.

## Recommended policy for your case
Because you have Databricks connections:
- Do **not** upload raw `.pbit/.pbix` to a public GitHub repo.
- If you must version-control report artifacts, publish only sanitized templates and keep connection material external.
- Treat any previously uploaded file as potentially exposed until reviewed.


## If your GitHub repo is private
A private repository is **safer than public**, but it is still not risk-free:
- Anyone with repo access (team members, contractors, CI systems, GitHub Apps) can read the file.
- Secrets can still leak through forks, logs, screenshots, exports, or compromised accounts.
- If credentials are committed once, they may persist in git history until rewritten.

Practical guidance for private repos:
- OK to store `.pbit` only after sanitizing all secrets/tokens/connection parameters.
- Prefer storing report source + deployment config, not live credentials.
- Enforce SSO/MFA, least-privilege access, and secret scanning alerts.

## If already uploaded
- Remove the file from current commit and git history.
- Rotate all possibly exposed credentials/tokens.
- Audit Databricks access logs.
- Re-publish a cleaned template.
