// registration.js
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("registrationForm");
  if (!form) return;

  form.addEventListener("submit", function(e) {
    e.preventDefault();

    const email       = document.getElementById("email").value.trim();
    const password    = document.getElementById("password").value.trim();
    const stakeholder = document.getElementById("stakeholder").checked;
    const manager     = document.getElementById("manager").checked;

    // Basic validation
    if (!email || !password) {
      alert("Please fill in all fields.");
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
    if (!emailRegex.test(email)) {
      alert("Please enter a valid email address.");
      return;
    }

    if (password.length < 12) {
      alert("Password must be at least 12 characters long.");
      return;
    }

    if (!stakeholder && !manager) {
      alert("Please select a role to register.");
      return;
    }

    console.log("Email:", email);
    console.log("Password:", password);
    console.log("Roles:", { stakeholder, manager });

    alert("Registration successful!");
    form.reset();
  });
});
