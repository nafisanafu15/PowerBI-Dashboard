console.log(' dropdown script loaded');
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready');

  const userProfile = document.querySelector('.user-profile');
  if (!userProfile) {
    console.warn('user-profile not found');
    return;
  }


  // build the UL of button
  const dropdown = document.createElement('ul');
  dropdown.className = 'profile-dropdown';
  dropdown.innerHTML = '<li><a href="#" id="logout-link">Logout</a></li>';
  userProfile.appendChild(dropdown);

  // hook the button
  const toggle = userProfile.querySelector('.dropdown-toggle');
  if (!toggle) {
    console.warn('dropdown-toggle not found');
    return;
  }
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.style.display =
      dropdown.style.display === 'block' ? 'none' : 'block';
  });

  // click anywhere else to closes it
  document.addEventListener('click', () => {
    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
    }
  });

  // logout action 
  document.getElementById('logout-link').addEventListener('click', e => {
    e.preventDefault();
    console.log(' logging out…');
    // window.location.href = '/logout.php';
  });
});
