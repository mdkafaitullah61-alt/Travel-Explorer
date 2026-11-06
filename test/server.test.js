const assert = require("node:assert/strict");
const { once } = require("node:events");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, test } = require("node:test");
const { createServer } = require("../server");

let server;
let dataDirectory;
let baseUrl;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "travel-explorer-test-"));
  server = createServer({ dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
  await rm(dataDirectory, { recursive: true, force: true });
});

test("serves the frontend and health endpoint", async () => {
  const [page, health] = await Promise.all([
    fetch(baseUrl),
    fetch(`${baseUrl}/api/health`),
  ]);

  assert.equal(page.status, 200);
  assert.match(await page.text(), /Find your/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await health.json(), { status: "ok" });
});

test("valid enquiry is acknowledged and persisted", async () => {
  const response = await fetch(`${baseUrl}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Rupa Example",
      email: "rupa@example.com",
      phone: "+1 555 123 4567",
      destination: "Bali, Indonesia",
      message: "We are planning a relaxed week in October.",
    }),
  });
  const result = await response.json();
  const records = (await readFile(path.join(dataDirectory, "enquiries.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(response.status, 201);
  assert.equal(result.message, "Thanks! Your enquiry has been received.");
  assert.equal(records.length, 1);
  assert.equal(records[0].email, "rupa@example.com");
  assert.equal(records[0].destination, "Bali, Indonesia");
  assert.ok(records[0].id);
  assert.ok(records[0].createdAt);
});

test("rejects invalid input and oversized request bodies", async () => {
  const invalid = await fetch(`${baseUrl}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "R",
      email: "not-an-email",
      message: "Too short",
    }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Name must be/);

  const oversized = await new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}/api/enquiries`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": 11 * 1024,
        },
      },
      resolve,
    );
    request.on("error", reject);
    request.end(" ".repeat(11 * 1024));
  });

  assert.equal(oversized.statusCode, 413);
  oversized.resume();
});

test("exposes the destination catalog and enquiry history over the API", async () => {
  const payload = JSON.stringify({
    name: "Rupa Example",
    email: "rupa@example.com",
    phone: "+1 555 123 4567",
    destination: "Bali, Indonesia",
    message: "We are planning a relaxed week in October.",
  });

  await fetch(`${baseUrl}/api/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });

  const destinations = await fetch(`${baseUrl}/api/destinations`);
  const enquiries = await fetch(`${baseUrl}/api/enquiries`);

  assert.equal(destinations.status, 200);
  const destinationsData = await destinations.json();
  assert.ok(Array.isArray(destinationsData));
  assert.ok(destinationsData.some((item) => item.name === "Bali, Indonesia"));

  assert.equal(enquiries.status, 200);
  const enquiriesData = await enquiries.json();
  assert.ok(Array.isArray(enquiriesData));
  assert.ok(enquiriesData.some((item) => item.email === "rupa@example.com"));
});

test("registers users, logs them in, and protects admin endpoints", async () => {
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Admin User",
      email: "admin@example.com",
      password: "secret123",
    }),
  });

  assert.equal(register.status, 201);
  const registration = await register.json();
  assert.ok(registration.token);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "secret123",
    }),
  });

  assert.equal(login.status, 200);
  const loginData = await login.json();
  assert.ok(loginData.token);

  const unauthenticated = await fetch(`${baseUrl}/api/admin/destinations`);
  assert.equal(unauthenticated.status, 401);

  const protectedRequest = await fetch(`${baseUrl}/api/admin/destinations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginData.token}`,
    },
    body: JSON.stringify({
      id: "kyoto",
      name: "Kyoto, Japan",
      tag: "Calm mornings",
      image: "images/4.jpg",
    }),
  });

  const destinationList = await fetch(`${baseUrl}/api/admin/destinations`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  const enquiryList = await fetch(`${baseUrl}/api/admin/enquiries`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });

  assert.equal(protectedRequest.status, 201);
  assert.equal(destinationList.status, 200);
  assert.equal(enquiryList.status, 200);
  const destinationData = await destinationList.json();
  const enquiryData = await enquiryList.json();
  assert.ok(Array.isArray(destinationData));
  assert.ok(Array.isArray(enquiryData));
  assert.ok(destinationData.some((item) => item.name === "Kyoto, Japan"));
});

test("limits repeated submissions and does not expose stored enquiries", async () => {
  const payload = JSON.stringify({
    name: "Rupa Example",
    email: "rupa@example.com",
    message: "We are planning a relaxed week in October.",
  });
  let lastResponse;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastResponse = await fetch(`${baseUrl}/api/enquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  }

  assert.equal(lastResponse.status, 429);
  assert.equal((await fetch(`${baseUrl}/data/enquiries.jsonl`)).status, 404);
});
