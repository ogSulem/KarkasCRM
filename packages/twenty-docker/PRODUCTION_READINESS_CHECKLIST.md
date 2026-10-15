# KarkasCRM / Twenty Production Readiness Checklist

This checklist implements a practical rollout path from a base Twenty deployment to a company-ready CRM.

## 1) Functional parity target (amoCRM-style)

Define and freeze target behavior before rollout:

- [ ] Sales modules matrix approved (Leads/Contacts/Companies/Deals/Tasks/Notes/Files)
- [ ] Pipelines and stages matrix approved by sales leadership
- [ ] Required fields per stage documented
- [ ] Automation map approved (triggers, SLA timers, reminders, ownership rules)
- [ ] Reporting/KPI list approved (pipeline value, conversion by stage, win rate, SLA breaches)
- [ ] Access model approved (admins, managers, reps, support, finance)

## 2) Production infrastructure

- [ ] Domain DNS configured (`crm.example.com`)
- [ ] `.env.production` created from `.env.production.example`
- [ ] Secrets generated and stored in secret manager
- [ ] S3-compatible object storage configured
- [ ] Regular DB backup job configured and restore tested
- [ ] Monitoring/alerting enabled (container health, db disk, memory, CPU)
- [ ] TLS mode enabled with profile:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.tls.yml \
  --profile tls up -d
```

## 3) Configuration variables

- [ ] `SERVER_URL` matches external URL exactly
- [ ] `ENCRYPTION_KEY` configured and backed up securely
- [ ] `PG_DATABASE_PASSWORD` replaced with strong value
- [ ] OAuth values configured if Google/Microsoft auth is required
- [ ] SMTP values configured for outbound email
- [ ] Storage switched to `S_3` for production

## 4) RBAC and row-level permissions

- [ ] Roles created for each department
- [ ] Object-level permissions configured per role
- [ ] Field-level restrictions set for sensitive fields
- [ ] Row-level permissions configured (when using Organization plan)
- [ ] API keys assigned to least-privilege roles
- [ ] AI agents assigned to least-privilege roles

## 5) Integrations (including WhatsApp strategy)

- [ ] Integration inventory approved (email, calendars, telephony, chat, ERP)
- [ ] Webhooks/API integration baseline configured
- [ ] WhatsApp provider selected (e.g., Twilio/360dialog/Meta BSP)
- [ ] Inbound WhatsApp -> webhook -> workflow mapping implemented
- [ ] Outbound message flow and templates approved
- [ ] Error/retry/dead-letter handling defined for integration failures

## 6) Pipelines, SLA, and automations

- [ ] Pipelines created and ordered for each business stream
- [ ] Stage entry/exit criteria documented
- [ ] Mandatory fields enforced before stage transitions
- [ ] SLA timers configured (first response, follow-up, resolution)
- [ ] Workflow automations tested for create/update/assignment/escalation
- [ ] Manual fallback process documented for automation outages

## 7) UAT and go-live

- [ ] UAT scenarios executed by real users (sales, management, ops)
- [ ] Critical defects fixed and retested
- [ ] Migration/import dry-run completed with real sample data
- [ ] Go-live checklist signed off
- [ ] Support runbook shared with internal owners
- [ ] Post-launch review scheduled (D+3, D+14, D+30)

## Notes

- This repository provides the platform and deployment baseline.
- Final company readiness still requires organization-specific configuration, data model alignment, and integration credentials.
