// Toggle password visibility on the login page
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
});

