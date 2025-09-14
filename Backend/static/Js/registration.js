// Handle user registration form interactions
document.addEventListener('DOMContentLoaded', () => {
  const pwdInput = document.getElementById('password');
  const toggleBtn = document.querySelector('.toggle-password');

  if (pwdInput && toggleBtn) {
    // Toggle between masked and visible password
    toggleBtn.addEventListener('click', () => {
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        toggleBtn.textContent = 'Hide';
      } else {
        pwdInput.type = 'password';
        toggleBtn.textContent = 'Show';
      }
    });
  }

  document.getElementById('registrationForm').addEventListener('submit', function (e) {
    // Basic client-side validation for registration data
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const leader = document.getElementById('leader').checked;
    const manager = document.getElementById('manager').checked;

    if (!email || !password) {
      e.preventDefault();
      alert('Please fill in all fields.');
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
    if (!emailRegex.test(email)) {
      e.preventDefault();
      alert('Please enter a valid email address.');
      return;
    }

    if (password.length < 12) {
      e.preventDefault();
      alert('Password must be at least 12 characters long.');
      return;
    }

    if (!leader && !manager) {
      e.preventDefault();
      alert('Please select a role to register.');
      return;
    }
  });
});

