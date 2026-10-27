require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(express.static(__dirname));
const PORT = 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

app.use(express.json({ limit: "20kb" }));

// Session middleware
app.use(
  session({
    name: "admin.sid",
    secret: SESSION_SECRET || "invalid-secret-not-for-use",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60 * 1000
    }
  })
);

// Prevent browser caching of private API responses
app.use("/api/admin", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

let bookingsCollection;

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

// Compare credentials without ordinary string comparison
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const first = Buffer.from(a);
  const second = Buffer.from(b);

  return (
    first.length === second.length &&
    crypto.timingSafeEqual(first, second)
  );
}

// Require a valid admin session
function requireAdmin(req, res, next) {
  res.set("Cache-Control", "no-store");

  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    message: "Admin login required."
  });
}

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

  // Regenerate session after successful authentication
  req.session.regenerate((error) => {
    if (error) {
      return next(error);
    }

    req.session.isAdmin = true;

    req.session.save((saveError) => {
      if (saveError) {
        return next(saveError);
      }

      return res.json({
        message: "Admin login successful."
      });
    });
  });
});

// Check whether admin is logged in
app.get("/api/admin/session", (req, res) => {
  res.set("Cache-Control", "no-store");

  return res.json({
    loggedIn: req.session?.isAdmin === true
  });
});

// Admin logout
app.post("/api/admin/logout", requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie("admin.sid", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });

    return res.json({
      message: "Logged out successfully."
    });
  });
});

// Public home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve the dashboard page.
// Booking data APIs are protected separately.
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Get booked seats for a movie and show time
app.get("/api/booked-seats", async (req, res) => {
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

    return res.json({ bookedSeats });
  } catch (error) {
    console.error("Load seats error:", error.message);

    return res.status(500).json({
      message: "Could not load booked seats."
    });
  }
});

// Get all bookings - admin only
app.get("/api/bookings", requireAdmin, async (req, res) => {
  try {
    const bookings = await bookingsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.json(bookings);
  } catch (error) {
    console.error("Fetch bookings error:", error.message);

    return res.status(500).json({
      message: "Could not fetch bookings."
    });
  }
});

// Search booking by ID - admin only
app.get("/api/bookings/:id", requireAdmin, async (req, res) => {
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

    return res.json(booking);
  } catch (error) {
    console.error("Search booking error:", error.message);

    return res.status(500).json({
      message: "Could not search booking."
    });
  }
});

// Cancel booking - admin only; demo refund calculation
app.delete("/api/bookings/:id", requireAdmin, async (req, res) => {
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

    return res.json({
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

    return res.status(500).json({
      message: "Could not cancel booking."
    });
  }
});

// Create booking - public route
app.post("/api/bookings", async (req, res) => {
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

    // Check whether the requested seats are already booked
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

    return res.status(201).json({
      message: "Booking confirmed!",
      bookingId: result.insertedId.toString(),
      totalAmount: booking.totalAmount,
      status: booking.status,
      seats: booking.seats
    });
  } catch (error) {
    console.error("Booking error:", error.message);

    return res.status(500).json({
      message: "Could not save booking."
    });
  }
});

// General error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    message: "An internal server error occurred."
  });
});

// Connect to MongoDB and start server
async function startServer() {
  if (!MONGODB_URI) {
    console.error("MongoDB URI is missing. Check your .env file.");
    process.exitCode = 1;
    return;
  }

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
    console.error(
      "Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET in .env."
    );
    process.exitCode = 1;
    return;
  }

  if (
    ADMIN_PASSWORD.length < 12 ||
    SESSION_SECRET.length < 32
  ) {
    console.error(
      "Use an admin password of at least 12 characters and a session secret of at least 32 characters."
    );
    process.exitCode = 1;
    return;
  }

  if (
    ADMIN_PASSWORD === "ChangeThisToYourOwnStrongPassword123!" ||
    SESSION_SECRET === "UseYourOwnLongRandomSecretHere987654321"
  ) {
    console.error("Replace the example credentials in .env with your own values.");
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();

    const db = client.db("MovieBookingDB");
    bookingsCollection = db.collection("bookings");

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log("MongoDB connected successfully!");
      console.log("Admin login API ready.");
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    await client.close().catch(() => {});
    process.exitCode = 1;
  }
}

startServer();