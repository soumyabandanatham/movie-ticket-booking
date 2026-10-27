const movies = [
  { name: "Leo", price: 150, genre: "Action" },
  { name: "Pushpa 2", price: 180, genre: "Action" },
  { name: "Kalki 2898 AD", price: 200, genre: "Sci-Fi" },
  { name: "Devara: Part 1", price: 180, genre: "Action" },
  { name: "Hanu-Man", price: 150, genre: "Fantasy" },
  { name: "Lucky Baskhar", price: 160, genre: "Drama" },
  { name: "Tillu Square", price: 150, genre: "Comedy" },
  { name: "Game Changer", price: 180, genre: "Action" },
  { name: "Mirai", price: 170, genre: "Fantasy" },
  { name: "HIT: The 3rd Case", price: 190, genre: "Thriller" }
];

// HTML elements
const movieSelect = document.getElementById("movie");
const timeSelect = document.getElementById("showTime");
const ticketCount = document.getElementById("tickets");
const totalAmount = document.getElementById("total");
const bookingForm = document.getElementById("bookingForm");
const message = document.getElementById("message");

const seatGrid = document.getElementById("seatGrid");
const seatSummary = document.getElementById("seatSummary");
const seatMessage = document.getElementById("seatMessage");

const movieSearch = document.getElementById("movieSearch");
const genreFilter = document.getElementById("genreFilter");
const priceFilter = document.getElementById("priceFilter");
const clearFilters = document.getElementById("clearFilters");
const movieCount = document.getElementById("movieCount");

// Digital ticket elements
const digitalTicket = document.getElementById("digitalTicket");
const printTicketButton = document.getElementById("printTicket");

let selectedSeats = [];
let bookedSeats = [];
let seatRequestNumber = 0;

// Create 40 seats: A1 to E8
const allSeats = [];

for (const row of ["A", "B", "C", "D", "E"]) {
  for (let number = 1; number <= 8; number++) {
    allSeats.push(`${row}${number}`);
  }
}

// Update ticket count and total price
function updateTotal() {
  const selectedMovie = movies.find(
    movie => movie.name === movieSelect.value
  );

  const count = selectedSeats.length;
  ticketCount.value = count;

  totalAmount.textContent = selectedMovie
    ? `₹${selectedMovie.price * count}`
    : "₹0";

  seatSummary.textContent = selectedSeats.length
    ? `Selected seats: ${selectedSeats.join(", ")}`
    : "Selected seats: None";
}

// Search and filter movies
function filterMovies() {
  const searchText = movieSearch.value.trim().toLowerCase();
  const selectedGenre = genreFilter.value;
  const selectedPrice = priceFilter.value;

  const movieCards = document.querySelectorAll(".movie");
  let visibleCount = 0;

  movieCards.forEach(card => {
    const name =
      card.dataset.name ||
      card.querySelector("h3")?.textContent.trim() ||
      "";

    const genre =
      card.dataset.genre ||
      card.querySelector("p")?.textContent ||
      "";

    const price =
      card.dataset.price ||
      card.querySelector(".price")?.textContent.match(/\d+/)?.[0] ||
      "";

    const matchesSearch = name.toLowerCase().includes(searchText);

    const matchesGenre =
      selectedGenre === "all" ||
      genre.toLowerCase().includes(selectedGenre.toLowerCase());

    const matchesPrice =
      selectedPrice === "all" ||
      Number(price) === Number(selectedPrice);

    const showCard =
      matchesSearch && matchesGenre && matchesPrice;

    card.classList.toggle("hidden", !showCard);

    if (showCard) {
      visibleCount++;
    }
  });

  movieCount.textContent =
    `Showing ${visibleCount} of ${movieCards.length} movies`;
}

// Clear all filters
clearFilters.addEventListener("click", () => {
  movieSearch.value = "";
  genreFilter.value = "all";
  priceFilter.value = "all";
  filterMovies();
});

movieSearch.addEventListener("input", filterMovies);
genreFilter.addEventListener("change", filterMovies);
priceFilter.addEventListener("change", filterMovies);

// Display seats
function renderSeats() {
  seatGrid.replaceChildren();

  for (const seat of allSeats) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "seat";
    button.textContent = seat;

    if (bookedSeats.includes(seat)) {
      button.classList.add("booked");
      button.disabled = true;
      button.title = "Already booked";
      button.setAttribute("aria-pressed", "false");
    } else if (selectedSeats.includes(seat)) {
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.addEventListener("click", () => toggleSeat(seat));
    seatGrid.appendChild(button);
  }
}

// Select or deselect a seat
function toggleSeat(seat) {
  seatMessage.textContent = "";

  if (bookedSeats.includes(seat)) {
    seatMessage.textContent = "This seat is already booked.";
    return;
  }

  if (selectedSeats.includes(seat)) {
    selectedSeats = selectedSeats.filter(item => item !== seat);
  } else {
    if (selectedSeats.length >= 10) {
      seatMessage.textContent = "You can select a maximum of 10 seats.";
      return;
    }

    selectedSeats.push(seat);
  }

  renderSeats();
  updateTotal();
}

// Load seats already booked for this movie and show
async function loadBookedSeats() {
  const requestNumber = ++seatRequestNumber;

  selectedSeats = [];
  bookedSeats = [];

  renderSeats();
  updateTotal();

  seatMessage.textContent = "Checking seat availability...";

  const params = new URLSearchParams({
    movie: movieSelect.value,
    showTime: timeSelect.value
  });

  try {
    const response = await fetch(`/api/booked-seats?${params}`);
    const result = await response.json();

    if (requestNumber !== seatRequestNumber) {
      return;
    }

    if (!response.ok) {
      throw new Error(result.message || "Could not load seats.");
    }

    bookedSeats = result.bookedSeats || [];

    renderSeats();
    seatMessage.textContent = "Seat availability updated.";
  } catch (error) {
    if (requestNumber !== seatRequestNumber) {
      return;
    }

    console.error("Seat loading error:", error);

    seatMessage.textContent =
      "Seats could not be loaded. Check the server and try again.";
  }
}

// Click Book Now on a movie card
function chooseMovie(movieName) {
  movieSelect.value = movieName;

  updateTotal();
  loadBookedSeats();

  document.getElementById("booking").scrollIntoView({
    behavior: "smooth"
  });
}

// Make chooseMovie available to HTML buttons
window.chooseMovie = chooseMovie;

// Reload seats when movie or show time changes
movieSelect.addEventListener("change", loadBookedSeats);
timeSelect.addEventListener("change", loadBookedSeats);

// Display digital ticket after successful booking
function displayDigitalTicket(booking, result) {
  document.getElementById("ticketBookingId").textContent =
    result.bookingId ?? "Not provided";

  document.getElementById("ticketCustomer").textContent =
    booking.customerName;

  document.getElementById("ticketMovie").textContent =
    booking.movie;

  document.getElementById("ticketShowTime").textContent =
    booking.showTime;

  document.getElementById("ticketSeats").textContent =
    booking.seats.join(", ");

  document.getElementById("ticketCount").textContent =
    booking.tickets;

  const movie = movies.find(item => item.name === booking.movie);
  const total = Number.isFinite(Number(result.totalAmount))
    ? Number(result.totalAmount)
    : (movie ? movie.price * booking.tickets : 0);

  document.getElementById("ticketTotal").textContent = `₹${total}`;

  digitalTicket.hidden = false;
  digitalTicket.scrollIntoView({ behavior: "smooth" });
}

// Print digital ticket
printTicketButton.addEventListener("click", () => {
  window.print();
});

// Save booking to the server
bookingForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  message.textContent = "";

  // Hide the previous ticket until this booking succeeds
  digitalTicket.hidden = true;

  const customerName =
    document.getElementById("customerName").value.trim();

  const booking = {
    customerName,
    movie: movieSelect.value,
    showTime: timeSelect.value,
    tickets: selectedSeats.length,
    seats: [...selectedSeats]
  };

  if (!booking.customerName) {
    message.textContent = "Please enter your name.";
    return;
  }

  if (!movies.some(movie => movie.name === booking.movie)) {
    message.textContent = "Please select a valid movie.";
    return;
  }

  if (!booking.tickets) {
    message.textContent = "Please select at least one seat.";
    return;
  }

  if (booking.tickets > 10) {
    message.textContent = "You can book a maximum of 10 seats.";
    return;
  }

  const selectedMovie = movies.find(
    movie => movie.name === booking.movie
  );

  const expectedTotal = selectedMovie.price * booking.tickets;

  message.textContent = "Booking in progress...";

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(booking)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Booking failed.");
    }

    // Display confirmation and digital ticket
    message.textContent =
      `Booking confirmed! Booking ID: ${result.bookingId ?? "Not provided"}`;

    displayDigitalTicket(
      booking,
      {
        ...result,
        totalAmount: result.totalAmount ?? expectedTotal
      }
    );

    // Clear selected seats after booking succeeds
    selectedSeats = [];

    // Keep the selected movie and show time for refreshed seat availability
    updateTotal();
    await loadBookedSeats();

    // Keep the confirmed ticket visible after seats reload
    digitalTicket.hidden = false;

  } catch (error) {
    console.error("Booking error:", error);

    message.textContent =
      "Booking failed: " + error.message;
  }
});

// Initial setup
filterMovies();
updateTotal();
renderSeats();
loadBookedSeats();