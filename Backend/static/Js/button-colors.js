// Applies a consistent brand color to all buttons using the theme variables.
document.addEventListener('DOMContentLoaded', () => {
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue('--color-primary').trim() || '#6290C3';
  const textColor = style.getPropertyValue('--color-bg').trim() || '#F4F1DE';
  document.querySelectorAll('button, [class*="btn"]').forEach(btn => {
    btn.style.backgroundColor = color;
    btn.style.borderColor = color;
    btn.style.color = textColor;
  });
});
