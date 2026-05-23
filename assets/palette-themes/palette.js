/* ============================================================
   Theme and mode switching with localStorage persistence
   ============================================================ */

const MODE_KEY = 'color-mode';
const THEME_KEY = 'color-theme';
const root = document.documentElement;

const TOKENS = [
  'bg', 'bg-accent', 'card', 'ink', 'muted', 'line',
  'accent', 'accent-dark', 'accent-light',
  'success', 'danger', 'warn'
];

function setMode(mode) {
  if (mode === 'system') {
    root.removeAttribute('data-mode');
    localStorage.removeItem(MODE_KEY);
  } else {
    root.setAttribute('data-mode', mode);
    localStorage.setItem(MODE_KEY, mode);
  }
  updateActiveButtons();
  // Wait a frame for color-scheme to apply before re-rendering swatches
  requestAnimationFrame(render);
}

function setTheme(theme) {
  root.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  updateActiveButtons();
  requestAnimationFrame(render);
}

function getCurrentMode() {
  return root.getAttribute('data-mode') || 'system';
}

function getCurrentTheme() {
  return root.getAttribute('data-theme') || 'neutral';
}

function updateActiveButtons() {
  const currentMode = getCurrentMode();
  const currentTheme = getCurrentTheme();

  document.querySelectorAll('[data-set-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.setMode === currentMode);
  });
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.setTheme === currentTheme);
  });
}

/* ============================================================
   Live swatch + CSS export rendering
   ============================================================ */

function rgbToHex(rgb) {
  // Convert "rgb(15, 17, 21)" or "rgba(...)" to "#0f1115"
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return rgb;
  const [r, g, b] = match.map(Number);
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function getResolvedColor(varName) {
  // Create a hidden element, apply the variable, read computed color
  const probe = document.createElement('div');
  probe.style.color = `var(--${varName})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return rgbToHex(computed);
}

function render() {
  const swatchesEl = document.getElementById('swatches');
  const exportEl = document.getElementById('export');

  swatchesEl.innerHTML = '';
  const cssLines = [`[data-theme="${getCurrentTheme()}"] {`];

  TOKENS.forEach(token => {
    const hex = getResolvedColor(token);
    const isCard = token === 'card';

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.innerHTML = `
      <div class="swatch-color" style="background: var(--${token}); ${isCard ? 'border-bottom: 1px solid var(--line);' : ''}"></div>
      <div class="swatch-meta">
        <div class="swatch-name">${token}</div>
        <div class="swatch-hex">${hex}</div>
      </div>
    `;
    swatchesEl.appendChild(swatch);
    cssLines.push(`  --${token}: ${hex};`);
  });

  cssLines.push('}');
  exportEl.textContent = cssLines.join('\n');
}

/* ============================================================
   Wire up controls and initialize
   ============================================================ */

document.querySelectorAll('[data-set-mode]').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.setMode));
});

document.querySelectorAll('[data-set-theme]').forEach(btn => {
  btn.addEventListener('click', () => setTheme(btn.dataset.setTheme));
});

// Listen for system mode changes when in "system" mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getCurrentMode() === 'system') {
    requestAnimationFrame(render);
  }
});

updateActiveButtons();
render();
