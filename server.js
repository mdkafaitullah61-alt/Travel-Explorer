require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { appendFile, mkdir, readFile } = require("node:fs/promises");
const bcrypt = require("bcryptjs");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const http = require("node:http");
const path = require("node:path");
const Destination = require("./models/Destination");
const Enquiry = require("./models/Enquiry");
const User = require("./models/User");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_DESTINATIONS = [
  { id: "bali", name: "Bali, Indonesia", tag: "Island life", image: "/images/1.jpg" },
  { id: "italy", name: "The Italian coast", tag: "Slow days", image: "/images/2.jpg" },
  { id: "mountains", name: "The mountains", tag: "Wild & free", image: "/images/3.jpg" },
];
const MAX_BODY_BYTES = 10 * 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is missing in environment variables");
}
const userStore = new Map();

function isMongoEnabled() {
  return process.env.USE_MONGODB === "true" || process.env.USE_MONGODB === "1";
}

function validateSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Please send a valid enquiry." };
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const destination =
    typeof input.destination === "string" ? input.destination.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";

  if (name.length < 2 || name.length > 100) {
    return { error: "Name must be between 2 and 100 characters." };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (phone.length > 30 || (phone && !/^[+()\d.\-\s]+$/.test(phone))) {
    return { error: "Enter a valid phone number." };
  }
  if (destination.length > 100) {
    return { error: "Destination must be 100 characters or fewer." };
  }
  if (message.length < 10 || message.length > 2000) {
    return { error: "Message must be between 10 and 2,000 characters." };
  }

  return { submission: { name, email, phone, destination, message } };
}

async function connectMongo() {
  if (!isMongoEnabled() || !process.env.MONGODB_URI) {
    return false;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log("Connected to MongoDB");
    return true;
  } catch (error) {
    console.warn("MongoDB connection failed, using file storage fallback:", error.message);
    return false;
  }
}

async function ensureDefaultDestinations() {
  if (!isMongoEnabled() || mongoose.connection.readyState !== 1) {
    return;
  }

  const count = await Destination.countDocuments();
  if (count === 0) {
    await Destination.insertMany(DEFAULT_DESTINATIONS);
  }
}

async function readStoredEnquiries(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return lines;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readDestinationCatalog(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : DEFAULT_DESTINATIONS;
  } catch {
    return DEFAULT_DESTINATIONS;
  }
}

async function getDestinations(filePath) {
  if (isMongoEnabled() && mongoose.connection.readyState === 1) {
    try {
      await ensureDefaultDestinations();
      const records = await Destination.find().sort({ createdAt: 1 }).lean();
      if (records.length) {
        return records.map((item) => ({
          id: item.id,
          name: item.name,
          tag: item.tag,
          image: item.image,
        }));
      }
    } catch (error) {
      console.warn("Failed to fetch destinations from MongoDB:", error.message);
    }
  }
  return readDestinationCatalog(filePath);
}

async function getEnquiries(filePath) {
  if (isMongoEnabled() && mongoose.connection.readyState === 1) {
    try {
      const records = await Enquiry.find().sort({ createdAt: 1 }).lean();
      return records.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        phone: item.phone,
        destination: item.destination,
        message: item.message,
        createdAt: item.createdAt,
      }));
    } catch (error) {
      console.warn("Failed to fetch enquiries from MongoDB:", error.message);
    }
  }
  return readStoredEnquiries(filePath);
}

async function saveEnquiryToStorage(enquiry, filePath, queue) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const writeTask = queue.then(() =>
    appendFile(filePath, `${JSON.stringify(enquiry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
  );
  return writeTask;
}

async function saveEnquiry(enquiry, filePath, queue) {
  const finalEnquiry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...enquiry,
  };

  if (isMongoEnabled() && mongoose.connection.readyState === 1) {
    try {
      const created = await Enquiry.create({
        ...enquiry,
        id: finalEnquiry.id,
      });
      finalEnquiry.createdAt = created.createdAt || finalEnquiry.createdAt;
      finalEnquiry.id = created.id || finalEnquiry.id;
      return {
        ...finalEnquiry,
        ...created.toObject(),
      };
    } catch (error) {
      console.warn("MongoDB enquiry save failed, fallback to file storage:", error.message);
    }
  }

  const writeTask = saveEnquiryToStorage(finalEnquiry, filePath, queue);
  await writeTask;
  return finalEnquiry;
}

async function ensureDataDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

function createToken(user) {
  return jwt.sign({ id: user.id || user._id?.toString?.(), email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function serializeUser(user) {
  return {
    id: user.id || user._id?.toString?.(),
    name: user.name,
    email: user.email,
  };
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (isMongoEnabled() && mongoose.connection.readyState === 1) {
    return User.findOne({ email: normalizedEmail }).lean();
  }

  return userStore.get(normalizedEmail) || null;
}

async function createUserRecord({ name, email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (isMongoEnabled() && mongoose.connection.readyState === 1) {
    const created = await User.create({
      id: randomUUID(),
      name,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
    });

    return { ...created.toObject(), id: created.id || created._id.toString() };
  }

  const record = {
    id: randomUUID(),
    name,
    email: normalizedEmail,
    password: await bcrypt.hash(password, 10),
  };
  userStore.set(normalizedEmail, record);
  return record;
}

async function authenticateUser(email, password) {
  const user = await findUserByEmail(email);
  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return null;
  }

  return user;
}

async function requireAuth(request, response, next) {
  const authHeader = request.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return response.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserByEmail(payload.email);
    if (!user) {
      return response.status(401).json({ error: "Authentication failed." });
    }
    request.user = serializeUser(user);
    return next();
  } catch (error) {
    return response.status(401).json({ error: "Invalid or expired token." });
  }
}

function createServer(options = {}) {
  const app = express();
  const dataDirectory = options.dataDirectory || DATA_DIR;
  const submissionsFile = path.join(dataDirectory, "enquiries.jsonl");
  const destinationsFile = path.join(dataDirectory, "destinations.json");
  const requestCounts = new Map();
  let writeQueue = Promise.resolve();

  const mongoReady = connectMongo();

  app.disable("x-powered-by");
  const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://localhost:5174,http://localhost:5175")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
    }),
  );
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "10kb" }));

  app.get("/api/health", async (request, response) => {
    await mongoReady.catch(() => {});
    response.json({ status: "ok" });
  });

  app.post("/api/auth/register", async (request, response) => {
    const { name, email, password } = request.body || {};

    if (!name || !email || !password) {
      return response.status(400).json({ error: "Name, email, and password are required." });
    }

    if (String(password).length < 6) {
      return response.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return response.status(409).json({ error: "User already exists." });
    }

    try {
      const user = await createUserRecord({ name, email, password });
      const token = createToken(user);
      return response.status(201).json({
        token,
        user: serializeUser(user),
      });
    } catch (error) {
      return response.status(500).json({ error: "Unable to create account." });
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return response.status(400).json({ error: "Email and password are required." });
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return response.status(401).json({ error: "Invalid email or password." });
    }

    const token = createToken(user);
    return response.json({
      token,
      user: serializeUser(user),
    });
  });

  app.get("/api/destinations", async (request, response) => {
    const destinations = await getDestinations(destinationsFile);
    response.json(destinations);
  });

  app.get("/api/enquiries", async (request, response) => {
    const enquiries = await getEnquiries(submissionsFile);
    response.json(enquiries);
  });

  app.get("/api/admin/destinations", requireAuth, async (request, response) => {
    const destinations = await getDestinations(destinationsFile);
    response.json(destinations);
  });

  app.get("/api/admin/enquiries", requireAuth, async (request, response) => {
    const enquiries = await getEnquiries(submissionsFile);
    response.json(enquiries);
  });

  app.post("/api/admin/destinations", requireAuth, async (request, response) => {
    const { id, name, tag, image } = request.body || {};

    if (!id || !name || !tag || !image) {
      return response.status(400).json({
        error: "Destination requires id, name, tag, and image.",
      });
    }

    if (isMongoEnabled() && mongoose.connection.readyState === 1) {
      try {
        const destination = await Destination.findOneAndUpdate(
          { id },
          { id, name, tag, image },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        return response.status(201).json(destination.toObject());
      } catch (error) {
        console.warn("Destination admin save failed:", error.message);
      }
    }

    try {
      const list = await readDestinationCatalog(destinationsFile);
      const records = list.filter((item) => item.id !== id);
      records.push({ id, name, tag, image });
      await mkdir(dataDirectory, { recursive: true });
      await require("node:fs/promises").writeFile(destinationsFile, JSON.stringify(records, null, 2));
      return response.status(201).json({ id, name, tag, image });
    } catch (error) {
      console.error("Failed to persist destination:", error);
      return response.status(500).json({ error: "Could not save destination." });
    }
  });

  app.post("/api/enquiries", async (request, response) => {
    const now = Date.now();
    const clientAddress = request.ip || request.socket.remoteAddress || "unknown";
    const recentRequests = (requestCounts.get(clientAddress) || []).filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
    );

    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
      requestCounts.set(clientAddress, recentRequests);
      return response.status(429).json({
        error: "Too many enquiries. Please try again later.",
      });
    }

    recentRequests.push(now);
    requestCounts.set(clientAddress, recentRequests);

    if (!request.is("application/json")) {
      return response.status(415).json({
        error: "Content-Type must be application/json.",
      });
    }

    if (request.body === undefined || request.body === null || typeof request.body !== "object") {
      return response.status(400).json({ error: "Please send a valid enquiry." });
    }

    const validation = validateSubmission(request.body);
    if (validation.error) {
      return response.status(400).json({ error: validation.error });
    }

    const enquiryData = validation.submission;
    try {
      await ensureDataDirectory(dataDirectory);
      const saved = await saveEnquiry(enquiryData, submissionsFile, writeQueue);
      writeQueue = Promise.resolve(saved).catch(() => {});
      return response.status(201).json({
        message: "Thanks! Your enquiry has been received.",
        id: saved.id,
      });
    } catch (error) {
      console.error("Failed to save enquiry:", error);
      return response.status(500).json({
        error: "We couldn't save your enquiry. Please try again.",
      });
    }
  });

  app.get("/", (request, response) => {
    response.sendFile(path.join(ROOT, "index.html"));
  });
  app.get("/style.css", (request, response) => {
    response.sendFile(path.join(ROOT, "style.css"));
  });
  app.get("/script.js", (request, response) => {
    response.sendFile(path.join(ROOT, "script.js"));
  });
  app.use("/images", express.static(path.join(ROOT, "images")));

  app.use((request, response) => {
    response.status(404).json({ error: "Not found." });
  });

  return http.createServer(app);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  const server = createServer();

  server.on("error", (error) => {
    console.error("Server failed to start:", error);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`Travel Explorer is running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
