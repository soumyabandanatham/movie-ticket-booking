require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

let bookingsCollection = null;
let mongoReady = false;

// Movie prices
const prices = {
  "Leo": 150,
  "Pushpa 2": 180,
  "Kalki 2898 AD": 200
};

const showTimes = [
  "10:00 AM",
  "2:00 PM",
  "6:00 PM",
  "9:00 PM"
];

// Valid seats: A1-E8
const validSeats = [];

for (const row of ["A", "B", "C", "D", "E"]) {
  for (let number = 1; number <= 8; number++) {
    validSeats.push(`${row}${number}`);
  }
}

app.use(express.static(__dirname));
app.use(express.json({ limit: "20kb" }));

app.use(session({
  name: "admin.sid",
  secret: SESSION_SECRET || "temporary-secret-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 60 * 1000
  }
}));

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const first = Buffer.from(a);
  const second = Buffer.from(b);

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function requireAdmin(req, res, next) {
  res.set("Cache-Control", "no-store");

  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    message: "Admin login required."
  });
}

function requireDatabase(req, res, next) {
  if (!mongoReady || !bookingsCollection) {
    return res.status(503).json({
      message: "Database is temporarily unavailable. Please try again later."
    });
  }

  next();
}

// Health check — Render can check that the web server is running
app.get("/health", (req, res) => {
  res.status(200).json({
    server: "running",
    database: mongoReady ? "connected" : "unavailable"
  });
});

// Public home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Admin dashboard page
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Admin login
app.post("/api/admin/login", (req, res, next) => {
  const { username, password } = req.body || {};

  if (
    !safeEqual(username, ADMIN_USERNAME) ||
    !safeEqual(password, ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      message: "Invalid admin username or password."
    });
  }

  req.session.regenerate((error) => {
    if (error) return next(error);

    req.session.isAdmin = true;

    req.session.save((saveError) => {
      if (saveError) return next(saveError);

      res.json({ message: "Admin login successful." });
    });
  });
});

// Check admin session
app.get("/api/admin/session", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    loggedIn: req.session?.isAdmin === true
  });
});

// Admin logout
app.post("/api/admin/logout", requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("admin.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.json({ message: "Logged out successfully." });
  });
});

// Get booked seats
app.get(
  "/api/booked-seats",
  requireDatabase,
  async (req, res) => {
    try {
      const { movie, showTime } = req.query;

      if (
        !Object.hasOwn(prices, movie) ||
        !showTimes.includes(showTime)
      ) {
        return res.status(400).json({
          message: "Invalid movie or show time."
        });
      }

      const bookings = await bookingsCollection
        .find({
          movie,
          showTime,
          status: { $ne: "Cancelled" }
        })
        .project({ seats: 1 })
        .toArray();

      const bookedSeats = [
        ...new Set(
          bookings.flatMap((booking) =>
            Array.isArray(booking.seats) ? booking.seats : []
          )
        )
      ];

      res.json({ bookedSeats });
    } catch (error) {
      console.error("Load seats error:", error.message);
      res.status(500).json({
        message: "Could not load booked seats."
      });
    }
  }
);

// Get all bookings — admin only
app.get(
  "/api/bookings",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const bookings = await bookingsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.json(bookings);
    } catch (error) {
      console.error("Fetch bookings error:", error.message);
      res.status(500).json({
        message: "Could not fetch bookings."
      });
    }
  }
);

// Search booking by ID — admin only
app.get(
  "/api/bookings/:id",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "Invalid Booking ID."
        });
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id)
      });

      if (!booking) {
        return res.status(404).json({
          message: "Booking not found."
        });
      }

      res.json(booking);
    } catch (error) {
      console.error("Search booking error:", error.message);
      res.status(500).json({
        message: "Could not search booking."
      });
    }
  }
);

// Cancel booking — admin only
app.delete(
  "/api/bookings/:id",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "Invalid Booking ID."
        });
      }

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id)
      });

      if (!booking) {
        return res.status(404).json({
          message: "Booking not found."
        });
      }

      if (booking.status === "Cancelled") {
        return res.status(400).json({
          message: "This booking is already cancelled."
        });
      }

      const totalAmount = Number(booking.totalAmount) || 0;
      const refundAmount = Math.round(totalAmount * 0.5);
      const cancellationFee = totalAmount - refundAmount;

      const result = await bookingsCollection.updateOne(
        {
          _id: new ObjectId(id),
          status: { $ne: "Cancelled" }
        },
        {
          $set: {
            status: "Cancelled",
            refundAmount,
            cancellationFee,
            cancelledAt: new Date()
          }
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(400).json({
          message: "Booking could not be cancelled."
        });
      }

      res.json({
        message: "Booking cancelled successfully!",
        bookingId: id,
        totalAmount,
        refundAmount,
        cancellationFee,
        status: "Cancelled",
        refundNote: "Demo refund only. No real money has been transferred."
      });
    } catch (error) {
      console.error("Cancel booking error:", error.message);
      res.status(500).json({
        message: "Could not cancel booking."
      });
    }
  }
);

// Create booking
app.post(
  "/api/bookings",
  requireDatabase,
  async (req, res) => {
    try {
      const {
        customerName,
        movie,
        showTime,
        tickets,
        seats
      } = req.body || {};

      if (
        typeof customerName !== "string" ||
        !customerName.trim() ||
        !Object.hasOwn(prices, movie) ||
        !showTimes.includes(showTime) ||
        !Number.isInteger(tickets) ||
        tickets < 1 ||
        tickets > 10 ||
        !Array.isArray(seats) ||
        seats.length !== tickets ||
        seats.some(
          (seat) =>
            typeof seat !== "string" ||
            !validSeats.includes(seat)
        ) ||
        new Set(seats).size !== seats.length
      ) {
        return res.status(400).json({
          message: "Please check your name, movie, time and selected seats."
        });
      }

      const conflictingBooking = await bookingsCollection.findOne({
        movie,
        showTime,
        status: { $ne: "Cancelled" },
        seats: { $in: seats }
      });

      if (conflictingBooking) {
        return res.status(409).json({
          message: "One or more seats were just booked. Refresh seats and select again."
        });
      }

      const booking = {
        customerName: customerName.trim(),
        movie,
        showTime,
        tickets,
        seats,
        totalAmount: prices[movie] * tickets,
        status: "Confirmed",
        createdAt: new Date()
      };

      const result = await bookingsCollection.insertOne(booking);

      console.log("BOOKING SAVED:", result.insertedId.toString());

      res.status(201).json({
        message: "Booking confirmed!",
        bookingId: result.insertedId.toString(),
        totalAmount: booking.totalAmount,
        status: booking.status,
        seats: booking.seats
      });
    } catch (error) {
      console.error("Booking error:", error.message);
      res.status(500).json({
        message: "Could not save booking."
      });
    }
  }
);

// General error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) return next(error);

  res.status(500).json({
    message: "An internal server error occurred."
  });
});

// Start listening immediately, even if MongoDB is temporarily unavailable
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

// Connect to MongoDB in the background
async function connectDatabase() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is missing from environment variables.");
    return;
  }

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
    console.error("One or more required environment variables are missing.");
    return;
  }

  if (ADMIN_PASSWORD.length < 12 || SESSION_SECRET.length < 32) {
    console.error("Admin password must be at least 12 characters and session secret at least 32 characters.");
    return;
  }

  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });

  try {
    await client.connect();

    const db = client.db("MovieBookingDB");
    bookingsCollection = db.collection("bookings");
    mongoReady = true;

    console.log("MongoDB connected successfully!");
  } catch (error) {
    mongoReady = false;
    console.error("MongoDB connection failed:", error.message);
    console.error("Check Atlas connection string, database user password, and Network Access.");
    await client.close().catch(() => {});
  }
}

connectDatabase();