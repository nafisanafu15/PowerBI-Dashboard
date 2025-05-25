document.addEventListener('DOMContentLoaded', () => {
  const pwdInput = document.getElementById('password');
  const toggleBtn = document.querySelector('.toggle-password');

  if (pwdInput && toggleBtn) {
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

  const form = document.getElementById('registrationForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      const email = document.getElementById('email').value.trim();
      const password = pwdInput.value.trim();
      const roleSelected = document.querySelector('input[name="Role"]:checked');

      if (!email || !password || !roleSelected) {
        alert("All fields are required.");
        e.preventDefault();
        return;
      }

      if (password.length < 12) {
        alert("Password must be at least 12 characters.");
        e.preventDefault();
        return;
      }
    });
  }
});
