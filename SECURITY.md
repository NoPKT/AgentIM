# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Please send vulnerability reports to **security@nopkt.com**. Include the following information in your report:

- A description of the vulnerability and its potential impact.
- Steps to reproduce the issue or a proof-of-concept.
- The affected version(s) and component(s) (server, web, gateway, shared).
- Any suggested fixes, if available.

## Response Timeline

- **Acknowledgment**: Within 48 hours of receiving your report.
- **Assessment**: We will evaluate the severity and confirm whether the issue is accepted.
- **Fix**: Critical vulnerabilities will be addressed within 30 days.
- **Disclosure**: A fix will be released before any public disclosure.

## Responsible Disclosure

We ask that you give us a reasonable amount of time to address the issue before disclosing it publicly. We are committed to working with security researchers and will credit reporters in release notes (unless anonymity is requested).

Thank you for helping keep AgentIM and its users safe.

## Deployment Security Checklist

- Set `JWT_SECRET` to a cryptographically random string (min 32 chars): `openssl rand -hex 32`
- Set `ENCRYPTION_KEY` to a strong random string (min 32 chars): `openssl rand -hex 32`
- Set `CORS_ORIGIN` to your exact frontend domain (e.g., `https://app.example.com`)
- Set `TRUST_PROXY=true` only when behind a trusted reverse proxy (nginx, Cloudflare, etc.)
- Use HTTPS in production — set `NODE_ENV=production` to enable secure cookies and HSTS
- Set strong `ADMIN_PASSWORD` meeting complexity requirements (8+ chars, mixed case + digit)
- Regularly rotate `JWT_SECRET` and `ENCRYPTION_KEY` (will invalidate active sessions)
- Monitor `/api/health` endpoint for database, Redis, and filesystem connectivity
