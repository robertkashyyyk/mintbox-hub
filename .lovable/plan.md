
# External Integrations Management

## Overview
Add a new **Integrations** section within Administration to manage credentials and connection status for external services your system calls out to (Mintsoft, 3D Sellers, etc.). This complements the existing **API Access** page which handles inbound authentication.

## Current vs. Proposed

| Aspect | Current State | Proposed |
|--------|---------------|----------|
| Mintsoft credentials | Backend secret only | UI to view/update + test connection |
| 3D Sellers | Not yet integrated | Full credential management |
| Connection status | No visibility | Live status with last sync time |
| Testing | Manual only | One-click "Test Connection" button |

## What We'll Build

### 1. New Admin Card: "Integrations"
Add to the Administration index page alongside Users, API Access, Billing, etc.

### 2. Integrations Page (`/admin/integrations`)
A dedicated page showing all external service connections with:
- **Mintsoft** - Base URL, API key (masked), connection status, last sync
- **3D Sellers** - API credentials, connection status
- Extensible for future integrations

### 3. Database Table: `integrations`
Stores non-sensitive configuration per integration (base URLs, enabled status). Sensitive credentials remain in backend secrets for security.

```text
┌─────────────────────────────────────────────────────────────────┐
│ integrations                                                     │
├─────────────────────────────────────────────────────────────────┤
│ id (uuid, PK)                                                   │
│ name (text) - "mintsoft", "3dsellers"                           │
│ display_name (text) - "Mintsoft", "3D Sellers"                  │
│ enabled (boolean)                                               │
│ base_url (text, nullable)                                       │
│ config (jsonb) - flexible settings per integration              │
│ last_connected_at (timestamptz, nullable)                       │
│ connection_status (text) - "connected", "error", "not_configured"|
│ error_message (text, nullable)                                  │
│ created_at, updated_at                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Edge Function: `test-integration-connection`
Tests if stored credentials are valid by making a lightweight API call to each service.

### 5. UI Features
- View/edit base URL and non-sensitive config
- See connection status (green/red indicator)
- "Test Connection" button
- Link to backend for managing secrets
- Last connected timestamp

---

## Technical Details

### Files to Create
1. `src/pages/admin/Integrations.tsx` - Main integrations management page
2. `supabase/functions/test-integration-connection/index.ts` - Connection testing

### Files to Modify
1. `src/pages/AdminIndex.tsx` - Add Integrations card
2. `src/App.tsx` - Add route for `/admin/integrations`

### Database Migration
Create `integrations` table with RLS policies restricting to super_users.

Seed with initial integrations:
- Mintsoft (migrate settings from `mintsoft_settings`)
- 3D Sellers (placeholder for configuration)

### Security Considerations
- API keys/secrets remain in backend secrets (not in database)
- RLS restricts table access to super_users only
- Connection testing uses backend secrets via edge function

---

## Mintsoft Migration
Migrate existing `mintsoft_settings.base_url` to the new `integrations` table. The `dispatched_status_ids` can move to the `config` JSONB column.

---

## 3D Sellers Setup
Once implemented, you'll need to:
1. Add the 3D Sellers API key as a backend secret
2. Configure the base URL and settings via the new UI
3. We can then build sync functionality

---

## Outcome
- Single place to manage all external service connections
- Visual status for each integration
- Easy to add new integrations in the future
- Clear separation: API Access (inbound) vs Integrations (outbound)
