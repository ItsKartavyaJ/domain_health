# Smartlead API Reference

Base URL: `https://server.smartlead.ai/api/v1`  
Auth: all requests require `?api_key=<SMARTLEAD_API_KEY>` as a query parameter.

---

## Endpoints Used by This Project

### Email Accounts

#### List all email accounts
```
GET /email-accounts/
```
Returns all connected mailboxes. Paginated.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `api_key` | string | — | required |
| `limit` | int | 100 | records per page |
| `offset` | int | 0 | pagination offset |

**Response** — list of account objects, or `{ "data": [...] }` envelope:
```json
[
  {
    "id": 1234,
    "from_email": "sender@example.com",
    "from_name": "Sender Name",
    "status": "connected",
    "warmup_enabled": true,
    "smtp_host": "smtp.google.com"
  }
]
```

Key fields used by this project:

| Field | Where used |
|-------|-----------|
| `id` | warmup_stats: per-mailbox warmup fetch; reconnect_monitor |
| `from_email` / `email` | domain extraction for discovery |
| `status` | reconnect_monitor: `connected` / `disconnected` / `reconnect_required` |
| `warmup_enabled` / `warmup_status` | warmup_stats: warmup on/off |

**Used by:** `domain_discovery._fetch_all_mailboxes()`, `reconnect_monitor`

---

#### Get warmup stats for one email account
```
GET /email-accounts/{id}/warmup-stats
```
Returns the last 7 days of warmup send/inbox/spam counts for a single mailbox.  
Returns `404` when the account has no warmup configured — treat as "warmup not enabled" (not an error).

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | int | email account ID from `/email-accounts/` |

**Response:**
```json
{
  "total_sent": 42,
  "inbox_count": 38,
  "spam_count": 4,
  "inbox_percentage": 90.48,
  "spam_percentage": 9.52,
  "warmup_enabled": true,
  "warmup_status": "active"
}
```

Key fields:

| Field | Fallback keys |
|-------|--------------|
| `total_sent` | `sent_count`, `total` |
| `inbox_count` | `total_inbox`, `inbox` |
| `spam_count` | `total_spam`, `spam` |
| `inbox_percentage` | `inbox_pct` |
| `spam_percentage` | `spam_pct` |
| `warmup_enabled` | `warmup_status`, `status` |

**Used by:** `warmup_stats.fetch_warmup_stats()`

---

### Global Analytics

#### Domain-wise health metrics
```
GET /analytics/mailbox/domain-wise-health-metrics
```
Aggregate health metrics rolled up per sending domain over the date range.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `api_key` | string | required |
| `start_date` | date (YYYY-MM-DD) | range start |
| `end_date` | date (YYYY-MM-DD) | range end |

**Response** — may be a bare list, `{ "data": [...] }`, or `{ "data": {...} }` (single domain):
```json
[
  {
    "domain": "example.com",
    "sent_count": 1500,
    "inbox_count": 1350,
    "spam_count": 30,
    "inbox_percentage": 90.0,
    "spam_percentage": 2.0,
    "bounce_count": 15,
    "bounce_rate": 1.0,
    "open_rate": 42.5,
    "reply_rate": 8.3,
    "positive_reply_rate": 3.1,
    "mailbox_count": 8
  }
]
```

Field fallback mapping (project normalisation):

| Canonical | Fallbacks |
|-----------|-----------|
| `domain` | `sending_domain` |
| `sent_count` | `total_sent` |
| `inbox_count` | `total_inbox` |
| `spam_count` | `total_spam` |
| `inbox_percentage` | `inbox_pct`, `inbox_rate` |
| `spam_percentage` | `spam_pct`, `spam_rate` |
| `bounce_count` | `total_bounce` |
| `bounce_rate` | `bounce_percentage` |
| `open_rate` | `open_percentage` |
| `reply_rate` | `reply_percentage` |
| `positive_reply_rate` | `positive_reply_percentage`, `positive_reply_pct` |
| `mailbox_count` | `email_count` (default 1) |

**Note:** The response envelope is unpredictable — a single-domain account returns a dict, not a list. The project normalises via `_normalise_list()` in `SmartleadClient`.

**Written to:** InfluxDB `smartlead_health` (grain=domain)  
**Used by:** `smartlead_health.fetch_domain_health()`, `domain_discovery._fetch_active_domains()`

---

#### Name (mailbox)-wise health metrics
```
GET /analytics/mailbox/name-wise-health-metrics
```
Same date-range health metrics broken down per individual email address instead of per domain.

**Query params** — same as domain-wise above.

**Response:**
```json
[
  {
    "email": "sender@example.com",
    "sent_count": 320,
    "inbox_percentage": 88.5,
    "spam_percentage": 3.1,
    "bounce_rate": 1.2,
    "warmup_status": "active",
    "tag": "outreach-batch-1"
  }
]
```

Field fallback mapping:

| Canonical | Fallbacks |
|-----------|-----------|
| `email` | `email_address`, `from_email` |
| `inbox_percentage` | `inbox_pct`, `inbox_rate` |
| `spam_percentage` | `spam_pct`, `spam_rate` |
| `bounce_rate` | `bounce_percentage` |
| `warmup_status` | `warmup_enabled` |
| `tag` | `tags` |

Domain is derived from the email address (split on `@`).  
`health_score` is computed locally: `0.5 * inbox_pct + (1 - spam_pct/10) * 30 + (1 - bounce_rate/10) * 20` (clamped 0–100).

**Written to:** InfluxDB `smartlead_health` (grain=mailbox)  
**Used by:** `smartlead_health.fetch_name_health()`

---

#### Mailbox overall stats
```
GET /analytics/mailbox/overall-stats
```
Account-wide aggregate totals (single object, no date params needed).

**Query params:** `api_key` only.

**Response:**
```json
{
  "total_sent": 50000,
  "total_inbox": 43000,
  "total_spam": 1500,
  "inbox_rate": 86.0,
  "spam_rate": 3.0
}
```

**Used by:** `smartlead_health.fetch_mailbox_overall()` (fetched but not written to InfluxDB currently)

---

### Campaigns

#### List all campaigns
```
GET /campaigns/
```
Returns every campaign. The project filters to status `ACTIVE`, `IN_PROGRESS`, or `STARTED`.

**Query params:** `api_key` only.

**Response** — list or `{ "data": [...] }` / `{ "list": [...] }` envelope:
```json
[
  {
    "id": 99,
    "name": "Q2 Outreach",
    "status": "ACTIVE",
    "sending_domain": "example.com",
    "from_domain": "example.com"
  }
]
```

Active status values treated as live campaigns: `ACTIVE`, `IN_PROGRESS`, `STARTED`.

**Used by:** `campaign_bounce.fetch_active_campaigns()`

---

#### Get campaign statistics
```
GET /campaigns/{id}/statistics
```
Per-campaign delivery stats.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | int | campaign ID |

**Query params:** `api_key` only.

**Response:**
```json
{
  "sent_count": 800,
  "bounce_count": 12,
  "open_count": 320,
  "reply_count": 65,
  "bounce_rate": 1.5,
  "open_rate": 40.0,
  "reply_rate": 8.1
}
```

Field fallback mapping:

| Canonical | Fallbacks |
|-----------|-----------|
| `sent_count` | `total_sent`, `emails_sent` |
| `bounce_count` | `total_bounced`, `bounces` |
| `open_count` | `total_opened`, `opens` |
| `reply_count` | `total_replied`, `replies` |
| `bounce_rate` | `bounce_percentage` |
| `open_rate` | `open_percentage` |
| `reply_rate` | `reply_percentage` |

Rates are recomputed from counts when the API returns 0 but counts are non-zero.

**Written to:** InfluxDB `campaign_bounce`  
**Used by:** `campaign_bounce.fetch_campaign_stats()`

---

## Error Handling

| HTTP status | Behaviour |
|-------------|-----------|
| `404` | Silent skip (warmup not configured) |
| `429` | Retry with backoff: 5s → 15s → 45s → 90s (4 attempts total) |
| `500/502/503/504` | Same retry as 429 |
| Other 4xx/5xx | Logged as error, returns `None` |

Retry logic lives in `modules/smartlead_client.py:sl_get()`.  
`smartlead_health.py` uses its own inline `_get()` method with a single attempt (no retry) — worth unifying if rate limits become an issue.

---

## Response Envelope Variations

Smartlead's API is inconsistent across endpoints. The project handles these shapes:

| Shape | Example |
|-------|---------|
| Bare list | `[{...}, {...}]` |
| `data` list | `{"data": [{...}]}` |
| `data` dict (single item) | `{"data": {...}}` — normalised to `[{...}]` |
| `results` list | `{"results": [{...}]}` |
| `list` list | `{"list": [{...}]}` (campaigns) |
| `email_accounts` list | `{"email_accounts": [{...}]}` |

Normalisation helper: `SmartleadClient._normalise_list()` in `modules/smartlead_health.py`.  
For other modules, inline guards like `data if isinstance(data, list) else data.get("data", [])` are used.

---

## Endpoint Catalog (Full Reference)

All Smartlead API categories — endpoints not yet used by this project are marked accordingly.

### Email Accounts
| Method | Path | Used |
|--------|------|------|
| GET | `/email-accounts/` | ✅ domain_discovery, reconnect_monitor |
| GET | `/email-accounts/{id}` | — |
| POST | `/email-accounts/` | — |
| PUT | `/email-accounts/{id}` | — |
| DELETE | `/email-accounts/{id}` | — |
| GET | `/email-accounts/{id}/warmup-stats` | ✅ warmup_stats |
| POST | `/email-accounts/{id}/warmup-settings` | — |
| GET | `/email-accounts/by-user/{userId}` | — |

### Campaign Management
| Method | Path | Used |
|--------|------|------|
| GET | `/campaigns/` | ✅ campaign_bounce |
| POST | `/campaigns/` | — |
| GET | `/campaigns/{id}` | — |
| PUT | `/campaigns/{id}` | — |
| DELETE | `/campaigns/{id}` | — |
| POST | `/campaigns/{id}/schedule` | — |
| POST | `/campaigns/{id}/pause` | — |
| POST | `/campaigns/{id}/resume` | — |
| GET | `/campaigns/{id}/email-accounts` | — |
| POST | `/campaigns/{id}/email-accounts` | — |
| GET | `/campaigns/{id}/statistics` | ✅ campaign_bounce |

### Lead Management
| Method | Path | Used |
|--------|------|------|
| GET | `/campaigns/{id}/leads` | — |
| POST | `/campaigns/{id}/leads` | — |
| GET | `/campaigns/{id}/leads/{leadId}` | — |
| PUT | `/campaigns/{id}/leads/{leadId}` | — |
| DELETE | `/campaigns/{id}/leads/{leadId}` | — |
| POST | `/campaigns/{id}/leads/import` | — |
| GET | `/leads/` | — |
| GET | `/leads/{id}` | — |
| POST | `/leads/bulk-delete` | — |

### Campaign Statistics
| Method | Path | Used |
|--------|------|------|
| GET | `/campaigns/{id}/statistics` | ✅ campaign_bounce |
| GET | `/campaigns/{id}/lead-statistics` | — |
| GET | `/campaigns/{id}/email-statistics` | — |

### Global Analytics
| Method | Path | Used |
|--------|------|------|
| GET | `/analytics/mailbox/domain-wise-health-metrics` | ✅ smartlead_health, domain_discovery |
| GET | `/analytics/mailbox/name-wise-health-metrics` | ✅ smartlead_health |
| GET | `/analytics/mailbox/overall-stats` | ✅ smartlead_health (fetched, not stored) |
| GET | `/analytics/mailbox/client-wise-health-metrics` | — |

### Smart Delivery
| Method | Path | Used |
|--------|------|------|
| GET | `/smart-delivery/` | — |
| POST | `/smart-delivery/` | — |
| PUT | `/smart-delivery/{id}` | — |

### Webhooks
| Method | Path | Used |
|--------|------|------|
| GET | `/webhooks/` | — |
| POST | `/webhooks/` | — |
| PUT | `/webhooks/{id}` | — |
| DELETE | `/webhooks/{id}` | — |

### Master Inbox
| Method | Path | Used |
|--------|------|------|
| GET | `/master-inbox/` | — |
| PUT | `/master-inbox/{id}` | — |

### Client Management
| Method | Path | Used |
|--------|------|------|
| GET | `/clients/` | — |
| POST | `/clients/` | — |
| PUT | `/clients/{id}` | — |

### Smart Senders
| Method | Path | Used |
|--------|------|------|
| GET | `/smart-senders/` | — |
| POST | `/smart-senders/` | — |

### Smart Prospect
| Method | Path | Used |
|--------|------|------|
| GET | `/smart-prospect/lists/` | — |
| POST | `/smart-prospect/lists/` | — |
| GET | `/smart-prospect/leads/` | — |
