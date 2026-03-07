# WhatsApp Flows Integration: Current State & Context

This document provides context for the ongoing implementation of WhatsApp Flows for task management within the Boldo AI application. It details what has been successfully built and verified, the architectural decisions made, and the remaining features to be implemented.

## What Has Been Completed

We have successfully established the foundational, secure infrastructure required by Meta for WhatsApp Flows. The endpoint is live, verified, and passing Meta's Health Checks.

### 1. Security & Encryption (`lib/whatsapp-flows/crypto.ts`)
We implemented the full cryptographic suite required by WhatsApp Flows:
- **RSA Key Handling:** We transitioned to using `node-forge` for RSA decryption. This was crucial to bypass strict OpenSSL formatting requirements in Vercel's serverless environment, ensuring robust private key parsing (`ERR_OSSL_UNSUPPORTED` bypass).
- **Endpoint Verification:** Implemented the `signChallenge` function using the RSA private key to pass Meta's updated "Sign public key" UI challenge.
- **Payload Decryption (`decryptRequest`):** Successfully decrypts incoming requests using `node-forge` for the AES key (RSA-OAEP with SHA-256 for both main hash and MGF1 hash), and Node's native `crypto` for the AES-128-GCM flow data decryption.
- **Payload Encryption (`encryptResponse`):** Successfully encrypts outgoing responses using AES-128-GCM, specifically matching Meta's NodeJS Express specifications for flipping the Initialization Vector (`~pair[1]` logic mapping).

### 2. API Endpoint (`app/api/whatsapp-flows/endpoint/route.ts`)
- The endpoint is active and handles the initial `ping` action from Meta's Health Check successfully.
- It intercepts plain text and JSON-based challenges for dynamic endpoint verification.
- It decrypts the flow payload and encrypts the response `data: { status: "active" }`.

### 3. Meta Business Manager Configuration
- **Public Key Upload:** Successfully automated and uploaded `flow_public.pem` to the Meta Graph API.
- **Endpoint Configuration:** Successfully configured the endpoint URI in Meta Business Manager.
- **Health Check:** The "Run health check" button successfully pings our Vercel deployment, decrypts our response, and shows a green success state.

---

## Remaining Implementation Steps

The next phase is to build the actual Flow JSON (the frontend UI rendered in WhatsApp) and the screen handlers (the backend logic that populates data and processes actions).

### Phase 3: Screen Handlers & Queries (Backend)
The backend needs to handle specific screen routing within the endpoint based on the decrypted payload.

1. **Query Functions (`lib/whatsapp-flows/task-queries.ts`)**
   - Implement queries utilizing the existing dashboard logic to fetch tasks for 7 distinct views: 
     - Today's Tasks (Assigned to Me)
     - Today's Tasks (Owned by Me)
     - Action Required (from me)
     - Pending Action (from others)
     - Overdue Tasks
     - To-dos
     - Future Tasks
   - Implement the employee search query for the "Edit Person" flow.

2. **Screen Logic (`lib/whatsapp-flows/screens.ts`)**
   - **Screen 1 (Dashboard Dropdown):** Serve the initial data for the view selector.
   - **Screen 2 (Task List):** Return the array of tasks formatted for a RadioButtonsGroup based on the selected view.
   - **Screen 3 (Task Detail & Actions):** Return available actions based on user role (edit deadline, mark complete, edit person, delete, reject).
   - **Action Execution:** Implement mutations to the database when a user completes an action in the Flow.

### Phase 4: Integration
1. **Webhook Trigger (`app/api/webhook/whatsapp/route.ts`)**
   - Modify the main WhatsApp webhook to detect the trigger word `"list"`.
   - Send the Flow message template to the user when triggered.

2. **Flow JSON Setup**
   - Write the `WhatsApp Flow JSON` defining the 3 screens and submit it via the WhatsApp Manager Builder.

## Feature Mapping Reference
| Web App Feature | WhatsApp Flows Implementation |
|---|---|
| Trigger dashboard | User sends `"list"` to the bot |
| Dashboard filters (all 7) | Initial screen dropdown connects to our endpoint |
| Task actions | Actions dynamically shown based on `getAvailableActions()` |
| Edit deadline / Accept | WhatsApp native `DatePicker` component |
| Mark completed | Action button triggers backend state update |
| Delete task | Complete action -> Confirmation screen |
| Edit person | `TextInput` search -> filters a `RadioButtonsGroup` via API |
