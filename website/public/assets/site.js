// Copy buttons for the quick start code blocks.
document.querySelectorAll('button.copy[data-copy]').forEach((btn) => {
  const label = btn.textContent;
  const done = document.documentElement.lang === 'de' ? 'Kopiert' : 'Copied';
  btn.addEventListener('click', async () => {
    const el = document.getElementById(btn.dataset.copy);
    if (!el) return;
    const text = el.innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.execCommand('copy');
      s.removeAllRanges();
    }
    btn.textContent = done;
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1600);
  });
});
