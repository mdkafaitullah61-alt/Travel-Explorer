const enquiryForm = document.querySelector("#enquiry-form");
const formStatus = document.querySelector("#form-status");
const submitButton = document.querySelector("#submit-button");
const destinationInput = document.querySelector("#destination-input");
const destinationGrid = document.querySelector(".destination-grid");

document.querySelector("#current-year").textContent = new Date().getFullYear();

async function loadDestinations() {
  if (!destinationGrid) {
    return;
  }

  try {
    const response = await fetch("/api/destinations");
    if (!response.ok) {
      throw new Error("Unable to load destinations.");
    }

    const destinations = await response.json();
    if (!Array.isArray(destinations) || destinations.length === 0) {
      return;
    }

    destinationGrid.innerHTML = destinations
      .map((destination, index) => {
        const isTall = index === 0 ? "destination-tall" : "";
        return `
          <a class="destination-card ${isTall}" href="#contact" data-destination="${destination.name}">
            <img src="${destination.image}" alt="${destination.name}" loading="lazy">
            <span class="destination-number">${String(index + 1).padStart(2, "0")} / ${destination.tag.toUpperCase()}</span>
            <span class="destination-name">${destination.name} <span aria-hidden="true">↗</span></span>
          </a>
        `;
      })
      .join("");

    destinationGrid.querySelectorAll("[data-destination]").forEach((destinationLink) => {
      destinationLink.addEventListener("click", () => {
        destinationInput.value = destinationLink.dataset.destination;
      });
    });
  } catch (error) {
    console.error(error);
  }
}

document.querySelectorAll("[data-destination]").forEach((destinationLink) => {
  destinationLink.addEventListener("click", () => {
    destinationInput.value = destinationLink.dataset.destination;
  });
});

loadDestinations();

enquiryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "";
  formStatus.classList.remove("is-error");
  submitButton.disabled = true;
  submitButton.textContent = "Sending...";

  const formValues = new FormData(enquiryForm);
  const enquiry = Object.fromEntries(formValues.entries());

  try {
    const response = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enquiry),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "We couldn't send your enquiry. Please try again.");
    }

    formStatus.textContent = result.message;
    enquiryForm.reset();
  } catch (error) {
    formStatus.textContent =
      error instanceof TypeError
        ? "We couldn't reach the server. Check your connection and try again."
        : error.message;
    formStatus.classList.add("is-error");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Send your enquiry <span aria-hidden="true">↗</span>';
  }
});
