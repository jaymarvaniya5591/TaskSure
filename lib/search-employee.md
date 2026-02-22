# Search Employee — Method Reference

> **For AI & Developer Reference**
> This document describes the canonical way to search for employees in the TaskSure app.

## Overview

Employee search is used in several places: header search bar, task creation, subtask creation, and edit-persons modals. There are **two contexts** with different data sets:

| Context | Data Source | Includes Self | Hierarchy Filtered |
|---|---|---|---|
| **Header / Sidebar** | `orgUsers` from `UserContext` | ❌ | ✅ (only equal or lower rank) |
| **Task / Subtask Creation** | `allOrgUsers` from `UserContext` | ✅ | ❌ (all org employees) |

---

## Client-Side: `SearchEmployee` Component

**Location**: `components/dashboard/SearchEmployee.tsx`

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `orgUsers` | `OrgUser[]` | — | The list of users to search through |
| `currentUserId` | `string` | — | ID of the logged-in user |
| `isHeader` | `boolean` | `false` | Compact styling for use in header |
| `includeSelf` | `boolean` | `false` | When `true`, current user appears in results |
| `onSelect` | `(user: OrgUser) => void` | — | Callback fired when a user is selected |

### Usage for AI-Created Tasks

When AI creates tasks, it should search for an employee using the same logic:

```ts
// 1. Fetch all org users via the API
const res = await fetch("/api/users");
const { users } = await res.json();
// Returns: { id, name, avatar_url }[] — all users in the org

// 2. Filter by name (case-insensitive substring match)
const query = "search term";
const matches = users.filter(u =>
    u.name.toLowerCase().includes(query.toLowerCase())
);

// 3. Select the best match
const selectedUser = matches[0]; // or apply more specific logic

// 4. Create the task using the matched user's ID
await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        title: "Task title",
        assigned_to: selectedUser.id,
        // deadline: only set if assigned_to === self (current user)
    }),
});
```

### Key Rules

1. **No hierarchy restriction** — AI and task/subtask creation should search across **all** org employees
2. **Self-assignment** creates a **To-do** (status auto-set to `accepted`)
3. **Deadline** is set by the **assignee**, NOT the creator — only include a deadline if assigning to yourself
4. The `/api/users` endpoint (GET) returns all users in the caller's organization, ordered by name
