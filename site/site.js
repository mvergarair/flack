// Screen tabs: swap the light/dark screenshots and the alt text.
const base = document.documentElement.dataset.assets || 'assets/';
document.querySelectorAll('[data-shot]').forEach((tab) =>
  tab.addEventListener('click', () => {
    const shot = tab.dataset.shot;
    document.querySelectorAll('[data-shot]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    const pic = document.getElementById('screen');
    pic.querySelector('source').srcset = `${base}${shot}-desktop-dark.png`;
    const img = pic.querySelector('img');
    img.src = `${base}${shot}-desktop-light.png`;
    img.alt = tab.dataset.alt || '';
  }),
);

// Copy buttons on code blocks.
document.querySelectorAll('.copy').forEach((button) =>
  button.addEventListener('click', async () => {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(button.previousElementSibling.textContent);
      button.textContent = button.dataset.copied || 'Copied';
      setTimeout(() => (button.textContent = label), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context): leave the text selectable.
    }
  }),
);
