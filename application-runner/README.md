# Job Application Platform Runner

Separate authenticated API endpoints for every platform configured in Notion.

## Safety contract

- A non-dry-run request requires `approvalSource=notion_apply_button` plus `approvedAt`.
- CAPTCHA, login, 2FA, and unknown required questions return `manual_required` with a Steel Live View URL.
- CAPTCHA is never bypassed automatically.
- Vacancy URLs are HTTPS-only, DNS-checked, and platform/ATS allowlisted.
- Secrets belong in Render environment variables, never Git.

## Required environment

- `APPLICATION_RUNNER_TOKEN`
- `STEEL_API_KEY` for Steel Cloud, or `STEEL_BASE_URL` for a protected self-hosted Steel instance
- `PORT` is provided by Render

## Examples

- `POST /v1/linkedin/apply`
- `POST /v1/linkedin/resume`
- `POST /v1/indeed/apply`
- `POST /v1/indeed/resume`

The same pair exists for each of the 18 Notion platform options.

