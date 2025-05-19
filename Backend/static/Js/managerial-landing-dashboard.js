console.log("dropdown script loaded");

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM ready");

  // Find the container
  const userProfile = document.querySelector(".user-profile");
  if (!userProfile) {
    console.warn("user-profile container not found");
    return;
  }

  // Prevent double-appending if you reload the module
  if (!userProfile.querySelector(".profile-dropdown")) {
    // Build & append the dropdown menu
    const dropdown = document.createElement("ul");
    dropdown.className = "profile-dropdown";
    dropdown.innerHTML = /* html */ `
      <li><a href="#" id="logout-link">Logout</a></li>
    `;
    // Hide by default
    dropdown.style.display = "none";
    userProfile.appendChild(dropdown);
  }

  const dropdownMenu = userProfile.querySelector(".profile-dropdown");
  const toggleBtn    = userProfile.querySelector(".dropdown-toggle");

  if (!toggleBtn) {
    console.warn("dropdown-toggle button not found");
    return;
  }

  // Toggle open/closed
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu.style.display =
      dropdownMenu.style.display === "block" ? "none" : "block";
  });

  // Close when clicking outside
  document.addEventListener("click", () => {
    if (dropdownMenu.style.display === "block") {
      dropdownMenu.style.display = "none";
    }
  });

  // Hook logout link
  const logoutLink = dropdownMenu.querySelector("#logout-link");
  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      console.log(" User clicked logout");
      // TODO: window.location.href = "/logout";
    });
  } else {
    console.warn("logout-link not found");
  }
});
