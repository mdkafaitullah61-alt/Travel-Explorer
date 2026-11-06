# Travel Explorer

A responsive travel landing page with a Node.js server and a working travel-enquiry form.

## Run locally

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. In this folder, run `npm start`.
3. Open `http://localhost:3000`.

The server binds to `0.0.0.0` by default. Set `PORT` and `HOST` environment variables to change the port or bind address. During development, `npm run dev` restarts the server when files change.

## Backend

- `GET /api/health` returns a basic health status.
- `GET /api/destinations` returns the travel catalog used by the landing page and the booking form.
- `GET /api/enquiries` returns the stored enquiry history for staff/admin use.
- `POST /api/enquiries` validates and stores an enquiry, then returns a confirmation.
- Enquiries are appended to `data/enquiries.jsonl`, which is excluded from version control.
- Destination mock data is stored in `data/destinations.json` to keep the catalog easy to edit.
- The API applies field validation, a request-size limit, basic in-memory rate limiting, and security headers.
- `npm test` runs the built-in Node.js API tests without installing dependencies.

This project is now structured as a full-stack travel app foundation with a database-ready API layer and dynamic content loading. For a production MERN deployment, swap the JSON-backed store for MongoDB via `MONGODB_URI`, add authentication, and serve a React frontend from a separate client app.

The JSON Lines file and in-memory rate limiter are appropriate for a local starter, not a multi-instance production service. Before accepting real customer data, use a managed database, durable distributed rate limiting, HTTPS at the hosting layer, access-controlled staff tooling, an email notification provider, and a published privacy/retention policy. The site does not currently take payments or make bookings.
