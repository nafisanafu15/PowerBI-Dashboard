document.getElementById("registrationForm").addEventListener("submit", function (e) {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const leader = document.getElementById("leader").checked;
  const manager = document.getElementById("manager").checked;

  // Basic validation for email and password
  if (!email || !password) {
    e.preventDefault();
    alert("Please fill in all fields.");
    return;
  }

  // Regex for basic email validation
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
  if (!emailRegex.test(email)) {
    e.preventDefault();
    alert("Please enter a valid email address.");
    return;
  }

  // Password Strength validation (at least 12 characters)
  if (password.length < 12) {
    e.preventDefault();
    alert("Password must be at least 12 characters long.");
    return;
  }

  if (!leader && !manager) {
    e.preventDefault();
    alert("Please select a role to register.");
    return;
  }

  // Displaying the collected data
  console.log("Email:", email);
  console.log("Password:", password);
  console.log("Roles:", { leader, manager });
  // Allow the form to submit to the server for processing without
  // resetting the fields or showing a premature success message.
});
