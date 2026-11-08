const appRoot = document.querySelector('#app');
const toastRoot = document.querySelector('#toast');
const ATTENDANCE_CODE_LABELS = {
  P: 'Present', R: 'Regularized', A: 'Absent', CL: 'Casual leave',
  SL: 'Sick leave', L: 'Leave', WO: 'Weekly off', H: 'Paid holiday'
};
const monthNow = new Date();

// Style preferences state
const stylePrefs = {
  uiStyle: 'glassmorphism',
  bgMotion: 'none',
  motionHover: 'spring',
  speed: 'normal',
  corners: 'rounded',
  mode: 'light',
  palette: 1,
  surface: 'default'
};

const styleFilterLabels = {
  category: { all: 'All', modern: 'Modern', '3d': '3D & Tactile', expressive: 'Expressive' },
  uiStyle: {
    neumorphism: 'Neumorphism',
    minimalism: 'Minimalism',
    glassmorphism: 'Glassmorphism',
    bentogrid: 'Bento Grid',
    neobrutalism: 'Neo-Brutalism',
    claymorphism: 'Claymorphism',
    flat: 'Flat',
    darkmode: 'Dark Luxe',
    motionui: 'Motion UI',
    skeuomorphism: 'Skeuomorphism',
    cyberpunk: 'Cyberpunk',
    retrowave: 'Retrowave',
    aurora: 'Aurora',
    organic: 'Organic',
    highcontrast: 'High Contrast',
    papercut: 'Paper Cutout'
  },
  bgMotion: {
    none: 'None',
    orbs: 'Floating Orbs',
    mesh: 'Kinetic Mesh',
    aurora: 'Aurora Waves',
    cybergrid: 'Cyber Scanline',
    particles: 'Interactive Particles'
  },
  motionHover: {
    spring: 'Spring',
    magnetic: 'Magnetic',
    snap: 'Snap',
    glide: 'Glide',
    claypop: 'Clay Pop',
    glow: 'Glow',
    cyber: 'Cyber',
    rubber: 'Rubber',
    shimmer: 'Shimmer',
    kinetic: 'Kinetic'
  },
  speed: { off: 'Off', subtle: '0.5x', normal: 'Normal', intense: 'Intense' },
  corners: { default: 'Default', sharp: 'Sharp', rounded: 'Rounded', pill: 'Pill' },
  surface: { default: 'Default', 'flat-no-shadow': 'Flat', bordered: 'Outlined', 'deep-shadow': 'Deep 3D' },
  mode: { light: 'Light', dark: 'Dark' }
};

// Load style prefs from localStorage
function loadStylePrefs() {
  try {
    const saved = localStorage.getItem('salaryDeskStylePrefs');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(stylePrefs, parsed);
    }
  } catch (e) {
    // Use defaults if parsing fails
  }
}

// Save style prefs to localStorage
function saveStylePrefs() {
  localStorage.setItem('salaryDeskStylePrefs', JSON.stringify(stylePrefs));
}

// Apply style preferences to the UI
function applyStylePrefs() {
  const root = document.documentElement;
  const body = document.body;

  // Apply speed — controls animation/transition duration via CSS variables
  const speedMap = { off: '0ms', subtle: '300ms', normal: '180ms', intense: '90ms' };
  const speedDur = speedMap[stylePrefs.speed] || '180ms';
  root.style.setProperty('--duration-fast', speedDur);
  root.style.setProperty('--duration-base', speedDur);
  root.style.setProperty('--motion-speed', speedDur);
  body.classList.toggle('motion-off', stylePrefs.speed === 'off');
  body.classList.add('palette-active');

  // Apply palette colors — 60/30/10 combination across the entire screen
  // 60% = background, 30% = secondary surface, 10% = accent
  const requestedPalette = Number(stylePrefs.palette);
  const paletteNum = Number.isInteger(requestedPalette) && requestedPalette >= 1 && requestedPalette <= 15
    ? requestedPalette
    : 1;
  stylePrefs.palette = paletteNum;
  root.style.setProperty('--active-palette', String(paletteNum));

  // Derive colors from the 3 HSL channels stored in --palette-N-hsl
  // Each palette stores: hue sat lightness (of the dominant/accent hue)
  // Build light/dark palettes from that base using 60/30/10 rules
  const paletteHsl = getComputedStyle(root).getPropertyValue(`--palette-${paletteNum}-hsl`).trim();
  if (paletteHsl) {
    const parts = paletteHsl.trim().split(/\s+/);
    if (parts.length >= 3) {
      const hue = parts[0];
      // sat may come as "60%" — strip the % and parse as a number
      const satNum = parseInt(parts[1], 10);
      const sat = String(satNum);
      const baseLit = parseInt(parts[2], 10); // e.g. 15 for Ocean Depth (dark navy)
      const isDarkMode = stylePrefs.mode === 'dark';

      // ── 60% — Main background ──────────────────────────────────────────────
      // Dark: near-black with slight tint of palette hue
      // Light: very pale tint (baseLit shifted toward white)
      const bgLitDark  = Math.max(4, baseLit - 40);   // ~0-10
      const bgLitLight = Math.min(96, baseLit + 60);  // ~75-96
      const bgColor    = isDarkMode ? `hsl(${hue} ${Math.max(8,satNum-30)}% ${bgLitDark}%)`
                                    : `hsl(${hue} ${Math.max(5,satNum-40)}% ${bgLitLight}%)`;

      // ── 30% — Secondary surfaces (cards, panels, sidebar, topbar) ─────────
      // Dark: slightly lighter than bg for depth
      // Light: slightly darker than bg for contrast
      const bg1LitDark = Math.min(18, bgLitDark + 8);
      const bg1LitLight = Math.max(40, bgLitLight - 8);
      const bg1Color = isDarkMode ? `hsl(${hue} ${sat}% ${bg1LitDark}%)`
                                   : `hsl(${hue} ${sat}% ${bg1LitLight}%)`;

      // ── 10% — Accent / primary ─────────────────────────────────────────────
      // Keep saturation high, adjust lightness for readability
      const primaryLit = isDarkMode
        ? Math.min(65, baseLit + 40)   // bright enough to pop on dark
        : Math.min(60, baseLit + 20);  // deep enough to read on light
      const primaryColor = `hsl(${hue} ${sat}% ${primaryLit}%)`;
      const primary100   = `hsl(${hue} ${sat}% ${primaryLit}% / 0.12)`;
      const primary900   = `hsl(${hue} ${sat}% ${Math.max(10, primaryLit - 25)}%)`;

      // ── Tertiary surface (bg-2): for sidebar nav items, table headers ──────
      const bg2LitDark = Math.min(22, bg1LitDark + 5);
      const bg2LitLight = Math.max(55, bg1LitLight - 10);
      const bg2Color = isDarkMode ? `hsl(${hue} ${sat}% ${bg2LitDark}%)`
                                   : `hsl(${hue} ${sat}% ${bg2LitLight}%)`;

      // ── Text colors ────────────────────────────────────────────────────────
      const textColor    = isDarkMode ? '#f1f5f9' : '#0f172a';
      const textMuted    = isDarkMode ? '#94a3b8' : '#475569';
      const textSubtle   = isDarkMode ? '#64748b' : '#94a3b8';

      // ── Border colors ──────────────────────────────────────────────────────
      const borderDark  = 'rgba(255, 255, 255, 0.08)';
      const borderLight = 'rgba(0, 0, 0, 0.08)';
      const borderColor = isDarkMode ? borderDark : borderLight;

      // ── Sidebar & topbar (both follow bg-1 with slight variation) ──────────
      const sidebarLitDark = Math.max(4, bgLitDark - 2);
      const sidebarLitLight = Math.max(30, bg1LitLight - 5);
      const sidebarBgColor = isDarkMode ? `hsl(${hue} ${sat}% ${sidebarLitDark}%)`
                                         : `hsl(${hue} ${sat}% ${sidebarLitLight}%)`;
      const topbarBgColor = isDarkMode ? bg1Color : `hsl(${hue} ${Math.max(5,satNum-40)}% ${bgLitLight}%)`;

      // Write all computed values to CSS custom properties
      root.style.setProperty('--color-bg',    bgColor);
      root.style.setProperty('--color-bg-1',  bg1Color);
      root.style.setProperty('--color-bg-2',  bg2Color);
      root.style.setProperty('--modal-bg', bg1Color);
      root.style.setProperty('--color-primary', primaryColor);
      root.style.setProperty('--color-primary-100', primary100);
      root.style.setProperty('--color-primary-900', primary900);
      root.style.setProperty('--color-text',  textColor);
      root.style.setProperty('--color-text-muted', textMuted);
      root.style.setProperty('--color-text-subtle', textSubtle);
      root.style.setProperty('--sidebar-bg',  sidebarBgColor);
      root.style.setProperty('--topbar-bg',   topbarBgColor);
      root.style.setProperty('--panel-border', borderColor);
      root.style.setProperty('--sidebar-border', borderColor);
      // Dynamic button text color — dark on bright palettes, light on dark palettes
      const primaryLum = isDarkMode
        ? Math.min(65, baseLit + 40)   // dark mode primary lightness
        : Math.min(60, baseLit + 20);  // light mode primary lightness
      root.style.setProperty('--color-primary-text', primaryLum > 55 ? '#0f172a' : '#f8fafc');

      // Filter modal element colors — adapt to light/dark mode
      const filterBg    = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';
      const filterBorder = isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
      const filterColor  = isDarkMode ? '#f8fafc' : '#1e293b';
      const filterHover  = isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.08)';
      const ghostHover   = isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)';
      const navHoverBg   = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';
      root.style.setProperty('--filter-option-bg', filterBg);
      root.style.setProperty('--filter-option-border', filterBorder);
      root.style.setProperty('--filter-option-color', filterColor);
      root.style.setProperty('--filter-option-bg-dark', filterBg);
      root.style.setProperty('--filter-option-border-dark', filterBorder);
      root.style.setProperty('--filter-option-color-dark', filterColor);
      root.style.setProperty('--filter-option-hover', filterHover);
      root.style.setProperty('--ghost-hover', ghostHover);
      root.style.setProperty('--ghost-color', isDarkMode ? '#f8fafc' : '#1e293b');
      root.style.setProperty('--nav-link-hover-bg', navHoverBg);
    }
  }

  // Design tokens per UI style (complete set for all components)
  const uiStyle = stylePrefs.uiStyle || 'glassmorphism';
  const tokenSets = {
    neumorphism:  { cardBg: 'var(--color-bg)', cardBorder: 'none', cardShadow: '6px 6px 12px rgba(0,0,0,0.1), -6px -6px 12px rgba(255,255,255,0.9)', panelBg: 'var(--color-bg)', panelBorder: 'none', btnBg: 'var(--color-bg)', btnBorder: 'none', inputBg: 'var(--color-bg)', inputBorder: 'none', tableHeaderBg: 'transparent', tableRowHover: 'rgba(0,0,0,0.03)', sidebarBg: 'var(--color-bg)', topbarBg: 'var(--color-bg)', modalOverlay: 'rgba(0,0,0,0.3)' },
    minimalism:   { cardBg: 'var(--color-bg-1)', cardBorder: '1px solid transparent', cardShadow: 'none', panelBg: 'var(--color-bg-1)', panelBorder: '1px solid transparent', btnBg: 'transparent', btnBorder: '1px solid var(--color-text-subtle)', inputBg: 'var(--color-bg-1)', inputBorder: '1px solid var(--color-text-subtle)', tableHeaderBg: 'transparent', tableRowHover: 'transparent', sidebarBg: '#111827', topbarBg: 'var(--color-bg-1)', modalOverlay: 'rgba(0,0,0,0.3)' },
    glassmorphism:{ cardBg: 'var(--color-bg-1)', cardBorder: '1px solid var(--panel-border)', cardShadow: '0 4px 16px rgba(0,0,0,0.08)', panelBg: 'var(--color-bg-1)', panelBorder: '1px solid var(--panel-border)', btnBg: 'var(--color-bg-1)', btnBorder: '1px solid var(--panel-border)', inputBg: 'var(--color-bg-1)', inputBorder: '1px solid var(--panel-border)', tableHeaderBg: 'var(--color-bg-2)', tableRowHover: 'var(--color-bg-2)', sidebarBg: 'var(--color-bg-1)', sidebarText: 'var(--color-text)', navLinkColor: 'var(--color-text-muted)', topbarBg: 'var(--color-bg-1)', modalOverlay: 'rgba(15,23,42,0.6)' },
    bentogrid:    { cardBg: 'var(--color-primary)', cardBorder: 'none', cardShadow: 'none', panelBg: 'var(--color-bg-2)', panelBorder: 'none', btnBg: 'var(--color-primary)', btnBorder: 'none', inputBg: 'var(--color-bg-1)', inputBorder: '2px solid var(--color-primary)', tableHeaderBg: 'var(--color-primary)', tableRowHover: 'var(--color-primary-100)', sidebarBg: '#1e3a5f', topbarBg: 'var(--color-primary)', modalOverlay: 'rgba(0,0,0,0.7)' },
    neobrutalism: { cardBg: 'var(--color-bg-2)', cardBorder: '3px solid var(--color-text)', cardShadow: '4px 4px 0 var(--color-text)', panelBg: 'var(--color-bg-2)', panelBorder: '3px solid var(--color-text)', btnBg: 'var(--color-primary)', btnBorder: '2px solid var(--color-text)', inputBg: 'var(--color-bg-1)', inputBorder: '2px solid var(--color-text)', tableHeaderBg: 'var(--color-primary)', tableRowHover: 'var(--color-bg-2)', sidebarBg: 'var(--color-text)', topbarBg: 'var(--color-bg-1)', modalOverlay: 'rgba(0,0,0,0.8)' },
    claymorphism: { cardBg: 'var(--color-bg-1)', cardBorder: '1px solid rgba(255,255,255,0.8)', cardShadow: '0 8px 24px rgba(0,0,0,0.12), inset 0 0 20px rgba(255,255,255,0.6)', panelBg: 'var(--color-bg-1)', panelBorder: '1px solid rgba(255,255,255,0.8)', btnBg: 'var(--color-bg-1)', btnBorder: '1px solid rgba(255,255,255,0.8)', inputBg: 'var(--color-bg-1)', inputBorder: '1px solid rgba(255,255,255,0.6)', tableHeaderBg: 'var(--color-bg-2)', tableRowHover: 'rgba(255,255,255,0.3)', sidebarBg: '#1a1a2e', topbarBg: 'var(--color-bg-1)', modalOverlay: 'rgba(0,0,0,0.5)' },
    flat:         { cardBg: 'var(--color-bg-1)', cardBorder: '1px solid var(--color-text-subtle)', cardShadow: 'none', panelBg: 'var(--color-bg-1)', panelBorder: '1px solid var(--color-text-subtle)', btnBg: 'var(--color-primary)', btnBorder: 'none', inputBg: 'var(--color-bg-1)', inputBorder: '1px solid var(--color-text-subtle)', tableHeaderBg: 'var(--color-primary)', tableRowHover: 'var(--color-bg-2)', sidebarBg: '#1a1a2e', topbarBg: 'var(--color-bg-1)', modalOverlay: 'rgba(0,0,0,0.6)' },
    darkluxe:     { cardBg: 'rgba(255,255,255,0.05)', cardBorder: '1px solid rgba(212,175,55,0.2)', cardShadow: '0 8px 32px rgba(0,0,0,0.4)', panelBg: 'rgba(255,255,255,0.05)', panelBorder: '1px solid rgba(212,175,55,0.2)', btnBg: 'linear-gradient(135deg, #d4af37, #b8860b)', btnBorder: '1px solid #d4af37', inputBg: 'rgba(255,255,255,0.08)', inputBorder: '1px solid rgba(212,175,55,0.3)', tableHeaderBg: 'rgba(212,175,55,0.15)', tableRowHover: 'rgba(212,175,55,0.08)', sidebarBg: '#0a0a0a', topbarBg: 'rgba(255,255,255,0.05)', modalOverlay: 'rgba(0,0,0,0.8)' },
    motionui:     { cardBg: 'var(--color-bg-1)', cardBorder: '1px solid var(--color-primary)', cardShadow: '0 0 20px rgba(37,99,235,0.2)', panelBg: 'var(--color-bg-1)', panelBorder: '1px solid var(--color-primary)', btnBg: 'var(--color-primary)', btnBorder: 'none', inputBg: 'var(--color-bg-1)', inputBorder: '1px solid var(--color-primary)', tableHeaderBg: 'var(--color-primary)', tableRowHover: 'var(--color-primary-100)', sidebarBg: '#0b1020', topbarBg: 'var(--color-primary)', modalOverlay: 'rgba(15,23,42,0.7)' },
    skeuomorphism:{ cardBg: '#fff', cardBorder: '1px solid #d1d5db', cardShadow: '0 10px 20px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8)', panelBg: '#fff', panelBorder: '1px solid #d1d5db', btnBg: '#f3f4f6', btnBorder: '1px solid #d1d5db', inputBg: '#fff', inputBorder: '1px solid #d1d5db', tableHeaderBg: '#f3f4f6', tableRowHover: '#f9fafb', sidebarBg: '#1f2937', topbarBg: '#f3f4f6', modalOverlay: 'rgba(0,0,0,0.6)' },
    cyberpunk:    { cardBg: 'rgba(10,15,30,0.85)', cardBorder: '1px solid #0ff', cardShadow: '0 0 20px rgba(0,255,255,0.3)', panelBg: 'rgba(10,15,30,0.85)', panelBorder: '1px solid #0ff', btnBg: '#0ff', btnBorder: 'none', inputBg: 'rgba(10,15,30,0.9)', inputBorder: '1px solid #0ff', tableHeaderBg: 'rgba(0,255,255,0.15)', tableRowHover: 'rgba(0,255,255,0.05)', sidebarBg: '#0a0f1c', topbarBg: 'rgba(10,15,30,0.9)', modalOverlay: 'rgba(0,0,0,0.85)' },
    retrowave:    { cardBg: 'rgba(26,10,46,0.8)', cardBorder: '1px solid #ff4080', cardShadow: '0 0 30px rgba(255,64,128,0.4)', panelBg: 'rgba(26,10,46,0.8)', panelBorder: '1px solid #ff4080', btnBg: '#ff4080', btnBorder: 'none', inputBg: 'rgba(26,10,46,0.9)', inputBorder: '1px solid #ff4080', tableHeaderBg: 'rgba(255,64,128,0.2)', tableRowHover: 'rgba(255,64,128,0.1)', sidebarBg: '#1a0a2e', topbarBg: 'rgba(26,10,46,0.9)', modalOverlay: 'rgba(10,5,20,0.9)' },
    aurora:       { cardBg: 'rgba(255,255,255,0.08)', cardBorder: '1px solid rgba(100,116,201,0.3)', cardShadow: '0 4px 20px rgba(100,116,201,0.2)', panelBg: 'rgba(255,255,255,0.08)', panelBorder: '1px solid rgba(100,116,201,0.3)', btnBg: 'rgba(100,116,201,0.6)', btnBorder: 'none', inputBg: 'rgba(255,255,255,0.1)', inputBorder: '1px solid rgba(100,116,201,0.4)', tableHeaderBg: 'rgba(100,116,201,0.2)', tableRowHover: 'rgba(100,116,201,0.1)', sidebarBg: '#0e1117', topbarBg: 'rgba(255,255,255,0.08)', modalOverlay: 'rgba(10,15,30,0.7)' },
    organic:      { cardBg: '#f5f0e8', cardBorder: 'none', cardShadow: '0 8px 32px rgba(139,92,246,0.1)', panelBg: '#f5f0e8', panelBorder: 'none', btnBg: '#8b5cf6', btnBorder: 'none', inputBg: '#fff', inputBorder: '1px solid #e5e7eb', tableHeaderBg: '#ede9fe', tableRowHover: 'rgba(139,92,246,0.05)', sidebarBg: '#2d1b69', topbarBg: '#f5f0e8', modalOverlay: 'rgba(45,27,105,0.5)' },
    highcontrast: { cardBg: '#fff', cardBorder: '2px solid #000', cardShadow: '0 0 0 1px #000', panelBg: '#fff', panelBorder: '2px solid #000', btnBg: '#000', btnBorder: '2px solid #000', inputBg: '#fff', inputBorder: '2px solid #000', tableHeaderBg: '#000', tableRowHover: '#f0f0f0', sidebarBg: '#000', topbarBg: '#fff', modalOverlay: 'rgba(0,0,0,0.85)' },
    papercutout:  { cardBg: '#fff', cardBorder: '2px solid #333', cardShadow: '2px 2px 0 #ccc, 4px 4px 0 #aaa, 6px 6px 0 #888', panelBg: '#fff', panelBorder: '2px solid #333', btnBg: '#fff', btnBorder: '2px solid #333', inputBg: '#fff', inputBorder: '2px solid #333', tableHeaderBg: '#f0f0f0', tableRowHover: '#fafafa', sidebarBg: '#1a1a1a', topbarBg: '#fff', modalOverlay: 'rgba(0,0,0,0.6)' }
  };

  // Surface pattern overrides — applied after the base token set
  const surfaceOverrides = {
    default:      {},
    'flat-no-shadow':  { cardShadow: 'none', cardBorder: '1px solid var(--color-text-subtle)', panelShadow: 'none', panelBorder: '1px solid var(--color-text-subtle)' },
    bordered:     { cardShadow: 'none', cardBorder: '1px solid var(--color-text-subtle)', panelShadow: 'none', panelBorder: '1px solid var(--color-text-subtle)' },
    'deep-shadow': { cardShadow: '0 16px 48px rgba(0,0,0,0.18)', cardBorder: '1px solid rgba(0,0,0,0.08)', panelShadow: '0 16px 48px rgba(0,0,0,0.18)', panelBorder: '1px solid rgba(0,0,0,0.08)' }
  };
  const surface = stylePrefs.surface || 'default';
  const surfOverride = surfaceOverrides[surface] || surfaceOverrides.default;
  const tokens = tokenSets[uiStyle] || tokenSets.glassmorphism;
  root.style.setProperty('--shadow-card', surfOverride.cardShadow ?? tokens.cardShadow);
  root.style.setProperty('--border-card', surfOverride.cardBorder ?? tokens.cardBorder);
  root.style.setProperty('--panel-shadow', surfOverride.panelShadow ?? tokens.panelShadow ?? tokens.cardShadow);
  root.style.setProperty('--panel-border-style', surfOverride.panelBorder ?? tokens.panelBorder);
  root.style.setProperty('--card-bg', tokens.cardBg);
  root.style.setProperty('--panel-bg', tokens.panelBg);
  root.style.setProperty('--button-bg', tokens.btnBg);
  root.style.setProperty('--button-border', tokens.btnBorder);
  root.style.setProperty('--input-bg', tokens.inputBg);
  root.style.setProperty('--input-border', tokens.inputBorder);
  root.style.setProperty('--table-header-bg', tokens.tableHeaderBg);
  root.style.setProperty('--table-row-hover', tokens.tableRowHover);
  root.style.setProperty('--sidebar-bg', tokens.sidebarBg);
  root.style.setProperty('--sidebar-text', tokens.sidebarText || '#e2e8f0');
  root.style.setProperty('--sidebar-border', tokens.sidebarBorder || 'rgba(148, 163, 184, 0.08)');
  root.style.setProperty('--nav-link-color', tokens.navLinkColor || '#cbd5e1');
  root.style.setProperty('--nav-link-hover', tokens.navLinkHover || 'rgba(37, 99, 235, 0.1)');
  root.style.setProperty('--nav-link-active', tokens.navLinkActive || 'rgba(37, 99, 235, 0.2)');
  root.style.setProperty('--nav-link-active-text', tokens.navLinkActiveText || '#fff');
  root.style.setProperty('--nav-icon-color', tokens.navIconColor || '#94a3b8');
  root.style.setProperty('--topbar-bg', tokens.topbarBg);
  root.style.setProperty('--modal-overlay', tokens.modalOverlay);
  root.style.setProperty('--bg-soft', tokens.cardBg);

  // Apply corners — CSS variables for radius, with class overrides
  body.classList.remove('radius-sharp', 'radius-rounded', 'radius-pill');
  const cornerValue = stylePrefs.corners || 'rounded';
  if (cornerValue === 'sharp') body.classList.add('radius-sharp');
  else if (cornerValue === 'pill') body.classList.add('radius-pill');
  else body.classList.add('radius-rounded');

  // Apply UI style — CSS uses .ui-* classes on the body
  const uiStyleMap = {
    neumorphism: 'ui-neumorphism', minimalism: 'ui-minimalism',
    glassmorphism: 'ui-glassmorphism', bentogrid: 'ui-bentogrid', neobrutalism: 'ui-neobrutalism',
    claymorphism: 'ui-claymorphism', flat: 'ui-flat', darkmode: 'ui-darkluxe', darkluxe: 'ui-darkluxe',
    motionui: 'ui-motionui', skeuomorphism: 'ui-skeuomorphism',
    cyberpunk: 'ui-cyberpunk', retrowave: 'ui-retrowave', aurora: 'ui-aurora',
    organic: 'ui-organic', highcontrast: 'ui-highcontrast', papercut: 'ui-papercutout', papercutout: 'ui-papercutout'
  };
  body.classList.remove(...Object.values(uiStyleMap).filter(Boolean));
  const uiClass = uiStyleMap[stylePrefs.uiStyle || 'glassmorphism'];
  if (uiClass) body.classList.add(uiClass);

  // Apply mode (light/dark)
  if (stylePrefs.mode === 'dark') {
    body.setAttribute('data-theme', 'dark');
  } else {
    body.removeAttribute('data-theme');
  }

  // Apply background motion — CSS uses .bg-* classes on the body
  const bgMotionMap = {
    none: null, orbs: 'bg-floating-orbs', mesh: 'bg-kinetic-mesh',
    aurora: 'bg-aurora-waves', cybergrid: 'bg-cyber-scanline', particles: 'bg-interactive-particles'
  };
  body.classList.remove(...Object.values(bgMotionMap).filter(Boolean));
  const bgClass = bgMotionMap[stylePrefs.bgMotion || 'none'];
  if (bgClass) body.classList.add(bgClass);

  // Apply hover motion — CSS uses .motion-* classes on the body
  body.classList.remove(...Object.keys(styleFilterLabels.motionHover).map(v => 'motion-' + v));
  const motionHover = stylePrefs.motionHover || 'spring';
  body.classList.add('motion-' + motionHover);

  const app = document.querySelector('#app');
  if (app) {
    app.classList.remove('category-all', 'category-modern', 'category-3d', 'category-expressive');
    const category = Object.hasOwn(styleFilterLabels.category, stylePrefs.category) ? stylePrefs.category : 'all';
    stylePrefs.category = category;
    app.classList.add(`category-${category}`);
  }
}

// Open the style filter modal
function openStyleFilterModal() {
  loadStylePrefs();
  applyStylePrefs();
  // applyCategoryFilter() removed - all tabs always visible
  const categoryDescriptions = {
    all: 'All views',
    modern: 'Dashboard, employees, attendance, payroll, settings',
    '3d': 'Travel, route-playback, my-travel, my-route',
    expressive: 'Leave, expenses, tasks, samples, orders, shifts, customers, dashboard-kpis, employee-detail'
  };
  openModal('Style Filter', `
    <div class="style-filter-modal">
      <div class="style-filter-section">
        <h3>Category</h3>
        <div class="style-filter-group">
          ${Object.entries(styleFilterLabels.category).map(([value, label]) => `
            <button type="button" class="style-filter-option ${stylePrefs.category === value ? 'active' : ''}" data-value="category" data-key="category" data-val="${value}" title="${escapeHtml(categoryDescriptions[value] || '')}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="style-filter-section">
        <h3>UI Style (16 options)</h3>
        <div class="style-filter-group">
          ${Object.entries(styleFilterLabels.uiStyle).map(([value, label]) => `
            <button type="button" class="style-filter-option ${stylePrefs.uiStyle === value ? 'active' : ''}" data-value="uiStyle" data-key="uiStyle" data-val="${value}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="style-filter-section">
        <h3>Background Motion (6 options)</h3>
        <div class="style-filter-group">
          ${Object.entries(styleFilterLabels.bgMotion).map(([value, label]) => `
            <button type="button" class="style-filter-option ${stylePrefs.bgMotion === value ? 'active' : ''}" data-value="bgMotion" data-key="bgMotion" data-val="${value}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="style-filter-section">
        <h3>Motion Hover (10 options)</h3>
        <div class="style-filter-group">
          ${Object.entries(styleFilterLabels.motionHover).map(([value, label]) => `
            <button type="button" class="style-filter-option ${stylePrefs.motionHover === value ? 'active' : ''}" data-value="motionHover" data-key="motionHover" data-val="${value}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="style-filter-section">
        <h3>Speed</h3>
        <div class="speed-options">
          ${Object.entries(styleFilterLabels.speed).map(([value, label]) => `
            <button type="button" class="style-filter-option small ${stylePrefs.speed === value ? 'active' : ''}" data-value="speed" data-key="speed" data-val="${value}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="style-filter-section">
        <h3>Corners</h3>
        <div class="style-filter-group">
          ${Object.entries(styleFilterLabels.corners).map(([value, label]) => `
            <button type="button" class="style-filter-option ${stylePrefs.corners === value ? 'active' : ''}" data-value="corners" data-key="corners" data-val="${value}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="style-filter-section">
        <h3>Mode & Palette (10 colors)</h3>
        <div class="mode-toggle">
          <span class="label">Dark Mode</span>
          <label class="switch">
            <input type="checkbox" id="style-mode-toggle" ${stylePrefs.mode === 'dark' ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div style="margin-top:12px">
          <h4 style="margin:0 0 8px;font-size:13px;color:var(--color-text-muted)">Surface</h4>
          <div class="style-filter-group" style="margin-bottom:12px">
            ${Object.entries(styleFilterLabels.surface).map(([value, label]) => `
              <button type="button" class="style-filter-option ${stylePrefs.surface === value ? 'active' : ''}" data-value="surface" data-key="surface" data-val="${value}">${label}</button>
            `).join('')}
          </div>
          <h4 style="margin:0 0 8px;font-size:13px;color:var(--color-text-muted)">Palette (3 combinations)</h4>
          <div class="palette-grid">
            ${Array.from({ length: 15 }, (_, i) => (i + 1)).map(num => `
              <button type="button" class="palette-option ${stylePrefs.palette === num ? 'active' : ''}" data-palette="${num}">
                <div class="palette-color" style="background:hsl(${getComputedStyle(document.documentElement).getPropertyValue(`--palette-${num}-hsl`).trim()})"></div>
                <div class="palette-name">${['1. Ocean Depth','2. Seafoam','3. Soft Teal','4. Misty Blue','5. Sky Whisper','6. Forest Canopy','7. Moss Stone','8. Terracotta Clay','9. Warm Sand','10. Desert Dusk','11. Midnight Ink','12. Electric Violet','13. Neon Coral','14. Mint Pulse','15. Golden Hour'][num-1]}</div>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="button" data-action="save-style-prefs">Apply</button>', true);
}

const state = {
  user: null,
  needsSetup: false,
  recoveryIdentifier: '',
  view: 'dashboard',
  month: `${monthNow.getFullYear()}-${String(monthNow.getMonth() + 1).padStart(2, '0')}`,
  search: '',
  attendance: null,
  attendanceDirty: false,
  selectedEmployeeId: null,
  trackingFilter: 'all',
  trackingData: null,
  settingsTab: 'approvals',
  navCategory: null,
  accessTab: 'users'
};
let liveTracking = null;
let managerLiveMap = null;
let managerLiveMarkers = new Map();
let managerLiveMapInterval = null;
let googleMapsLoaded = false;
let gmpApiKey = 'AIzaSyB7AWneeUL4Z-iXVcqT-1rftWgUq4dovaM';
// Employee filter state
let trackingFilterState = { all: 0, live: 0, idle: 0, offline: 0 };
let currentEmployeeFilter = null; // null = all, or specific employee_id

const viewInfo = {
  dashboard: ['Overview', 'Monthly payroll and workforce snapshot'],
  employees: ['Employees', 'Maintain employee records and salary eligibility'],
  'employee-detail': ['Employee Detail', 'Full salary, attendance, travel, leave view'],
  revisions: ['Salary revisions', 'Record effective-dated CTC changes'],
  attendance: ['Attendance', 'Edit daily attendance and paid-day totals'],
  payroll: ['Payroll', 'Review monthly calculations and manual inputs'],
  travel: ['Travel', 'Field-sales journeys, TA/DA and approvals'],
  expenses: ['Expenses', 'Track, approve and manage travel & office expenses'],
  'route-playback': ['Route Playback', 'View employee GPS routes and selfies'],
  holidays: ['Holiday list', 'Manage paid holidays used by attendance'],
  settings: ['Rule settings', 'Configure workbook-derived payroll constants'],
  users: ['Access control', 'Manage administrator, HR, and payroll accounts'],
  'leave': ['Leave management', 'Leave types, balances, and approval workflow'],
  'my-attendance': ['My Attendance', 'View your own attendance record'],
  'my-approvals': ['My Approvals', 'Review requests routed to you and your approval history'],
  'my-travel': ['My Travel', 'Track your field-sales journeys and live GPS'],
  'my-slip': ['My Payslip', 'View your own salary statement'],
  'my-leave': ['My Leave', 'Leave balance and request approval'],
  'my-route': ['My Route', 'Your GPS routes with selfies'],
  'punch': ['Punch In/Out', 'GPS location and selfie attendance for field force'],
  'customers': ['Customers', 'Doctor/Customer master for field visits'],
  // TrackOlap features
  'samples': ['Sample Tracking', 'Track promotional samples and field inputs'],
  'orders': ['Chemist Orders', 'Browse products and book orders for dispatch'],
  'shifts': ['Shifts', 'Manage shift rosters and employee assignments'],
  'tasks': ['Field Tasks', 'Assign, track, and close field tasks'],
  'dashboard-kpis': ['Manager Dashboard', 'Field force KPIs and analytics']
};

const icons = {
  dashboard: '◫',
  employees: '♙',
  'employee-detail': '♙',
  revisions: '↗',
  attendance: '▦',
  payroll: '₹',
  travel: '⊕',
  'route-playback': '⌖',
  expenses: '₹',
  holidays: '◇',
  settings: '⚙',
  users: '♧',
  leave: '▤',
  'my-attendance': '▦',
  'my-approvals': '✓',
  'my-travel': '⊕',
  'my-slip': '₹',
  'my-leave': '▤',
  'my-route': '⌖',
  punch: '⌖',
  customers: '◎',
  // TrackOlap icons
  samples: '▧',
  orders: '▤',
  shifts: '◷',
  tasks: '✓',
  'dashboard-kpis': '◉'
};

const settingsHelp = {
  basic_pct: 'Employee List formula: basic = rounded gross × this rate.',
  hra_pct: 'Employee List formula: HRA = rounded basic × this rate.',
  bonus_pct: 'Bonus provision calculated as a percentage of basic pay.',
  statutory_wage_pct: 'Workbook setting retained for reference; it does not calculate an excess add-back.',
  statutory_wage_addback: 'Read-only: the workbook formula returns zero for this add-back.',
  pf_rate: 'PF percentage applied to basic pay up to the configured cap.',
  pf_wage_cap: 'Maximum wage base for the workbook PF formula.',
  pf_ctc_threshold: 'CTC-to-gross branch threshold for PF-applicable employees.',
  esic_employee_rate: 'Employee ESIC percentage used below the ESIC wage threshold.',
  esic_employer_rate: 'Employer ESIC percentage used below the ESIC wage threshold.',
  esic_wage_cap: 'Gross salary threshold used for ESIC eligibility.',
  professional_tax: 'Flat amount deducted when the payroll row has paid days.',
  ctc_factor_both: 'CTC divisor when both PF and ESIC apply.',
  ctc_factor_pf_below: 'CTC divisor for PF-only employees at or below the threshold.',
  ctc_factor_pf_above: 'CTC divisor for PF-only employees above the threshold.',
  ctc_factor_esic_below: 'CTC divisor for ESIC-only employees at or below the threshold.',
  ctc_factor_esic_above: 'CTC divisor when neither contribution applies or above-threshold ESIC.'
};

const settingLabels = {
  basic_pct: 'Basic % of gross',
  hra_pct: 'HRA % of basic',
  bonus_pct: 'Bonus % of basic',
  statutory_wage_pct: '50% wage rule',
  statutory_wage_addback: '50% excess add-back',
  pf_rate: 'PF rate',
  pf_wage_cap: 'PF wage cap',
  pf_ctc_threshold: 'PF CTC threshold',
  esic_employee_rate: 'Employee ESIC rate',
  esic_employer_rate: 'Employer ESIC rate',
  esic_wage_cap: 'ESIC wage threshold',
  professional_tax: 'Professional tax',
  ctc_factor_both: 'CTC divisor: PF + ESIC',
  ctc_factor_pf_below: 'CTC divisor: PF below threshold',
  ctc_factor_pf_above: 'CTC divisor: PF above threshold',
  ctc_factor_esic_below: 'CTC divisor: ESIC below threshold',
  ctc_factor_esic_above: 'CTC divisor: ESIC above / none'
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('Content-Type') || '';
  return contentType.includes('application/json') ? response.json() : response;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function currency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function km(value) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function numberToLocaleString(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function dateLabel(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function localDateIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toast(message, error = false) {
  toastRoot.textContent = message;
  toastRoot.classList.toggle('error', error);
  toastRoot.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastRoot.classList.remove('show'), 2800);
}

function canPayroll() {
  return state.user?.role === 'admin' || state.user?.role === 'payroll';
}

function canAccessModule(module, action = 'view') {
  const permissions = state.user?.access_permissions || {};
  const grants = permissions[module] || [];
  return grants.includes(action) || grants.includes('manage');
}

function roleTitle(role) {
  return ({ admin: 'Administrator', hr: 'HR manager', payroll: 'Payroll manager', employee: 'Employee' })[role] || role;
}

function accessRoleTitle(role) {
  return ({
    super_admin: 'Super Admin',
    hr_admin: 'HR Admin',
    department_head: 'Department Head',
    regional_manager: 'Regional Manager',
    area_manager: 'Area Manager',
    finance: 'Finance',
    employee: 'Employee / Field Executive'
  })[role] || role;
}

// Navigation category groups — maps to the new horizontal top nav.
// Each category has a list of view ids. Direct tabs (no submenu) are
// listed under the `direct` key. Overview is always a direct tab.
const NAV_GROUPS = {
  overview:   { label: 'Overview', icon: '◫', direct: ['dashboard'] },
  people:     { label: 'People', icon: '♙', items: ['employees', 'employee-detail', 'dashboard-kpis', 'users'] },
  payroll:    { label: 'Payroll', icon: '₹', items: ['revisions', 'payroll', 'expenses', 'my-slip'] },
  workforce:  { label: 'Workforce', icon: '▦', items: ['attendance', 'shifts', 'leave', 'holidays', 'my-approvals', 'my-attendance', 'my-leave', 'punch'] },
  fieldOps:   { label: 'Field Operations', icon: '⌖', items: ['tasks', 'samples', 'travel', 'route-playback', 'my-travel', 'my-route'] },
  sales:      { label: 'Sales', icon: '◎', items: ['customers', 'orders'] },
  settings:   { label: 'Settings', icon: '⚙', items: ['settings'] }
};

// Which views are visible for the current role (mirrors the old navItems logic).
function visibleViews() {
  const role = state.user?.role;
  const accessRoles = new Set(state.user?.access_roles || []);
  const hasEmployeeId = !!state.user?.employee_id;
  const set = new Set();
  if (accessRoles.has('employee') || role === 'employee') {
    ['punch', 'my-travel', 'my-slip', 'my-leave', 'my-attendance', 'my-route', 'expenses', 'customers'].forEach(set.add, set);
  }
  const isManager = ['department_head', 'regional_manager', 'area_manager'].some((accessRole) => accessRoles.has(accessRole));
  if (['super_admin', 'hr_admin', 'department_head', 'regional_manager', 'area_manager', 'finance'].some((accessRole) => accessRoles.has(accessRole))) {
    set.add('my-approvals');
  }
  if (role !== 'employee' || isManager) {
    ['dashboard', 'employees', 'employee-detail', 'attendance', 'holidays', 'leave'].forEach(set.add, set);
  }
  if (canPayroll() || accessRoles.has('finance')) {
    ['revisions', 'payroll', 'dashboard-kpis', 'samples', 'orders', 'shifts', 'tasks', 'travel', 'expenses', 'route-playback', 'customers'].forEach(set.add, set);
    if (hasEmployeeId) set.add('punch');
  }
  if (accessRoles.has('super_admin') || role === 'admin') ['settings', 'users'].forEach(set.add, set);
  const selfOnly = accessRoles.has('employee') && !isManager
    && !accessRoles.has('super_admin') && !accessRoles.has('hr_admin') && !accessRoles.has('finance');
  const moduleViews = {
    dashboard: ['dashboard'],
    employees: ['employees', 'employee-detail'],
    'salary-revisions': ['revisions'],
    payroll: ['payroll'],
    attendance: ['attendance'],
    travel: ['travel'],
    'route-playback': ['route-playback'],
    expenses: ['expenses'],
    holidays: ['holidays'],
    'rule-settings': ['settings'],
    'leave-management': ['leave'],
    'sample-tracking': ['samples'],
    'chemist-orders': ['orders'],
    shifts: ['shifts'],
    'field-tasks': ['tasks'],
    customers: ['customers'],
    reports: ['dashboard-kpis']
  };
  for (const [module, views] of Object.entries(moduleViews)) {
    if (!canAccessModule(module)) continue;
    if (selfOnly && ['employees', 'salary-revisions', 'payroll', 'attendance', 'travel',
      'route-playback', 'holidays', 'leave-management', 'shifts', 'field-tasks', 'sample-tracking'].includes(module)) continue;
    if (['payroll', 'salary-revisions'].includes(module)
      && !accessRoles.has('super_admin') && !accessRoles.has('finance')) continue;
    views.forEach(set.add, set);
  }
  if (canAccessModule('access-control', 'manage')
    && (accessRoles.has('super_admin') || role === 'admin')) set.add('users');
  if (['attendance', 'expenses', 'leave-management'].some((module) =>
    canAccessModule(module, 'approve') || canAccessModule(module, 'reject'))) {
    set.add('my-approvals');
  }
  return set;
}

// Build the list of categories + items visible to the current user.
function navGroups() {
  const visible = visibleViews();
  return Object.entries(NAV_GROUPS).map(([key, group]) => {
    const items = (group.items || []).filter((v) => visible.has(v));
    const direct = (group.direct || []).filter((v) => visible.has(v));
    return { key, ...group, items, direct };
  }).filter((g) => g.direct.length || g.items.length);
}

function renderShell() {
  const title = viewInfo[state.view]?.[0] || 'Overview';
  const roleLabel = state.user.access_roles?.length
    ? state.user.access_roles.map(accessRoleTitle).join(', ')
    : roleTitle(state.user.role);
  const groups = navGroups();
  const activeGroup = groups.find((g) => g.direct.includes(state.view) || g.items.includes(state.view));
  const activeCat = groups.some((group) => group.key === state.navCategory)
    ? state.navCategory
    : activeGroup?.key || groups[0]?.key || '';
  state.navCategory = activeCat;

  appRoot.innerHTML = `
    <div class="shell">
      <nav class="navbar" aria-label="Main navigation">
        <div class="brand">
          <div class="brand-mark">SD</div>
          <div><div class="brand-title">Salary Desk</div><div class="brand-subtitle">Payroll workspace</div></div>
        </div>
        <div class="nav-categories" id="nav-categories">
          ${groups.map((g) => `
            ${g.direct.length ? `
              <a class="nav-category ${g.key === activeCat ? 'active' : ''}" id="nav-category-${g.key}" data-nav-category="${g.key}" data-view="${g.direct[0]}" href="#${g.direct[0]}" ${state.view === g.direct[0] ? 'aria-current="page"' : ''}>
                <span class="nav-category-icon" aria-hidden="true">${g.icon || ''}</span><span>${escapeHtml(g.label)}</span>
              </a>` : `
              <button type="button" class="nav-category ${g.key === activeCat ? 'active' : ''}" id="nav-category-${g.key}" aria-controls="nav-panel-${g.key}" aria-expanded="${g.key === activeCat}" data-nav-category="${g.key}">
                <span class="nav-category-icon" aria-hidden="true">${g.icon || ''}</span><span>${escapeHtml(g.label)}</span>
              </button>`}`).join('')}
        </div>
        <div class="nav-secondary-area" id="nav-secondary-area">
          ${groups.filter((group) => group.items.length).map((g) => `
              <div class="nav-secondary-panel ${g.key === activeCat ? 'active' : ''}" id="nav-panel-${g.key}" role="group" aria-label="${escapeHtml(g.label)} pages" aria-hidden="${g.key !== activeCat}" ${g.key === activeCat ? '' : 'inert'}>
                ${g.items.map((v) => `
                  <a class="nav-subtab ${state.view === v ? 'active' : ''}" data-view="${v}" href="#${v}" ${state.view === v ? 'aria-current="page"' : ''}>
                    <span class="nav-subtab-icon" aria-hidden="true">${icons[v] || ''}</span><span>${escapeHtml(viewInfo[v][0])}</span>
                  </a>`).join('')}
              </div>`).join('')}
        </div>
      </nav>
      <main class="main">
        <header class="topbar">
          <div><h1 class="page-heading">${escapeHtml(title)}</h1><div class="page-subheading">${escapeHtml(viewInfo[state.view]?.[1] || '')}</div></div>
          <div class="top-actions">
            ${['dashboard', 'attendance', 'payroll', 'travel', 'leave', 'revisions', 'holidays', 'punch'].includes(state.view) ? `
              <input class="control month-select" id="month-control" type="month" value="${escapeHtml(state.month)}" aria-label="Select month">` : ''}
            <div class="profile-menu">
              <button type="button" class="profile-btn" data-action="open-profile-modal">
                <span class="profile-avatar">${escapeHtml(state.user.username.slice(0, 2).toUpperCase())}</span>
              </button>
              <div class="profile-info">
                <div class="profile-name">${escapeHtml(state.user.username)}</div>
                <div class="profile-role">${escapeHtml(roleLabel)}</div>
              </div>
              <button type="button" class="button ghost small" data-action="logout">Sign out</button>
            </div>
          </div>
        </header>
        <section class="content" id="view-root"><div class="empty-state">Loading workspace…</div></section>
      </main>
    </div>
    <div id="modal-root"></div>`;

  // Apply style preferences and category filter after shell is rendered
  const app = document.querySelector('#app');
  if (app) {
    app.classList.remove('category-all', 'category-modern', 'category-3d', 'category-expressive');
    app.classList.add('category-' + (stylePrefs.category || 'all'));
  }
  applyStylePrefs();
}

function authScreen(setup, mode = 'login', message = '') {
  if (!setup && mode === 'recovery-request') {
    appRoot.innerHTML = `
      <main class="login-screen">
        <section class="login-card">
          <div class="brand"><div class="brand-mark">SD</div><div><div class="brand-title">Salary Desk</div><div class="brand-subtitle">Payroll workspace</div></div></div>
          <h1>Reset your password</h1>
          <p>Enter your username, employee ID, or recovery email. If the account has a recovery email, we’ll send a verification code.</p>
          <form class="login-form" id="auth-recovery-request-form">
            <div class="field"><label for="recovery-identifier">Username, Employee ID, or recovery email</label><input class="control" id="recovery-identifier" name="identifier" required maxlength="254" autocomplete="username" value="${escapeHtml(state.recoveryIdentifier)}"></div>
            <button class="button primary" type="submit">Send verification code</button>
          </form>
          <button type="button" class="button ghost login-back" data-action="back-to-login">Back to sign in</button>
          <div class="login-footnote">For account privacy, the confirmation is the same whether or not a matching recovery email is available.</div>
        </section>
      </main>`;
    return;
  }

  if (!setup && mode === 'recovery-verify') {
    appRoot.innerHTML = `
      <main class="login-screen">
        <section class="login-card">
          <div class="brand"><div class="brand-mark">SD</div><div><div class="brand-title">Salary Desk</div><div class="brand-subtitle">Payroll workspace</div></div></div>
          <h1>Enter verification code</h1>
          <p>${escapeHtml(message || 'If an account matches and has a recovery email, a verification code will be sent.')}</p>
          <form class="login-form" id="auth-recovery-verify-form">
            <div class="field"><label for="recovery-code">6-digit code</label><input class="control" id="recovery-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div>
            <div class="field"><label for="recovery-password">New password</label><div class="password-input-wrap"><input class="control" id="recovery-password" name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required><button type="button" class="button small" data-action="toggle-password" data-target="recovery-password">Show</button></div></div>
            <div class="field"><label for="recovery-confirm-password">Confirm new password</label><div class="password-input-wrap"><input class="control" id="recovery-confirm-password" name="confirm_password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required><button type="button" class="button small" data-action="toggle-password" data-target="recovery-confirm-password">Show</button></div></div>
            <button class="button primary" type="submit">Reset password</button>
          </form>
          <div class="login-secondary-actions"><button type="button" class="button ghost" data-action="resend-recovery-code">Send another code</button><button type="button" class="button ghost" data-action="back-to-login">Back to sign in</button></div>
          <div class="login-footnote">Codes expire after 10 minutes. A successful reset signs out all active sessions.</div>
        </section>
      </main>`;
    return;
  }

  appRoot.innerHTML = `
    <main class="login-screen">
      <section class="login-card">
        <div class="brand"><div class="brand-mark">SD</div><div><div class="brand-title">Salary Desk</div><div class="brand-subtitle">Payroll workspace</div></div></div>
        <h1>${setup ? 'Set up your workspace' : 'Welcome back'}</h1>
        <p>${setup ? 'Create the first administrator account. Use a unique password of at least 12 characters.' : 'Sign in with your username, employee ID, or email.'}</p>
        ${message ? `<div class="login-message" role="status">${escapeHtml(message)}</div>` : ''}
        <form class="login-form" id="auth-form">
          <div class="field"><label for="auth-username">${setup ? 'Username' : 'Username, Employee ID, or Email'}</label><input class="control" id="auth-username" name="${setup ? 'username' : 'identifier'}" required maxlength="80" autocomplete="username"></div>
          ${setup ? '<div class="field"><label for="auth-recovery-email">Recovery email (optional)</label><input class="control" id="auth-recovery-email" name="recovery_email" type="email" maxlength="254" autocomplete="email"><span class="field-hint">Used only for password recovery. You can also add it later in Access control.</span></div>' : ''}
          <div class="field"><label for="auth-password">Password</label><div class="password-input-wrap"><input class="control" id="auth-password" name="password" type="password" required minlength="${setup ? 12 : 1}" maxlength="200" autocomplete="${setup ? 'new-password' : 'current-password'}"><button type="button" class="button small" data-action="toggle-password" data-target="auth-password">Show</button></div></div>
          ${setup ? '' : '<label class="remember-session"><input type="checkbox" name="remember_me"> <span>Keep me signed in for 30 days</span></label>'}
          <button class="button primary" type="submit">${setup ? 'Create administrator' : 'Sign in'}</button>
        </form>
        ${setup ? '' : '<button type="button" class="button ghost login-back" data-action="forgot-password">Forgot password?</button>'}
        <div class="login-footnote">Payroll records are private to authorized workspace users. Do not share employee bank or tax details over email.</div>
      </section>
    </main>`;
}

async function loadView() {
  const root = document.querySelector('#view-root');
  if (!root) return;
  if (state.view !== 'travel') {
    if (managerLiveMapInterval) clearInterval(managerLiveMapInterval);
    managerLiveMapInterval = null;
    managerLiveMarkers.forEach((marker) => marker.setMap(null));
    managerLiveMarkers.clear();
    managerLiveMap = null;
  }
  root.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const renderers = {
      dashboard: renderDashboard,
      employees: renderEmployees,
      'employee-detail': renderEmployeeDetail,
      revisions: renderRevisions,
      attendance: renderAttendance,
      payroll: renderPayroll,
      travel: renderTravel,
      'route-playback': renderRoutePlayback,
      expenses: renderExpenses,
      'my-approvals': renderMyApprovals,
      'my-route': renderMyRoute,
      holidays: renderHolidays,
      settings: renderSettings,
      users: renderUsers,
      leave: renderLeave,
      'my-attendance': renderMyAttendance,
      'my-travel': renderMyTravel,
      'my-slip': renderMySlip,
      'my-leave': renderMyLeave,
      punch: renderPunch,
      customers: renderCustomers,
      // TrackOlap feature views
      samples: renderSamples,
      orders: renderOrders,
      shifts: renderShifts,
      tasks: renderTasks,
      'dashboard-kpis': renderDashboardKpis
    };
    await renderers[state.view]();
  } catch (error) {
    root.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
  }
}

function viewTitle(title, description, actions = '') {
  return `<div class="view-title-row"><div><h2 class="view-title">${escapeHtml(title)}</h2><p class="view-description">${escapeHtml(description)}</p></div><div class="actions">${actions}</div></div>`;
}

async function renderDashboard() {
  const data = await api(`/api/dashboard?month=${encodeURIComponent(state.month)}`);
  const attendanceTotals = Object.entries(data.attendance || {})
    .filter(([code]) => code)
    .map(([code, count]) => `${code}: ${count}`)
    .join(' · ') || 'No attendance recorded';
  const shortcuts = [
    ['employees', 'Add or update employees', 'Employee master and salary eligibility'],
    ['attendance', 'Review attendance', 'Daily status drives paid-day proration'],
    ...(canPayroll() ? [['payroll', 'Review monthly payroll', 'Reimbursements, deductions and payslips']] : []),
    ['holidays', 'Manage holidays', 'Paid holidays appear in attendance']
  ];
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle(`Payroll overview · ${state.month}`, 'A connected view of employee records, attendance, and monthly salary calculations.')}
    <div class="cards">
      <article class="card"><div class="card-label">Active employees</div><div class="card-value">${data.activeEmployees}</div><div class="card-note">Active records in the employee master</div></article>
      <article class="card"><div class="card-label">Payroll status</div><div class="card-value"><span class="status-pill ${data.payrollStatus === 'paid' ? 'green' : data.payrollStatus === 'review' ? 'amber' : ''}">${escapeHtml(data.payrollStatus)}</span></div><div class="card-note">Status for ${escapeHtml(state.month)}</div></article>
      ${canPayroll() ? `<article class="card"><div class="card-label">Final payable</div><div class="card-value">${currency(data.payrollTotal)}</div><div class="card-note">Recalculated from saved payroll inputs</div></article>` : ''}
      <article class="card"><div class="card-label">Attendance entries</div><div class="card-value">${Object.values(data.attendance || {}).reduce((a, b) => a + b, 0)}</div><div class="card-note">${escapeHtml(attendanceTotals)}</div></article>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><h3 class="panel-title">Payroll workflow</h3><span class="status-pill">${escapeHtml(state.month)}</span></div>
        <div class="panel-body"><div class="notice">Attendance and holiday changes flow into paid days. Salary revisions adjust monthly CTC; employee salary components and payroll deductions recalculate from the workbook rules.</div>
        <div class="divider"></div><div class="shortcut-list">${shortcuts.map(([view, title, note]) => `
          <button class="shortcut" type="button" data-view="${view}"><span class="shortcut-icon">${icons[view]}</span><span><span class="shortcut-title">${escapeHtml(title)}</span><span class="shortcut-note">${escapeHtml(note)}</span></span></button>`).join('')}</div>
        </div>
      </section>
      <section class="panel"><div class="panel-header"><h3 class="panel-title">Calculation notes</h3></div><div class="panel-body">
        <div class="list-row"><span>Paid-day proration</span><strong>Paid days ÷ calendar days</strong></div>
        <div class="list-row"><span>Manual earnings</span><strong>TA &amp; DA / reimbursement</strong></div>
        <div class="list-row"><span>Net payable floor</span><strong>Cannot be negative</strong></div>
        <div class="list-row"><span>Leave codes</span><strong>CL · SL · L · R</strong></div>
        <p class="field-hint">The payslip and employer-contribution treatment intentionally mirror the workbook, including its identified inconsistencies.</p>
      </div></section>
    </div>`;
}

async function renderEmployees() {
  const query = encodeURIComponent(state.search);
  const employees = await api(`/api/employees?q=${query}`);
  const financial = canPayroll();
  const root = document.querySelector('#view-root');
  root.innerHTML = `
    ${viewTitle('Employees', 'One employee record feeds salary revisions, attendance, payroll, and payslips.',
      `<input id="employee-search" class="control search" type="search" placeholder="Search by name, ID, department" value="${escapeHtml(state.search)}">
      <button class="button primary" type="button" data-action="new-employee">＋ Add employee</button>`)}
    <section class="panel"><div class="table-wrap"><table><thead><tr>
      <th>Employee</th><th>Department</th><th>Designation</th><th>Joined</th>
      ${financial ? '<th class="numeric">Monthly CTC</th><th>PF / ESIC</th>' : ''}
      <th>Actions</th></tr></thead><tbody>
      ${employees.length ? employees.map((employee) => `<tr>
        <td><a class="primary-cell employee-name-link" href="#employee-detail" data-action="open-employee-detail" data-id="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}</a><div class="secondary-cell">${escapeHtml(employee.id)} · ${escapeHtml(employee.area || '—')}</div></td>
        <td>${escapeHtml(employee.department || '—')}</td><td>${employee.designation ? `<span class="designation-tag">${escapeHtml(employee.designation)}</span>${designationGuideEntry(employee.designation) ? `<div class="secondary-cell">${escapeHtml(designationGuideEntry(employee.designation).description)}</div>` : ''}` : '—'}</td>
        <td>${dateLabel(employee.joining_date)}</td>
        ${financial ? `<td class="numeric">${currency(employee.monthly_ctc)}</td><td>${employee.pf_applicable ? 'PF' : '—'} / ${employee.esic_applicable ? 'ESIC' : '—'}</td>` : ''}
        <td><button class="button small" type="button" data-action="edit-employee" data-id="${escapeHtml(employee.id)}">Edit</button>
        <button class="button small danger" type="button" data-action="delete-employee" data-id="${escapeHtml(employee.id)}">Archive</button></td>
      </tr>`).join('') : `<tr><td colspan="8"><div class="empty-state">No employees found. Add an employee or import the workbook data.</div></td></tr>`}
    </tbody></table></div></section>
    <p class="field-hint">Archived employees remain linked to historical payroll. Salary component amounts are calculated from monthly CTC and the configured rules.</p>`;
  state.employeeRows = employees;
}

function openEmployeeModal(employee = null) {
  const isEdit = Boolean(employee);
  const financial = canPayroll();
  const input = (label, name, value = '', type = 'text', options = {}) => `
    <div class="field ${options.wide ? 'wide' : ''}"><label for="employee-${name}">${escapeHtml(label)}</label>
      <input class="control" id="employee-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${options.required ? 'required' : ''} ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.step ? `step="${options.step}"` : ''} maxlength="${options.maxLength || 200}"></div>`;
  const check = (label, name, value) => `<label class="check-field"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}> ${escapeHtml(label)}</label>`;
  openModal(isEdit ? 'Edit employee' : 'Add employee', `
    <form id="employee-form" data-id="${escapeHtml(employee?.id || '')}">
      <div class="form-grid">
        <div class="form-section-title">Employment details</div>
        ${input('Employee ID', 'id', employee?.id || '', 'text', { required: true, maxLength: 32, wide: true })}
        ${input('Full name', 'name', employee?.name || '', 'text', { required: true })}
        ${input('Department', 'department', employee?.department || '')}
        <div class="field"><label for="employee-designation">Designation</label>
          <input class="control" id="employee-designation" name="designation" type="text" list="salary-desk-designations" value="${escapeHtml(employee?.designation || '')}" maxlength="200">
          ${designationDatalist()}
          <div class="field-hint">Choose a suggested title or enter a custom designation.</div>
        </div>
        ${input('Area / location', 'area', employee?.area || '')}
        ${input('Joining date', 'joining_date', employee?.joining_date || '', 'date')}
        ${input('Relieving date', 'relieving_date', employee?.relieving_date || '', 'date')}
        ${financial ? `<div class="form-section-title">Salary and statutory details</div>
          ${input('Monthly CTC', 'monthly_ctc', employee?.monthly_ctc ?? '0', 'number', { required: true, min: 0, step: '.01' })}
          <div class="field"><label>Applicability</label><div>${check('PF applicable', 'pf_applicable', employee?.pf_applicable)}${check('ESIC applicable', 'esic_applicable', employee?.esic_applicable)}</div></div>
          ${input('PAN', 'pan', employee?.pan || '')}${input('UAN', 'uan', employee?.uan || '')}
          ${input('ESIC number', 'esic_number', employee?.esic_number || '')}${input('Email', 'email', employee?.email || '', 'email')}
          ${input('Bank account', 'bank_account', employee?.bank_account || '')}${input('IFSC', 'ifsc', employee?.ifsc || '')}
          <div class="field-hint wide">Bank and tax identifiers are visible only to administrator/payroll roles.</div>` : ''}
      </div>
    </form>`, `<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="employee-form">Save employee</button>`);
  if (!isEdit) document.querySelector('#employee-id')?.removeAttribute('readonly');
  if (isEdit) document.querySelector('#employee-id').readOnly = true;
}

async function renderRevisions() {
  const [revisions, employees] = await Promise.all([api('/api/revisions'), api('/api/employees')]);
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Salary revisions', 'CTC changes are effective-dated and prorated across the selected payroll month.',
      '<button class="button primary" type="button" data-action="new-revision">＋ Add revision</button>')}
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Effective date</th><th class="numeric">Monthly CTC</th><th>Reason</th><th>Previous CTC</th><th></th></tr></thead><tbody>
    ${revisions.length ? revisions.map((revision) => `<tr><td><div class="primary-cell">${escapeHtml(revision.employee_name)}</div><div class="secondary-cell">${escapeHtml(revision.employee_id)}</div></td>
      <td>${dateLabel(revision.effective_date)}</td><td class="numeric">${currency(revision.monthly_ctc)}</td><td>${escapeHtml(revision.reason || '—')}</td>
      <td class="muted">Calculated from prior revision</td><td><button class="button small danger" type="button" data-action="delete-revision" data-id="${escapeHtml(revision.id)}">Delete</button></td></tr>`).join('')
      : '<tr><td colspan="6"><div class="empty-state">No salary revisions yet.</div></td></tr>'}
    </tbody></table></div></section>`;
  state.employeeRows = employees;
}

function openRevisionModal() {
  const employees = state.employeeRows || [];
  openModal('Add salary revision', `
    <form id="revision-form" class="form-grid">
      <div class="field wide"><label for="revision-employee">Employee</label><select class="control" name="employee_id" id="revision-employee" required><option value="">Select employee</option>
        ${employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)} · ${escapeHtml(employee.id)}</option>`).join('')}</select></div>
      <div class="field"><label for="revision-date">Effective date</label><input class="control" type="date" id="revision-date" name="effective_date" required></div>
      <div class="field"><label for="revision-ctc">New monthly CTC</label><input class="control" type="number" id="revision-ctc" name="monthly_ctc" min="0" step=".01" required></div>
      <div class="field wide"><label for="revision-reason">Reason</label><input class="control" id="revision-reason" name="reason" maxlength="200"></div>
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="revision-form">Save revision</button>');
}

function attendanceDayCell(employee, day, status, choices) {
  const code = status || '';
  const label = code ? (ATTENDANCE_CODE_LABELS[code] || code) : 'No report';
  const cls = code ? `attendance-code-${code}` : '';
  return `<td class="attendance-cell"><select class="control compact ${cls}" aria-label="${escapeHtml(employee.name)} day ${day}" data-employee="${escapeHtml(employee.id)}" data-day="${day}" data-code="${escapeHtml(code)}" title="${escapeHtml(label)} · day ${day}">
    ${choices.map(([c, l]) => `<option value="${c}" ${c === code ? 'selected' : ''}>${l || '—'}</option>`).join('')}
  </select></td>`;
}

async function renderAttendance() {
  const data = await api(`/api/attendance?month=${encodeURIComponent(state.month)}`);
  state.attendance = data;
  state.attendanceDirty = false;
  const choices = [
    ['', '—'], ['P', 'P'], ['R', 'R'], ['A', 'A'], ['CL', 'CL'], ['SL', 'SL'], ['L', 'L'], ['WO', 'WO'], ['H', 'H']
  ];
  const mobile = window.innerWidth < 640;

  const dayHeaders = Array.from({ length: data.daysInMonth }, (_, i) => i + 1);
  const attendanceRows = data.employees.map((employee) => {
    const entry = data.entries.find((item) => item.employeeId === employee.id);
    const cells = entry.days.map((status, index) => attendanceDayCell(employee, index + 1, status, choices)).join('');
    return `<tr><td class="attendance-employee"><div class="primary-cell">${escapeHtml(employee.name)}</div><div class="secondary-cell">${escapeHtml(employee.id)} · ${escapeHtml(employee.department || '—')}</div></td>${cells}</tr>`;
  }).join('');

  const mobileCards = mobile ? `
    <div class="attendance-cards">${data.employees.map((employee) => {
      const entry = data.entries.find((item) => item.employeeId === employee.id);
      const counts = {};
      entry.days.forEach((status) => { counts[status] = (counts[status] || 0) + 1; });
      const summary = Object.entries(counts).map(([code, count]) => `${code || '—'}: ${count}`).join(' · ');
      return `<article class="attendance-card"><div class="attendance-card-head"><div><div class="primary-cell">${escapeHtml(employee.name)}</div><div class="secondary-cell">${escapeHtml(employee.id)} · ${escapeHtml(employee.department || '—')}</div></div><div class="secondary-cell">${summary || 'No data'}</div></div>
        <div class="attendance-day-strip">${entry.days.map((status, index) => `<div class="attendance-day" data-employee="${escapeHtml(employee.id)}" data-day="${index + 1}">
          <div class="attendance-day-label">${index + 1}</div>
          <select class="control shadow compact" aria-label="${escapeHtml(employee.name)} day ${index + 1}" data-employee="${escapeHtml(employee.id)}" data-day="${index + 1}" data-code="${escapeHtml(status)}">
            ${choices.map(([code, label]) => `<option value="${code}" ${code === status ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>`).join('')}
        </div></article>`;
    }).join('')}</div>` : '';

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle(`Attendance · ${state.month}`, 'P marks a paid day; A marks absent. Present fill is automatic for non-weekend days.',
      '<button class="button" type="button" data-action="fill-present-all">＋ Fill weekdays as Present</button><button class="button" type="button" data-action="save-attendance">Save change</button>')}
    <div class="notice">Sundays and paid holidays are prefilled. Unset weekdays default to Present. Tap cells to set leave codes. A is unpaid absent.</div>
    <div class="panel" style="margin-top:14px; overflow-x:auto">` +
    (mobile ? mobileCards : `
      <div class="table-wrap"><table class="attendance-table"><thead><tr><th class="attendance-employee">Employee</th>
        ${dayHeaders.map((day) => `<th class="attendance-head">${day}</th>`).join('')}
      </tr></thead><tbody>${attendanceRows}</tbody></table></div>`) +
    `</div>
    <p class="field-hint">${data.employees.length} employees · ${data.daysInMonth} calendar days. Values save to a single daily attendance ledger shared with payroll.</p>`;
}

async function saveAttendance() {
  const inputs = [...document.querySelectorAll('select[data-employee][data-day]')];
  const entries = inputs.map((select) => ({
    employee_id: select.dataset.employee,
    day: Number(select.dataset.day),
    status: select.value
  }));
  const result = await api('/api/attendance', { method: 'PUT', body: JSON.stringify({ month: state.month, entries }) });
  state.attendanceDirty = false;
  toast(`Saved ${result.saved} attendance entries.`);
  await loadView();
}

const travelStatusLabels = {
  live: 'Tracking',
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected'
};

async function renderTravel() {
  if (managerLiveMapInterval) clearInterval(managerLiveMapInterval);
  managerLiveMap?.remove();
  managerLiveMap = null;
  managerLiveMarkers = new Map();
  const [summary, employees] = await Promise.all([
    api(`/api/travel/employee/${encodeURIComponent(state.employeeId || 'all')}/summary?month=${encodeURIComponent(state.month)}`),
    api('/api/employees')
  ]);
  state.employeeRows = employees;
  const rows = summary.journeys;
  const travelSettings = summary.settings;
  const { ta: travelTa, da: travelDa, payableKm: totalApprovedKm } = summary.travel_allowance;
  const taPerKm = travelSettings.ta_per_km;
  const daDaily = travelSettings.da_daily;
  const minDailyKm = travelSettings.min_daily_km;
  const maxDailyKm = travelSettings.max_daily_km;
  const statusClass = (status) => status === 'approved' ? 'green'
    : status === 'rejected' ? 'red'
      : status === 'live' || status === 'submitted' ? 'amber' : '';
  const routeRows = rows.filter((r) => r.start_lat && r.end_lat);
  const routeMap = routeRows.length ? routeRows.map((row) => {
    const lat = (Number(row.start_lat) + Number(row.end_lat)) / 2;
    const lng = (Number(row.start_lng) + Number(row.end_lng)) / 2;
    const zoom = 12;
    const markers = `color:red|label:S|${Number(row.start_lat)},${Number(row.start_lng)}&color:green|label:E|${Number(row.end_lat)},${Number(row.end_lng)}`;
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=600x200&maptype=roadmap&${markers}&key=AIzaSyB7AWneeUL4Z-iXVcqT-1rftWgUq4dovaM`;
    return `<div class="route-card"><img src="${url}" alt="Route for ${escapeHtml(row.employee_name || row.employee_id)}" loading="lazy">
      <div class="route-card-foot"><strong>${escapeHtml(row.employee_name || row.employee_id)}</strong> · ${dateLabel(row.travel_date)} · ${km(row.gps_distance_km)} km</div></div>`;
  }).join('') : '<div class="empty-state">No routes to display yet. Start a journey with coordinates to see the route map.</div>';
  const liveLocations = await api('/api/travel/live-locations');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Travel', 'Automated field-sales tracking. Journeys auto-calculate KM and TA/DA for payroll.',
      `<button class="button primary" type="button" data-action="track-live">◎ Track live</button>
      <button class="button" type="button" data-action="new-journey">＋ Start journey</button>
      <button class="button" type="button" data-action="get-km-covered">＋ Get KM covered</button>
      <button class="button" type="button" data-action="new-dcr">＋ Add DCR visit</button>
      <button class="button" type="button" data-action="sync-punch-attendance">⇄ Sync punch attendance</button>` +
      `
      <div class="employee-filter-bar" style="margin-top:12px;padding:12px;background:var(--panel-bg);border-radius:8px;">
        <label style="font-size:13px;font-weight:600;color:var(--color-text-muted);margin-right:8px;">Filter by Employee:</label>
        <select id="employee-travel-filter" class="control" style="max-width:250px;">
          <option value="">All Employees</option>
          ${(state.employeeRows || []).map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} (${escapeHtml(e.id)})</option>`).join('')}
        </select>
      </div>`)}
    <section class="panel"><div class="panel-header"><h3 class="panel-title">Travel approvals · ${state.month}</h3>
      <div class="toolbar"><span class="status-pill green">${km(totalApprovedKm)} payable KM</span>
        <span class="muted">TA ${currency(travelTa)} · DA ${currency(travelDa)}</span></div></div>
      <div class="panel-body">
        <div class="live-map-heading">
          <div><h3 class="panel-title">Active employee locations</h3><span class="field-hint">Only active GPS sessions are shown. Updates automatically every 15 seconds.</span></div>
          <span id="live-map-count" class="status-pill">${liveLocations.length} tracking</span>
        </div>
        <div id="manager-live-map" class="manager-live-map map-panel-body" role="region" aria-label="Live employee locations map"></div>
        <div id="manager-live-map-status" class="field-hint" role="status"></div>
      </div>

      <div class="panel-body" style="border-top:1px solid var(--panel-border)">
        <div class="live-map-heading">
          <div><h3 class="panel-title">All employee tracking</h3><span class="field-hint">Every field force employee, classified by current state. Refreshes every 15 seconds.</span></div>
          <div class="tracking-filter" id="tracking-filter">
            <button type="button" class="tracking-filter-btn active" data-track-filter="all">All <b id="track-count-all">—</b></button>
            <button type="button" class="tracking-filter-btn" data-track-filter="live">Live <b id="track-count-live">—</b></button>
            <button type="button" class="tracking-filter-btn" data-track-filter="idle">Idle <b id="track-count-idle">—</b></button>
            <button type="button" class="tracking-filter-btn" data-track-filter="offline">Offline <b id="track-count-offline">—</b></button>
          </div>
        </div>
        <div id="tracking-table-wrap" class="table-wrap"><div class="empty-state">Loading employee tracking…</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>GPS km</th><th>Road km</th><th>Approved km</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.length ? rows.map((row) => `<tr>
          <td><div class="primary-cell">${escapeHtml(row.employee_name || row.employee_id)}</div><div class="secondary-cell">${escapeHtml(row.employee_id)}</div></td>
          <td>${dateLabel(row.travel_date)}</td><td class="numeric">${Number(row.gps_distance_km || 0).toFixed(2)}</td>
          <td class="numeric">${Number(row.road_distance_km || 0).toFixed(2)}</td>
          <td class="numeric primary-cell">${Number(row.approved_distance_km || 0).toFixed(2)}</td>
          <td><span class="status-pill ${statusClass(row.status)}">${travelStatusLabels[row.status] || row.status}</span></td>
          <td>
            ${row.status === 'draft' ? `<button class="button small" type="button" data-action="submit-journey" data-id="${escapeHtml(row.id)}">Submit</button>` : ''}
            ${row.status === 'submitted' ? `<button class="button small" type="button" data-action="approve-journey" data-id="${escapeHtml(row.id)}" data-km="${Number(row.gps_distance_km || row.road_distance_km || 0)}">Approve</button><button class="button small danger" type="button" data-action="reject-journey" data-id="${escapeHtml(row.id)}">Reject</button>` : ''}
            ${row.status === 'draft' ? `<button class="button small danger" type="button" data-action="delete-journey" data-id="${escapeHtml(row.id)}">Delete</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No journeys recorded for this month. Start a journey to log field travel.</div></td></tr>'}
      </tbody></table></div></section>
    <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Route playback</h3>
      <div class="toolbar"><button class="button small" type="button" data-action="toggle-satellite-map">Switch to Satellite</button></div></div>
      <div class="panel-body">
        ${routeRows.length ? `
          <div id="travel-route-map" style="height:300px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px"></div>
          <div class="route-grid">${routeMap}</div>
        ` : '<div class="empty-state">No routes to display yet.</div>'}
      </div></section>
    <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Automated TA/DA preview</h3></div><div class="panel-body">
      <div class="list-row"><span>Total payable KM</span><strong>${km(totalApprovedKm)} km</strong></div>
      <div class="list-row"><span>Travel allowance (${currency(taPerKm)}/km)</span><strong>${currency(travelTa)}</strong></div>
      <div class="list-row"><span>Daily allowance (${currency(daDaily)} per eligible day)</span><strong>${currency(travelDa)}</strong></div>
    </div></section>
    <p class="field-hint">TA is approved payable KM × ${currency(taPerKm)}/km. DA ${currency(daDaily)} is added once per approved employee travel date when daily KM meets the ${km(minDailyKm)} km minimum. Payable distance is capped at ${km(maxDailyKm)} km per employee per date. Approved travel flows into that month’s payroll.</p>`;
  initManagerLiveMap(liveLocations);
  initTravelRouteMap(routeRows);
  renderTrackingPanel();
  if (managerLiveMap) managerLiveMapInterval = setInterval(refreshManagerLiveLocations, 15_000);
}

// Google Maps initialization
function initManagerLiveMap(locations) {
  const container = document.querySelector('#manager-live-map');
  if (!container) return;

  // Check for Google Maps API key
  const keyInput = document.querySelector('script[src*="maps.googleapis.com"]');
  const apiKey = keyInput ? keyInput.src.match(/key=([^&]+)/)?.[1] : null;

  if (!apiKey || apiKey === 'your_api_key') {
    const status = document.querySelector('#manager-live-map-status');
    if (status) status.textContent = 'Google Maps API key not configured. Please set GOOGLE_MAPS_API_KEY in .env.';
    return;
  }

  // Initialize Google Maps
  const mapOptions = {
    center: { lat: 20.5937, lng: 78.9629 },
    zoom: 5,
    mapTypeControl: true,
    streetViewControl: true,
    fullscreenControl: true,
    zoomControl: true,
    styles: [
      { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] }
    ]
  };

  try {
    managerLiveMap = new google.maps.Map(container, mapOptions);

    // Update markers
    updateManagerLiveMarkers(locations, true);

    const status = document.querySelector('#manager-live-map-status');
    if (status && !locations.length) status.textContent = 'No active employee GPS sessions right now.';

    googleMapsLoaded = true;
  } catch (error) {
    console.error('Google Maps initialization failed:', error);
    if (status) status.textContent = 'Failed to load Google Maps. Please check API key.';
  }
}

function updateManagerLiveMarkers(locations, fitBounds = false) {
  if (!managerLiveMap) return;
  const currentIds = new Set(locations.map((location) => location.journey_id));
  for (const [journeyId, marker] of managerLiveMarkers) {
    if (!currentIds.has(journeyId)) {
      marker.remove();
      managerLiveMarkers.delete(journeyId);
    }
  }
  for (const location of locations) {
    if (!Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) continue;
    const position = { lat: Number(location.lat), lng: Number(location.lng) };
    let marker = managerLiveMarkers.get(location.journey_id);
    if (!marker) {
      marker = new google.maps.Marker({
        map: managerLiveMap,
        position,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        },
        title: location.employee_name
      });
      managerLiveMarkers.set(location.journey_id, marker);
    } else {
      marker.setPosition(position);
    }
    marker.addListener('click', () => {
      const info = new google.maps.InfoWindow({
        content: `<strong>${escapeHtml(location.employee_name)}</strong><br>${escapeHtml(location.employee_id)}<br>${dateLabel(location.travel_date)} · ${escapeHtml(location.recorded_at || 'Waiting for first GPS point')}`
      });
      info.open(managerLiveMap, marker);
    });
  }
  const count = document.querySelector('#live-map-count');
  if (count) count.textContent = `${locations.length} tracking`;
  if (fitBounds && managerLiveMarkers.size) {
    const bounds = new google.maps.LatLngBounds();
    for (const marker of managerLiveMarkers.values()) bounds.extend(marker.getPosition());
    managerLiveMap.fitBounds(bounds, 40);
  }
}

async function refreshManagerLiveLocations() {
  if (state.view !== 'travel' || !managerLiveMap) return;
  const status = document.querySelector('#manager-live-map-status');
  try {
    const locations = await api('/api/travel/live-locations');
    updateManagerLiveMarkers(locations);
    if (status) status.textContent = `Last updated ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    if (status) status.textContent = `Could not refresh active locations: ${error.message}`;
  }
  // Refresh the all-employee tracking table in parallel
  if (state.view === 'travel') {
    renderTrackingPanel();
  }
}

// All-employee tracking overview (live / idle / offline)
const trackingStateMeta = {
  live: { label: 'Live', cls: 'green', icon: '●' },
  idle: { label: 'Idle', cls: 'amber', icon: '◐' },
  offline: { label: 'Offline', cls: 'red', icon: '○' }
};

// Employee tracking overview with Google Maps markers
async function renderTrackingPanel() {
  const wrap = document.querySelector('#tracking-table-wrap');
  if (!wrap) return;

  // Fetch tracking data
  let data;
  try {
    data = await api('/api/travel/employee-tracking');
  } catch (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load employee tracking: ${escapeHtml(error.message)}</div>`;
    return;
  }

  // Update global counts
  trackingFilterState = data.counts;

  // Apply state filter (all/live/idle/offline)
  const stateFilter = trackingFilterState?.state || 'all';
  let visibleEmployees = data.employees;
  if (stateFilter !== 'all') {
    visibleEmployees = visibleEmployees.filter(e => e.state === stateFilter);
  }

  // Apply employee filter if set
  if (currentEmployeeFilter) {
    visibleEmployees = visibleEmployees.filter(e => e.employee_id === currentEmployeeFilter);
  }

  // Generate table rows
  const rowHtml = visibleEmployees.map(e => {
    const meta = trackingStateMeta[e.state] || trackingStateMeta.offline;
    const loc = e.lat && e.lng ? `${Number(e.lat).toFixed(4)}, ${Number(e.lng).toFixed(4)}` : '—';
    const lastSeen = e.last_point_at ? `${dateLabel(e.last_point_at)} · ${new Date(e.last_point_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No GPS yet';
    const employeeName = escapeHtml(e.employee_name || e.employee_id);
    const employeeId = escapeHtml(e.employee_id);

    return `<tr>
      <td class="primary-cell">${employeeName}</td>
      <td>${escapeHtml(e.department || '—')}</td>
      <td><span class="status-pill ${meta.cls}">${meta.icon} ${meta.label}</span></td>
      <td class="muted">${escapeHtml(lastSeen)}</td>
      <td class="muted">${escapeHtml(loc)}</td>
      <td class="muted">${e.journey_id ? escapeHtml(e.journey_id.slice(0, 8)) : '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">No employees found</td></tr>';

  // Update table
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Employee</th><th>Department</th><th>State</th><th>Last GPS</th><th>Location</th><th>Journey</th></tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>`;

  // Update filter button counts
  for (const key of ['all', 'live', 'idle', 'offline']) {
    const el = document.getElementById(`track-count-${key}`);
    if (el) el.textContent = trackingFilterState[key] || 0;
  }

  // Refresh Google Map markers if available
  if (googleMapsLoaded && managerLiveMap && data.employees.length > 0) {
    refreshGoogleMapMarkers(data.employees);
  }
}

// Update Google Maps with employee markers
function refreshGoogleMapMarkers(employees) {
  if (!managerLiveMap) return;

  // Clear existing markers
  managerLiveMarkers.forEach(marker => marker.setMap(null));
  managerLiveMarkers.clear();

  const bounds = new google.maps.LatLngBounds();

  employees.forEach(emp => {
    if (!emp.lat || !emp.lng) return;

    const position = { lat: Number(emp.lat), lng: Number(emp.lng) };
    bounds.extend(position);

    // Determine marker color based on state
    let markerColor = '#9CA3AF'; // grey for offline
    if (emp.state === 'live') markerColor = '#3B82F6'; // blue
    else if (emp.state === 'idle') markerColor = '#F59E0B'; // orange

    // Create custom marker with initials
    const marker = new google.maps.Marker({
      position: position,
      map: managerLiveMap,
      title: emp.employee_name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: markerColor,
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
        scale: 12
      }
    });

    // Create info window content
    const infoContent = `
      <div style="padding: 10px; min-width: 200px;">
        <h3 style="margin: 0 0 8px 0; color: #1F2937;">${escapeHtml(emp.employee_name)}</h3>
        <p style="margin: 4px 0; font-size: 13px;"><strong>ID:</strong> ${escapeHtml(emp.employee_id)}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Department:</strong> ${escapeHtml(emp.department || '—')}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Status:</strong> <span style="color: ${markerColor};">●</span> ${emp.state.toUpperCase()}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>GPS:</strong> ${Number(emp.lat).toFixed(4)}, ${Number(emp.lng).toFixed(4)}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Last Update:</strong> ${emp.last_point_at ? new Date(emp.last_point_at).toLocaleString() : 'N/A'}</p>
      </div>
    `;

    const infoWindow = new google.maps.InfoWindow({
      content: infoContent
    });

    marker.addListener('click', () => {
      infoWindow.open(managerLiveMap, marker);
    });

    managerLiveMarkers.set(emp.employee_id, marker);
  });

  // Fit map to all markers
  if (bounds.isEmpty()) {
    managerLiveMap.setCenter({ lat: 20.5937, lng: 78.9629 });
    managerLiveMap.setZoom(5);
  } else {
    managerLiveMap.fitBounds(bounds, { padding: 50 });
  }
}

// Initialize travel route map with all journey routes
function initTravelRouteMap(journeys) {
  const container = document.querySelector('#travel-route-map');
  if (!container || !journeys || !journeys.length) return;
  if (typeof google === 'undefined' || !google.maps) return;

  // Remove existing map if any
  if (window.travelRouteMap) {
    window.travelRouteMap = null;
  }

  const statusColors = {
    'approved': '#10b981',
    'pending': '#f59e0b',
    'rejected': '#ef4444',
    'completed': '#3b82f6',
    'submitted': '#3b82f6',
    'draft': '#94a3b8'
  };

  const bounds = new google.maps.LatLngBounds();
  journeys.forEach(j => {
    if (j.start_lat && j.start_lng) bounds.extend({ lat: Number(j.start_lat), lng: Number(j.start_lng) });
    if (j.end_lat && j.end_lng) bounds.extend({ lat: Number(j.end_lat), lng: Number(j.end_lng) });
  });

  window.travelRouteMap = new google.maps.Map(container, {
    center: { lat: 20.5937, lng: 78.9629 },
    zoom: 5,
    mapTypeControl: true,
    zoomControl: true,
    streetViewControl: false,
    fullscreenControl: true,
    mapTypeId: 'roadmap'
  });

  if (!bounds.isEmpty()) {
    window.travelRouteMap.fitBounds(bounds, 40);
  }

  journeys.forEach((journey) => {
    if (!journey.start_lat || !journey.start_lng) return;
    const color = statusColors[journey.status?.toLowerCase()] || '#3b82f6';
    const label = `${journey.employee_name || journey.employee_id} · ${dateLabel(journey.travel_date)}`;
    const start = { lat: Number(journey.start_lat), lng: Number(journey.start_lng) };
    const end = {
      lat: Number(journey.end_lat || journey.start_lat),
      lng: Number(journey.end_lng || journey.start_lng)
    };

    new google.maps.Polyline({
      map: window.travelRouteMap,
      path: [start, end],
      strokeColor: color,
      strokeWeight: 4,
      strokeOpacity: 0.8
    });

    const makeLetterMarker = (letter, bg) => ({
      path: google.maps.SymbolPath.CIRCLE,
      scale: 14,
      fillColor: bg,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      label: { text: letter, color: '#fff', font: 'bold 10px Arial' }
    });

    const startMarker = new google.maps.Marker({
      map: window.travelRouteMap,
      position: start,
      icon: makeLetterMarker('A', '#10b981'),
      title: `${label} (Start)`
    });
    startMarker.addListener('click', () => {
      const info = new google.maps.InfoWindow({
        content: `<strong>${escapeHtml(label)}</strong><br>Start: ${start.lat.toFixed(4)}, ${start.lng.toFixed(4)}`
      });
      info.open(window.travelRouteMap, startMarker);
    });

    const endMarker = new google.maps.Marker({
      map: window.travelRouteMap,
      position: end,
      icon: makeLetterMarker('B', '#ef4444'),
      title: `${label} (End)`
    });
    endMarker.addListener('click', () => {
      const info = new google.maps.InfoWindow({
        content: `<strong>${escapeHtml(label)}</strong><br>End: ${end.lat.toFixed(4)}, ${end.lng.toFixed(4)}<br>Distance: ${Number(journey.approved_distance_km || journey.gps_distance_km || 0).toFixed(1)} km`
      });
      info.open(window.travelRouteMap, endMarker);
    });
  });
}

function openDcrModal() {
  const date = state.month ? `${state.month}-01` : '';
  openModal('Add DCR visit', `
    <div class="notice">Daily Call Report: log a customer visit with GPS coordinates. KM between consecutive visits is auto-calculated and added to the journey.</div>
    <form id="dcr-form" class="form-grid" style="margin-top:14px">
      <div class="field wide"><label for="dcr-employee">Employee</label>
        <select class="control" id="dcr-employee" name="employee_id" required>
          <option value="">Select employee…</option>
          ${employeesForJourney().map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} · ${escapeHtml(e.id)}</option>`).join('')}
        </select></div>
      <div class="field"><label for="dcr-date">Visit date</label><input class="control" id="dcr-date" name="visit_date" type="date" value="${escapeHtml(date)}" required></div>
      <div class="field wide"><label for="dcr-customer">Customer name</label><input class="control" id="dcr-customer" name="customer_name" placeholder="e.g. Apollo Pharmacy" required></div>
      <div class="field wide"><label for="dcr-location">Address / lat,lng</label><input class="control" id="dcr-location" name="location" placeholder="e.g. 28.6139,77.2090 or Connaught Place" required></div>
      <div class="field wide"><label for="dcr-notes">Visit notes</label><textarea class="control" id="dcr-notes" name="notes" rows="2" placeholder="Sample given, order booked, follow-up date"></textarea></div>
      <div class="field wide"><label for="dcr-order">Order booked (optional)</label><input class="control" id="dcr-order" name="order_value" type="number" min="0" step="any" placeholder="Order value in INR"></div>
    </form>`,
    '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="dcr-form">Save visit</button>');
}

function openJourneyModal(employeeId = '', travelDate = '') {
  const date = travelDate || state.month ? `${state.month}-01` : '';
  const isEmployee = state.user?.role === 'employee';
  const employeeField = isEmployee
    ? `<input type="hidden" name="employee_id" value="${escapeHtml(state.user.employee_id || '')}">`
    : `<div class="field wide"><label for="journey-employee">Employee</label>
        <select class="control" id="journey-employee" name="employee_id" required>
          <option value="">Select employee…</option>
          ${employeesForJourney().map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === employeeId ? 'selected' : ''}>${escapeHtml(e.name)} · ${escapeHtml(e.id)}</option>`).join('')}
        </select></div>`;
  openModal('Start travel journey', `
    <form id="journey-form" class="form-grid">
      ${employeeField}
      <div class="field"><label for="journey-date">Travel date</label><input class="control" id="journey-date" name="travel_date" type="date" value="${escapeHtml(date)}" required></div>
      <div class="field"><label for="journey-start-lat">Start latitude</label><input class="control" id="journey-start-lat" name="start_lat" type="number" step="any" inputmode="decimal" placeholder="e.g. 28.6139" required></div>
      <div class="field"><label for="journey-start-lng">Start longitude</label><input class="control" id="journey-start-lng" name="start_lng" type="number" step="any" inputmode="decimal" placeholder="e.g. 77.2090" required></div>
      <div class="field"><label for="journey-end-lat">End latitude</label><input class="control" id="journey-end-lat" name="end_lat" type="number" step="any" inputmode="decimal" placeholder="e.g. 28.6139" required></div>
      <div class="field"><label for="journey-end-lng">End longitude</label><input class="control" id="journey-end-lng" name="end_lng" type="number" step="any" inputmode="decimal" placeholder="e.g. 77.2090" required></div>
      <div class="field wide"><label for="journey-gps">GPS distance (km)</label><input class="control" id="journey-gps" name="gps_distance_km" type="number" min="0" step="any" value="0"></div>
      <div class="field wide"><label for="journey-road">Road distance (km)</label><input class="control" id="journey-road" name="road_distance_km" type="number" min="0" step="any" value="0"></div>
      <div class="field wide"><label for="journey-notes">Visit notes</label><textarea class="control" id="journey-notes" name="notes" rows="2" placeholder="Customer visits, stops, route notes"></textarea></div>
    </form>`,
    '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="journey-form">Save journey</button>');
}

function employeesForJourney() {
  return (state.employeeRows || []).filter((e) => e.active !== false);
}

async function trackLive() {
  if (!navigator.geolocation) {
    toast('Your device does not support live GPS tracking.', true);
    return;
  }
  const isEmployee = state.user?.role === 'employee';
  let employeeId = state.user?.employee_id || '';
  let employees = [];
  if (!isEmployee) {
    employees = await api('/api/employees');
    state.employeeRows = employees;
    if (!employees.length) {
      toast('No employees available. Add an employee first.', true);
      return;
    }
  }
  if (isEmployee && !employeeId) {
    toast('This employee account is not linked to an employee record. Ask an administrator to link it.', true);
    return;
  }
  openModal('Live GPS tracking', `
    <form id="live-tracking-form" class="form-grid">
      ${isEmployee ? '' : `<div class="field wide"><label for="live-employee">Employee</label>
        <select class="control" id="live-employee" name="employee_id" required>
          <option value="">Select employee…</option>
          ${employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)} · ${escapeHtml(employee.id)}</option>`).join('')}
        </select></div>`}
      <div class="field"><label for="live-date">Travel date</label>
        <input class="control" id="live-date" name="travel_date" type="date" value="${localDateIso()}" required></div>
      <div class="notice wide">The journey is saved as soon as GPS starts. Your live location is visible to authorized admin/payroll users while tracking; stop tracking when the journey is complete.</div>
      <div id="live-status" class="field-hint wide" role="status">Start tracking to request device location.</div>
      <div id="live-distance" class="primary-cell wide">0.00 km</div>
    </form>`,
  '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="live-tracking-form">Start tracking</button>',
  true);
  document.querySelector('#modal-root .modal')?.classList.add('live-tracking-modal');
  if (isEmployee) await beginLiveTracking(employeeId, localDateIso());
}

async function beginLiveTracking(employeeId, travelDate) {
  const status = document.querySelector('#live-status');
  const startButton = document.querySelector('[form="live-tracking-form"]');
  if (startButton) startButton.disabled = true;
  if (status) status.textContent = 'Requesting GPS location…';
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      });
    });
    const startPoint = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    const journey = await api('/api/employee/travel/live', {
      method: 'POST',
      body: JSON.stringify({
        action: 'start',
        employee_id: employeeId,
        travel_date: travelDate,
        start_lat: startPoint.lat,
        start_lng: startPoint.lng
      })
    });
    liveTracking = {
      journeyId: journey.journeyId,
      employeeId,
      startPoint,
      lastPoint: startPoint,
      currentPoint: startPoint,
      distanceKm: 0,
      routePoints: [startPoint],
      watchId: null,
      pointInterval: null,
      stopwatchStart: Date.now(),
      lastReportedPoint: Date.now(),
      stoppageDetected: false,
      reportMs: 10000 // send route point every 10 seconds
    };
    // Render the enhanced tracking view with a live map
    const form = document.querySelector('#live-tracking-form');
    if (form) {
      form.innerHTML = `
        <div class="notice wide">GPS tracking is active. Keep this page open while travelling; stop tracking when the journey is complete.</div>
        <div id="live-map" class="employee-live-map" role="region" aria-label="Your live GPS route map"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div id="live-status" class="field-hint" role="status">Tracking started</div>
          <div id="live-distance" class="primary-cell">0.00 km</div>
          <div id="live-speed" class="field-hint">0 km/h</div>
          <div id="live-elapsed" class="field-hint">0 min</div>
        </div>
        <div id="live-stoppage-alert" class="notice warning" style="display:none">⚠️ Stoppage detected — no movement for 5+ minutes</div>`;
    }
    // Init Google Maps live tracking map
    initLiveMap();
    // Start periodic route-point reporting
    liveTracking.pointInterval = setInterval(sendRoutePoint, liveTracking.reportMs);
    // Update elapsed time every second
    liveTracking.stopwatchStart = Date.now();
    liveTracking.elapsedInterval = setInterval(updateElapsed, 1000);
    const footer = document.querySelector('.modal-footer');
    if (footer) footer.innerHTML = `<button class="button danger" type="button" data-action="stop-live">Stop and submit</button>`;
    // Listen for position updates
    liveTracking.watchId = navigator.geolocation.watchPosition((nextPosition) => {
      if (!liveTracking) return;
      const previousPoint = liveTracking.lastPoint;
      const point = {
        lat: nextPosition.coords.latitude,
        lng: nextPosition.coords.longitude,
        accuracy: nextPosition.coords.accuracy,
        speed_kmh: Math.max(0, nextPosition.coords.speed * 3.6 || 0),
        heading_deg: nextPosition.coords.heading || 0
      };
      liveTracking.distanceKm += haversineKmClient(
        liveTracking.lastPoint.lat,
        liveTracking.lastPoint.lng,
        point.lat,
        point.lng
      );
      liveTracking.lastPoint = point;
      liveTracking.currentPoint = point;
      liveTracking.routePoints.push(point);
      updateLiveDisplay(point);
      updateLiveMap(point, previousPoint);
    }, (error) => {
      const message = document.querySelector('#live-status');
      if (message) message.textContent = `GPS update issue: ${error.message}`;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    toast('Live GPS tracking started. Route points are being recorded automatically.');
  } catch (error) {
    if (status) status.textContent = `Could not start tracking: ${error.message}`;
    if (startButton) startButton.disabled = false;
    throw new Error(`Could not start live tracking: ${error.message}`);
  }
}

function initLiveMap() {
  if (!liveTracking) return;
  const container = document.querySelector('#live-map');
  if (!container) return;
  if (typeof google === 'undefined' || !google.maps) {
    const status = document.querySelector('#live-status');
    if (status) status.textContent = 'The map library did not load. GPS tracking is still active; reload to restore the map.';
    return;
  }
  const start = liveTracking.startPoint;
  const map = new google.maps.Map(container, {
    center: { lat: start.lat, lng: start.lng },
    zoom: 15,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    mapTypeId: 'roadmap'
  });

  const circleIcon = (color, size, stroke) => ({
    path: google.maps.SymbolPath.CIRCLE,
    scale: size,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: stroke
  });

  new google.maps.Marker({
    map, position: { lat: start.lat, lng: start.lng },
    icon: circleIcon('#10b981', 7, 2), title: 'Start'
  });

  liveTracking._map = map;
  liveTracking._routeLines = [];
  liveTracking._endMarker = new google.maps.Marker({
    map, position: { lat: start.lat, lng: start.lng },
    icon: circleIcon('#ef4444', 7, 2), title: 'Current'
  });
  liveTracking._currentMarker = new google.maps.Marker({
    map, position: { lat: start.lat, lng: start.lng },
    icon: circleIcon('#3b82f6', 9, 3), title: 'You are here'
  });
}

function updateLiveMap(point, previousPoint) {
  if (!liveTracking || !liveTracking._map) return;
  const map = liveTracking._map;
  if (liveTracking._routeLines.length > 0) {
    const lastLine = liveTracking._routeLines[liveTracking._routeLines.length - 1];
    const path = lastLine.getPath();
    path.push({ lat: point.lat, lng: point.lng });
  } else {
    const line = new google.maps.Polyline({
      map,
      path: [
        { lat: previousPoint.lat, lng: previousPoint.lng },
        { lat: point.lat, lng: point.lng }
      ],
      strokeColor: '#3b82f6',
      strokeWeight: 4,
      strokeOpacity: 0.8
    });
    liveTracking._routeLines.push(line);
  }
  liveTracking._currentMarker.setPosition({ lat: point.lat, lng: point.lng });
  liveTracking._endMarker.setPosition({ lat: point.lat, lng: point.lng });
  map.setCenter({ lat: point.lat, lng: point.lng });
}

function updateLiveDisplay(point) {
  const dist = document.querySelector('#live-distance');
  if (dist) dist.textContent = `${liveTracking.distanceKm.toFixed(2)} km`;
  const speed = document.querySelector('#live-speed');
  if (speed) speed.textContent = `${point.speed_kmh.toFixed(1)} km/h`;
}

function updateElapsed() {
  if (!liveTracking) return;
  const el = document.querySelector('#live-elapsed');
  if (el) {
    const mins = Math.round((Date.now() - liveTracking.stopwatchStart) / 60000);
    el.textContent = `${mins} min`;
  }
  // Auto-detect stoppage (speed ~0 for 5+ minutes)
  const elapsedMin = (Date.now() - liveTracking.stopwatchStart) / 60000;
  if (liveTracking.lastPoint.speed_kmh < 1 && elapsedMin > 5 && !liveTracking.stoppageDetected) {
    liveTracking.stoppageDetected = true;
    const alert = document.querySelector('#live-stoppage-alert');
    if (alert) alert.style.display = 'block';
  }
}

async function sendRoutePoint() {
  if (!liveTracking) return;
  const now = Date.now();
  if (now - liveTracking.lastReportedPoint < liveTracking.reportMs) return;
  liveTracking.lastReportedPoint = now;
  const point = liveTracking.currentPoint;
  const sent = await api('/api/travel/route-points', {
    method: 'POST',
    body: JSON.stringify({
      journey_id: liveTracking.journeyId,
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy,
      speed_kmh: point.speed_kmh,
      heading_deg: point.heading_deg || 0
    })
  }).catch((err) => {
    const status = document.querySelector('#live-status');
    if (status) status.textContent = `Failed to send route point: ${err.message}`;
    return null;
  });
  if (sent) {
    const status = document.querySelector('#live-status');
    if (status) status.textContent = `Point sent · ${liveTracking.routePoints.length} pts · ${liveTracking.distanceKm.toFixed(2)} km`;
  }
}

async function stopLiveTracking() {
  if (!liveTracking) return;
  const tracking = liveTracking;
  // Send final route point before stopping
  if (tracking.currentPoint && tracking.routePoints.length > 0) {
    await api('/api/travel/route-points', {
      method: 'POST',
      body: JSON.stringify({
        journey_id: tracking.journeyId,
        lat: tracking.currentPoint.lat,
        lng: tracking.currentPoint.lng,
        accuracy: tracking.currentPoint.accuracy,
        speed_kmh: tracking.currentPoint.speed_kmh || 0,
        heading_deg: tracking.currentPoint.heading_deg || 0
      })
    }).catch(() => null);
  }
  if (tracking.watchId !== null) navigator.geolocation.clearWatch(tracking.watchId);
  if (tracking.pointInterval) clearInterval(tracking.pointInterval);
  if (tracking.elapsedInterval) clearInterval(tracking.elapsedInterval);
  const result = await api('/api/employee/travel/live', {
    method: 'POST',
    body: JSON.stringify({
      action: 'stop',
      journey_id: tracking.journeyId,
      end_lat: tracking.currentPoint.lat,
      end_lng: tracking.currentPoint.lng,
      gps_distance_km: tracking.distanceKm,
      road_distance_km: tracking.distanceKm,
      route_points: tracking.routePoints.map((p) => ({ lat: p.lat, lng: p.lng }))
    })
  });
  liveTracking = null;
  closeModal();
  toast(`Journey submitted for approval · ${tracking.distanceKm.toFixed(2)} km · ${tracking.routePoints.length} GPS points recorded.`);
  if (state.view === 'my-travel' || state.view === 'travel') await loadView();
}

function openKmCoveredModal() {
  const date = state.month ? `${state.month}-01` : '';
  const isEmployee = state.user?.role === 'employee';
  const employeeField = isEmployee
    ? `<input type="hidden" name="employee_id" value="${escapeHtml(state.user.employee_id || '')}">`
    : `<div class="field wide"><label for="km-employee">Employee</label>
        <select class="control" id="km-employee" name="employee_id" required>
          <option value="">Select employee…</option>
          ${employeesForJourney().map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} · ${escapeHtml(e.id)}</option>`).join('')}
        </select></div>`;
  openModal('Get KM covered', `
    <div class="notice">Enter start and end points. The straight-line (Haversine) distance is computed as the KM covered. Coordinates can be pasted directly or resolved from an address via a free geocoding service.</div>
    <form id="km-form" class="form-grid" style="margin-top:14px">
      ${employeeField}
      <div class="field"><label for="km-date">Travel date</label><input class="control" id="km-date" name="travel_date" type="date" value="${escapeHtml(date)}" required></div>
      <div class="field wide"><label for="km-start">Start address / lat,lng</label><input class="control" id="km-start" name="start_address" placeholder="e.g. 28.6139,77.2090 or Delhi"></div>
      <div class="field wide"><label for="km-end">End address / lat,lng</label><input class="control" id="km-end" name="end_address" placeholder="e.g. 28.7041,77.1025 or Noida"></div>
      <div class="field wide"><label for="km-notes">Notes</label><textarea class="control" id="km-notes" name="notes" rows="2" placeholder="Customer visits, stops, route notes"></textarea></div>
      <div class="field wide"><div id="km-result" style="color:var(--muted); font-size:12px;">Distance will be shown here after you enter both points.</div></div>
    </form>`,
    '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="km-form">Save journey with KM</button>');
}

async function geocodeAddress(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const latLngMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (latLngMatch) return { lat: Number(latLngMatch[1]), lng: Number(latLngMatch[2]) };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=AIzaSyB7AWneeUL4Z-iXVcqT-1rftWgUq4dovaM`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status !== 'OK' || !data.results.length) return null;
  return { lat: data.results[0].geometry.location.lat, lng: data.results[0].geometry.location.lng };
}

function haversineKmClient(lat1, lng1, lat2, lng2) {
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function renderPayroll() {
  const result = await api(`/api/payroll?month=${encodeURIComponent(state.month)}`);
  const rows = result.rows;
  const sumFinal = rows.reduce((sum, row) => sum + row.finalPayable, 0);
  const actions = `<select class="control status-select" id="payroll-status">
      ${['draft', 'review', 'approved', 'paid'].map((status) => `<option value="${status}" ${status === result.status ? 'selected' : ''}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join('')}
    </select>
    <button class="button" type="button" data-action="save-payroll-status">Save status</button>
    <a class="button" href="/api/reports/payroll.csv?month=${encodeURIComponent(state.month)}">Export CSV</a>`;
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle(`Payroll · ${state.month}`, `${rows.length} employees · final payable total ${currency(sumFinal)} · calculations refresh from saved records.`,
      actions)}
    <div class="notice warning">Exact workbook behavior is retained: net payable subtracts employer PF and ESIC too, and the salary-slip section repeats those deductions. See the Excel formula map before approving a run.</div>
    <section class="panel" style="margin-top:14px"><div class="table-wrap"><table><thead><tr>
      <th>Employee</th><th class="numeric">Paid days</th><th class="numeric">CTC</th><th class="numeric">Gross</th>
      <th class="numeric">Employee PF</th><th class="numeric">Employee ESIC</th><th class="numeric">Employer PF</th><th class="numeric">Employer ESIC</th>
      <th>Travel TA/DA</th><th>Other TA/DA</th><th>Additional items</th><th>Advance</th>
      <th class="numeric">Net payable</th><th class="numeric">Final payable</th><th></th>
    </tr></thead><tbody>
      ${rows.length ? rows.map((row) => `<tr data-payroll-row="${escapeHtml(row.employeeId)}">
        <td><div class="primary-cell">${escapeHtml(row.employeeName)}</div><div class="secondary-cell">${escapeHtml(row.employeeId)} · ${escapeHtml(row.payrollStatus)}</div></td>
        <td class="numeric">${row.paidDays} / ${row.daysInMonth}</td>
        <td class="numeric">${currency(row.ctc)}</td><td class="numeric">${currency(row.gross)}</td>
        <td class="numeric">${currency(row.employeePf)}</td><td class="numeric">${currency(row.employeeEsic)}</td>
        <td class="numeric">${currency(row.employerPf)}</td><td class="numeric">${currency(row.employerEsic)}</td>
        <td class="numeric"><div>${currency(row.travelTa)} TA</div><div>${currency(row.travelDa)} DA</div><strong>${currency(row.travelTotal)}</strong></td>
        <td><input class="control compact" type="number" min="0" step=".01" value="${row.reimbursement}" data-field="reimbursement" aria-label="Other TA and DA for ${escapeHtml(row.employeeName)}">
          <div class="field-hint">Combined TA/DA: ${currency(row.reimbursement + row.travelTotal)}</div></td>
        <td><div class="payroll-custom-items">
          ${(row.customItems || []).map((item) => `<div class="payroll-custom-item">
            <span>${escapeHtml(item.label)} · ${item.kind === 'earning' ? 'earning' : 'deduction'}${item.recurring ? ' · monthly' : ''}</span>
            <strong>${currency(item.amount)}</strong>
            <button class="button small danger" type="button" data-action="delete-payroll-item" data-id="${escapeHtml(item.id)}" data-recurring="${item.recurring}" aria-label="${item.recurring ? 'Stop' : 'Remove'} ${escapeHtml(item.label)}">${item.recurring ? 'Stop' : 'Remove'}</button>
          </div>`).join('') || '<span class="muted">No extra items</span>'}
          <button class="button small" type="button" data-action="new-payroll-item" data-id="${escapeHtml(row.employeeId)}">＋ Add item</button>
          <div class="field-hint">Earnings ${currency(row.customEarnings)} · Deductions ${currency(row.customDeductions)}</div>
        </div></td>
        <td><input class="control compact" type="number" min="0" step=".01" value="${row.advanceDeduction}" data-field="advance_deduction" aria-label="Advance deduction for ${escapeHtml(row.employeeName)}"></td>
        <td class="numeric">${currency(row.netPayable)}</td><td class="numeric primary-cell">${currency(row.finalPayable)}</td>
        <td><button class="button small" type="button" data-action="save-adjustment">Save inputs</button>
          <button class="button small" type="button" data-action="show-slip" data-id="${escapeHtml(row.employeeId)}">Payslip</button></td>
      </tr>`).join('') : '<tr><td colspan="15"><div class="empty-state">No active employees. Add an employee to start payroll.</div></td></tr>'}
    </tbody></table></div></section>
    <p class="field-hint">Approved travel TA/DA is calculated from approved distance and dates. Other TA/DA and custom earnings are added after the workbook net-pay floor; custom deductions are then subtracted. Recurring custom items apply from their start month through the month they are stopped.</p>`;
}

async function openPayrollItemModal(employeeId) {
  const components = await api('/api/payroll/components');
  openModal('Add payroll item', `
    <form id="payroll-item-form" class="form-grid" data-employee-id="${escapeHtml(employeeId)}">
      <div class="field wide"><label for="payroll-item-component">Reusable field</label>
        <select class="control" id="payroll-item-component" name="component_id">
          <option value="">Create a new field</option>
          ${components.map((component) => `<option value="${escapeHtml(component.id)}" data-label="${escapeHtml(component.label)}" data-kind="${escapeHtml(component.kind)}">${escapeHtml(component.label)} · ${component.kind}</option>`).join('')}
        </select></div>
      <div class="field"><label for="payroll-item-label">Field name</label><input class="control" id="payroll-item-label" name="label" maxlength="80" required></div>
      <div class="field"><label for="payroll-item-kind">Type</label><select class="control" id="payroll-item-kind" name="kind"><option value="earning">Earning</option><option value="deduction">Deduction</option></select></div>
      <div class="field"><label for="payroll-item-amount">Amount</label><input class="control" id="payroll-item-amount" name="amount" type="number" min="0" step=".01" required></div>
      <div class="field"><label for="payroll-item-frequency">Apply</label><select class="control" id="payroll-item-frequency" name="recurring"><option value="false">This payroll month only</option><option value="true">Every month from this month</option></select></div>
      <label class="check-field wide"><input type="checkbox" name="save_reusable"> Save this field for reuse in future payrolls</label>
      <div class="notice wide">Monthly items apply to this employee from ${escapeHtml(state.month)} through the month they are stopped. Custom items adjust final payable after the workbook net-pay calculation.</div>
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="payroll-item-form">Save item</button>');
  document.querySelector('#payroll-item-label').value = '';
}

async function savePayrollItem(form) {
  const values = formValues(form);
  const componentId = values.component_id;
  const item = {
    month: state.month,
    employee_id: form.dataset.employeeId,
    amount: Number(values.amount),
    recurring: values.recurring === 'true',
    save_reusable: form.elements.save_reusable.checked
  };
  if (componentId) {
    item.component_id = componentId;
  } else {
    item.label = values.label;
    item.kind = values.kind;
  }
  await api('/api/payroll/items', { method: 'POST', body: JSON.stringify(item) });
  closeModal();
  toast(item.recurring ? 'Recurring payroll item saved.' : 'Payroll item saved.');
  await loadView();
}

async function saveAdjustment(button) {
  const row = button.closest('[data-payroll-row]');
  const body = {
    month: state.month,
    employee_id: row.dataset.payrollRow,
    reimbursement: Number(row.querySelector('[data-field="reimbursement"]').value || 0),
    advance_deduction: Number(row.querySelector('[data-field="advance_deduction"]').value || 0)
  };
  await api('/api/payroll/adjustments', { method: 'PUT', body: JSON.stringify(body) });
  toast('Payroll inputs saved; calculations updated.');
  await loadView();
}

async function showSlip(employeeId) {
  const slip = await api(`/api/slip?month=${encodeURIComponent(state.month)}&employee_id=${encodeURIComponent(employeeId)}`);
  const company = slip.company || {};
  const showPaidDays = company.payslip_show_paid_days !== '0';
  const showLeaveDays = company.payslip_show_leave_days !== '0';
  const showAttendanceSummary = company.payslip_show_attendance_summary !== '0';
  const showAutoGenerated = company.payslip_auto_generated_notice !== '0';
  const footerText = company.payslip_footer_text || 'This is a computer-generated payslip and does not require a signature.';
  const authorizedSignatory = company.payslip_authorized_signatory || '';

  openModal(`Payslip · ${slip.month}`, `
    <article class="slip">
      <header class="slip-header">
        <div>
          <div class="slip-company">${escapeHtml(company.company_name || 'Salary statement')}</div>
          <div class="slip-title">Confidential · ${escapeHtml(slip.month)}</div>
          ${company.company_address ? `<div class="slip-address">${escapeHtml(company.company_address).replace(/\n/g, '<br>')}</div>` : ''}
        </div>
        <strong>${escapeHtml(slip.employee.id)}</strong>
      </header>
      <div class="slip-meta">
        <div><strong>Employee</strong>${escapeHtml(slip.employee.name)}</div>
        <div><strong>Employee ID</strong>${escapeHtml(slip.employee.id)}</div>
        <div><strong>Department</strong>${escapeHtml(slip.employee.department || '—')}</div>
        <div><strong>Designation</strong>${escapeHtml(slip.employee.designation || '—')}</div>
        <div><strong>Joining date</strong>${dateLabel(slip.employee.joiningDate)}</div>
        <div><strong>Relieving date</strong>${dateLabel(slip.employee.relievingDate)}</div>
        <div><strong>PAN</strong>${escapeHtml(slip.employee.pan || '—')}</div>
        <div><strong>UAN</strong>${escapeHtml(slip.employee.uan || '—')}</div>
        <div><strong>ESIC number</strong>${escapeHtml(slip.employee.esicNumber || '—')}</div>
        <div><strong>Email</strong>${escapeHtml(slip.employee.email || '—')}</div>
        <div><strong>Bank account</strong>${escapeHtml(slip.employee.bankAccount || '—')}</div>
        <div><strong>IFSC</strong>${escapeHtml(slip.employee.ifsc || '—')}</div>
        <div><strong>Month</strong>${escapeHtml(slip.month)}</div>
        ${showPaidDays && slip.paidDays !== undefined ? `<div><strong>Paid Days</strong>${slip.paidDays} / ${slip.daysInMonth}</div>` : ''}
        ${showLeaveDays && slip.leaveDays !== undefined ? `<div><strong>Leave Days</strong>${slip.leaveDays}</div>` : ''}
        ${showAttendanceSummary && slip.absentDays !== undefined ? `
          <div><strong>Absent Days</strong>${slip.absentDays}</div>
          <div><strong>Present Days</strong>${slip.presentReportedDays}</div>
          <div><strong>Weekly Off</strong>${slip.weeklyOffDays}</div>
          <div><strong>Holidays</strong>${slip.holidayDays}</div>
        ` : ''}
        ${company.company_pan ? `<div><strong>Company PAN</strong>${escapeHtml(company.company_pan)}</div>` : ''}
        ${company.company_tan ? `<div><strong>Company TAN</strong>${escapeHtml(company.company_tan)}</div>` : ''}
        ${company.company_gstin ? `<div><strong>Company GSTIN</strong>${escapeHtml(company.company_gstin)}</div>` : ''}
      </div>
      <div class="slip-columns">
        <section><h3>Salary details</h3>${slip.earnings.map(([label, amount]) => `<div class="slip-item"><span>${escapeHtml(label)}</span><strong>${currency(amount)}</strong></div>`).join('')}</section>
        <section><h3>Deductions</h3>${slip.deductions.map(([label, amount]) => `<div class="slip-item"><span>${escapeHtml(label)}</span><strong>${currency(amount)}</strong></div>`).join('')}
          <div class="slip-item slip-total"><span>Total deduction</span><strong>${currency(slip.totalDeduction)}</strong></div>
          <div class="slip-item"><span>Net payable</span><strong>${currency(slip.netPayable)}</strong></div>
          <div class="slip-item"><span>TA &amp; DA</span><strong>${currency(slip.reimbursement)}</strong></div>
        </section>
      </div>
      <div class="slip-final"><span>Final payable</span><span>${currency(slip.finalPayable)}</span></div>
      ${authorizedSignatory ? `<div class="slip-signatory"><strong>Authorized Signatory</strong><br>${escapeHtml(authorizedSignatory)}</div>` : ''}
      <p class="field-hint">${showAutoGenerated ? '🔹 This is an automatically generated payslip. ' : ''}${footerText}</p>
    </article>`,
    '<button class="button" type="button" data-action="close-modal">Close</button><button class="button primary" type="button" data-action="print-slip">Print / Save PDF</button>',
    true);
}

async function renderHolidays() {
  const holidays = await api(`/api/holidays?year=${encodeURIComponent(state.month.slice(0, 4))}`);
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle(`Holiday list · ${state.month.slice(0, 4)}`, 'Paid holidays prefill the attendance calendar and count toward paid days.',
      '<button class="button primary" type="button" data-action="new-holiday">＋ Add holiday</button>')}
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Holiday / function</th><th>Paid holiday?</th><th></th></tr></thead><tbody>
      ${holidays.length ? holidays.map((holiday) => `<tr><td>${dateLabel(holiday.holiday_date)}</td><td class="primary-cell">${escapeHtml(holiday.name)}</td>
        <td><span class="status-pill ${holiday.paid ? 'green' : ''}">${holiday.paid ? 'Paid' : 'Unpaid'}</span></td>
        <td><button class="button small danger" type="button" data-action="delete-holiday" data-id="${escapeHtml(holiday.id)}">Delete</button></td></tr>`).join('')
        : '<tr><td colspan="4"><div class="empty-state">No holidays configured for this year.</div></td></tr>'}
    </tbody></table></div></section>`;
}

function openHolidayModal() {
  const row = (date = '', name = '', paid = true) => `
    <div class="holiday-row" style="display:grid; grid-template-columns: 130px 1fr auto; gap:8px; align-items:end; margin-bottom:8px;">
      <div class="field"><input class="control" type="date" name="holiday_date" value="${escapeHtml(date)}" required></div>
      <div class="field"><input class="control" name="name" maxlength="120" placeholder="Holiday / function" value="${escapeHtml(name)}" required></div>
      <div style="display:flex; gap:6px; align-items:center;">
        <label class="check-field" style="white-space:nowrap;"><input type="checkbox" name="paid" ${paid ? 'checked' : ''}> Paid</label>
        <button type="button" class="button small danger" data-action="remove-holiday-row" style="min-height:30px;">Remove</button>
      </div>
    </div>`;
  const rows = [row()];
  openModal('Add holidays', `
    <div class="notice">Add one or more holidays at once. Dates with the same name are merged on save; paid holidays prefill the attendance calendar.</div>
    <form id="holiday-form" style="margin-top:14px">
      <div id="holiday-rows">${rows.join('')}</div>
      <button type="button" class="button" data-action="add-holiday-row" style="margin-top:8px;">＋ Add another holiday</button>
    </form>`,
    '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="holiday-form">Save holidays</button>');
}

function holidayRows() {
  return [...document.querySelectorAll('#holiday-rows .holiday-row')];
}

function addHolidayRow() {
  const rows = holidayRows();
  const last = rows[rows.length - 1];
  const date = last ? last.querySelector('[name="holiday_date"]').value : '';
  const name = last ? last.querySelector('[name="name"]').value : '';
  document.querySelector('#holiday-rows').insertAdjacentHTML('beforeend',
    `<div class="holiday-row" style="display:grid; grid-template-columns: 130px 1fr auto; gap:8px; align-items:end; margin-bottom:8px;">
      <div class="field"><input class="control" type="date" name="holiday_date" value="${escapeHtml(date)}" required></div>
      <div class="field"><input class="control" name="name" maxlength="120" placeholder="Holiday / function" value="${escapeHtml(name)}" required></div>
      <div style="display:flex; gap:6px; align-items:center;">
        <label class="check-field" style="white-space:nowrap;"><input type="checkbox" name="paid" checked> Paid</label>
        <button type="button" class="button small danger" data-action="remove-holiday-row" style="min-height:30px;">Remove</button>
      </div>
    </div>`);
}

function removeHolidayRow(button) {
  const row = button.closest('.holiday-row');
  if (row) row.remove();
}

async function renderSettings() {
  const [{ settings, examples }, travelSettings, companySettings, approvalWorkflows] = await Promise.all([
    api('/api/settings'),
    api('/api/travel-settings'),
    api('/api/company-settings'),
    api('/api/approval-workflows')
  ]);
  const sections = [
    ['Salary components', ['basic_pct', 'hra_pct', 'bonus_pct']],
    ['Statutory deductions', ['pf_rate', 'pf_wage_cap', 'pf_ctc_threshold', 'esic_employee_rate', 'esic_employer_rate', 'esic_wage_cap', 'professional_tax']],
    ['CTC-to-gross formula', ['ctc_factor_both', 'ctc_factor_pf_below', 'ctc_factor_pf_above', 'ctc_factor_esic_below', 'ctc_factor_esic_above']]
  ];
  const settingsTabs = ['approvals', 'payroll', 'travel', 'company'];
  if (!settingsTabs.includes(state.settingsTab)) state.settingsTab = 'approvals';
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Rule settings', 'These editable constants are observed in workbook formulas. Changes immediately affect recalculated payroll.',
      '<button class="button primary" type="button" data-action="save-settings">Save rules</button>')}
    <div class="settings-tabs" role="tablist" aria-label="Rule settings sections">
      <button type="button" role="tab" class="settings-tab ${state.settingsTab === 'approvals' ? 'active' : ''}" id="settings-tab-approvals" data-settings-tab="approvals" aria-controls="settings-panel-approvals" aria-selected="${state.settingsTab === 'approvals'}" tabindex="${state.settingsTab === 'approvals' ? '0' : '-1'}">Approval workflows</button>
      <button type="button" role="tab" class="settings-tab ${state.settingsTab === 'payroll' ? 'active' : ''}" id="settings-tab-payroll" data-settings-tab="payroll" aria-controls="settings-panel-payroll" aria-selected="${state.settingsTab === 'payroll'}" tabindex="${state.settingsTab === 'payroll' ? '0' : '-1'}">Payroll rules</button>
      <button type="button" role="tab" class="settings-tab ${state.settingsTab === 'travel' ? 'active' : ''}" id="settings-tab-travel" data-settings-tab="travel" aria-controls="settings-panel-travel" aria-selected="${state.settingsTab === 'travel'}" tabindex="${state.settingsTab === 'travel' ? '0' : '-1'}">Travel</button>
      <button type="button" role="tab" class="settings-tab ${state.settingsTab === 'company' ? 'active' : ''}" id="settings-tab-company" data-settings-tab="company" aria-controls="settings-panel-company" aria-selected="${state.settingsTab === 'company'}" tabindex="${state.settingsTab === 'company' ? '0' : '-1'}">Company &amp; payslip</button>
    </div>
    <section class="settings-tab-panel" id="settings-panel-approvals" role="tabpanel" aria-labelledby="settings-tab-approvals" tabindex="0" data-settings-panel="approvals" ${state.settingsTab === 'approvals' ? '' : 'hidden'}>
      ${approvalWorkflows.map(renderApprovalWorkflowSettings).join('')}
    </section>
    <section class="settings-tab-panel" id="settings-panel-payroll" role="tabpanel" aria-labelledby="settings-tab-payroll" tabindex="0" data-settings-panel="payroll" ${state.settingsTab === 'payroll' ? '' : 'hidden'}>
      <div class="notice warning">The 50% wage add-back is zero in the workbook, and employer contributions are subtracted in net-pay formulas. These defaults are intentionally preserved.</div>
      ${sections.map(([title, keys]) => `<section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">${escapeHtml(title)}</h3></div><div class="panel-body"><div class="settings-grid">
      ${keys.map((key) => `<div class="rule-card"><div class="field"><label for="setting-${key}">${escapeHtml(settingLabels[key])}</label>
        <input class="control" type="number" min="0" step="any" id="setting-${key}" data-setting="${key}" value="${settings[key]}"></div>
        <div class="field-hint">${escapeHtml(settingsHelp[key])} ${key.endsWith('_pct') || key.endsWith('_rate') ? 'Enter a fraction: 0.50 means 50%.' : ''} ${examples[key] ? `<br><strong>Example:</strong> ${escapeHtml(examples[key])}` : ''}</div></div>`).join('')}
    </div></div></section>`).join('')}
    <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Reference-only workbook values</h3></div><div class="panel-body">
      <div class="list-row"><span>50% wage rule</span><strong>${(settings.statutory_wage_pct * 100).toFixed(0)}% · not used to calculate an add-back</strong></div>
      <div class="list-row"><span>Excess add-back</span><strong>${currency(settings.statutory_wage_addback)} · source formula returns zero</strong></div>
    </div></section>
    </section>
    <section class="settings-tab-panel" id="settings-panel-travel" role="tabpanel" aria-labelledby="settings-tab-travel" tabindex="0" data-settings-panel="travel" ${state.settingsTab === 'travel' ? '' : 'hidden'}>
    <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Travel allowance (TA/DA)</h3></div><div class="panel-body"><div class="settings-grid">
      ${travelSettingsCard('ta_per_km', 'TA per approved KM', 'Reimbursement per approved kilometre (INR).', travelSettings.ta_per_km)}
      ${travelSettingsCard('da_daily', 'Daily DA', 'Daily allowance added when the journey is approved (INR).', travelSettings.da_daily)}
      ${travelSettingsCard('min_daily_km', 'Minimum daily KM', 'Minimum approved KM required to trigger the daily DA.', travelSettings.min_daily_km)}
      ${travelSettingsCard('max_daily_km', 'Maximum daily KM', 'Maximum payable KM per day; excess is not reimbursed.', travelSettings.max_daily_km)}
      ${travelSettingsCard('road_vs_gps_tolerance', 'Road / GPS tolerance', 'Road distance may exceed GPS distance by at most this factor.', travelSettings.road_vs_gps_tolerance)}
      ${travelSettingsCard('gps_accuracy_m', 'GPS accuracy (m)', 'GPS readings worse than this (in metres) are rejected.', travelSettings.gps_accuracy_m)}
      ${travelSettingsCard('min_speed_kmh', 'Speed flag (km/h)', 'Speed above this (KM/h) flags a suspicious GPS jump.', travelSettings.min_speed_kmh)}
    </div></div></section>
    </section>
    <section class="settings-tab-panel" id="settings-panel-company" role="tabpanel" aria-labelledby="settings-tab-company" tabindex="0" data-settings-panel="company" ${state.settingsTab === 'company' ? '' : 'hidden'}>
    <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Company & Payslip Configuration</h3>
      <button class="button primary" type="button" data-action="save-company-settings">Save company settings</button></div><div class="panel-body"><div class="settings-grid">
      <div class="rule-card"><div class="field"><label for="company-company_name">Company Name</label>
        <input class="control" type="text" id="company-company_name" data-company-setting="company_name" value="${escapeHtml(companySettings.company_name || 'Your Company Name')}"></div>
        <div class="field-hint">Name displayed on payslips</div></div>
      <div class="rule-card"><div class="field"><label for="company-company_address">Company Address</label>
        <textarea class="control" id="company-company_address" data-company-setting="company_address" rows="3" style="min-height:60px;">${escapeHtml(companySettings.company_address || '')}</textarea></div>
        <div class="field-hint">Address displayed on payslips (multiline)</div></div>
      <div class="rule-card"><div class="field"><label for="company-company_pan">Company PAN</label>
        <input class="control" type="text" id="company-company_pan" data-company-setting="company_pan" value="${escapeHtml(companySettings.company_pan || '')}"></div>
        <div class="field-hint">Company PAN displayed on payslips</div></div>
      <div class="rule-card"><div class="field"><label for="company-company_tan">Company TAN</label>
        <input class="control" type="text" id="company-company_tan" data-company-setting="company_tan" value="${escapeHtml(companySettings.company_tan || '')}"></div>
        <div class="field-hint">Company TAN displayed on payslips</div></div>
      <div class="rule-card"><div class="field"><label for="company-company_gstin">Company GSTIN</label>
        <input class="control" type="text" id="company-company_gstin" data-company-setting="company_gstin" value="${escapeHtml(companySettings.company_gstin || '')}"></div>
        <div class="field-hint">Company GSTIN displayed on payslips</div></div>
      <div class="rule-card"><div class="field"><label for="company-payslip_footer_text">Footer Text</label>
        <input class="control" type="text" id="company-payslip_footer_text" data-company-setting="payslip_footer_text" value="${escapeHtml(companySettings.payslip_footer_text || 'This is a computer-generated payslip and does not require a signature.')}"></div>
        <div class="field-hint">Footer text on payslips</div></div>
      <div class="rule-card"><div class="field"><label for="company-payslip_authorized_signatory">Authorized Signatory</label>
        <input class="control" type="text" id="company-payslip_authorized_signatory" data-company-setting="payslip_authorized_signatory" value="${escapeHtml(companySettings.payslip_authorized_signatory || '')}"></div>
        <div class="field-hint">Authorized signatory name (optional)</div></div>
      <div class="rule-card"><div class="field"><label for="company-payslip_currency_symbol">Currency Symbol</label>
        <input class="control" type="text" id="company-payslip_currency_symbol" data-company-setting="payslip_currency_symbol" value="${escapeHtml(companySettings.payslip_currency_symbol || '₹')}"></div>
        <div class="field-hint">Currency symbol for payslip amounts</div></div>
    </div><div class="settings-grid" style="margin-top:14px;">
      <label class="check-field"><input type="checkbox" id="company-payslip_show_paid_days" data-company-setting="payslip_show_paid_days" ${companySettings.payslip_show_paid_days !== '0' ? 'checked' : ''}> Show Paid Days / Total Days</label>
      <label class="check-field"><input type="checkbox" id="company-payslip_show_leave_days" data-company-setting="payslip_show_leave_days" ${companySettings.payslip_show_leave_days !== '0' ? 'checked' : ''}> Show Leave Days</label>
      <label class="check-field"><input type="checkbox" id="company-payslip_show_attendance_summary" data-company-setting="payslip_show_attendance_summary" ${companySettings.payslip_show_attendance_summary !== '0' ? 'checked' : ''}> Show Attendance Summary (Absent, Present, Weekly Off, Holidays)</label>
      <label class="check-field"><input type="checkbox" id="company-payslip_auto_generated_notice" data-company-setting="payslip_auto_generated_notice" ${companySettings.payslip_auto_generated_notice !== '0' ? 'checked' : ''}> Show "Automatically Generated Payslip" Notice</label>
    </div></div></section>
    </section>
    <p class="field-hint">Configure only rules approved by your payroll owner. The workbook's formula constants and the application do not provide legal or tax advice.</p>
    ${renderApprovalHierarchyReference()}`;
}

const APPROVAL_DESIGNATION_GUIDE = [
  { title: 'Super Admin/HR Admin', description: 'Head Office - complete system administration', aliases: ['super admin / hr admin', 'super admin', 'hr admin'] },
  { title: 'Department Head', description: 'Department supervision and review' },
  { title: 'Regional Manager', description: 'Regional team management' },
  { title: 'Area Manager', description: 'Area-level employee supervision' },
  { title: 'Employee', description: 'Punch-in, punch-out, leave and expense submission', aliases: ['employee / field executive'] },
  { title: 'Field Executive', description: 'Punch-in, punch-out, leave and expense submission' },
  { title: 'Administrator', description: 'Administrator designation; account permissions are managed separately' }
];

function designationGuideEntry(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return APPROVAL_DESIGNATION_GUIDE.find((entry) =>
    entry.title.toLowerCase() === normalized || entry.aliases?.includes(normalized)
  ) || null;
}

function designationDatalist() {
  return `<datalist id="salary-desk-designations">${APPROVAL_DESIGNATION_GUIDE.map((entry) => `<option value="${escapeHtml(entry.title)}"></option>`).join('')}</datalist>`;
}

function renderApprovalHierarchyReference() {
  return `<section class="panel approval-hierarchy-reference" style="margin-top:14px">
    <div class="panel-header"><div><h3 class="panel-title">Designation hierarchy reference</h3>
      <div class="field-hint">Suggested designation titles and descriptions. This reference does not configure or enable approval steps.</div></div></div>
    <div class="panel-body"><ul class="approval-hierarchy-list">
      ${APPROVAL_DESIGNATION_GUIDE.map((entry) => `<li>
        <strong>${escapeHtml(entry.title)}</strong><div class="field-hint">${escapeHtml(entry.description)}</div>
      </li>`).join('')}
    </ul>${designationDatalist()}</div>
  </section>`;
}

function approvalWorkflowLevelRow(type, level = {}) {
  const designation = level.designation_required || level.level_name || '';
  const source = level.approver_source || (designation ? 'designation' : 'assigned_role');
  const accessRoles = [
    ['super_admin', 'Super Admin'], ['hr_admin', 'HR Admin'], ['department_head', 'Department Head'],
    ['regional_manager', 'Regional Manager'], ['area_manager', 'Area Manager'],
    ['finance', 'Finance'], ['employee', 'Employee / Field Executive']
  ];
  return `<div class="approval-workflow-row" data-approval-level>
    <div class="field"><label>Approver source</label><select class="control" data-level-source>
      <option value="assigned_role" ${source === 'assigned_role' ? 'selected' : ''}>Functional account role</option>
      <option value="designation" ${source === 'designation' ? 'selected' : ''}>Employee designation</option>
      <option value="reporting_manager" ${source === 'reporting_manager' ? 'selected' : ''}>Reporting manager</option>
      <option value="hierarchy" ${source === 'hierarchy' ? 'selected' : ''}>Organization hierarchy</option>
    </select></div>
    <div class="field"><label>Account role</label><select class="control" data-level-role>
      <option value="">No role requirement</option>${accessRoles.map(([value, title]) =>
        `<option value="${value}" ${level.role_required === value ? 'selected' : ''}>${title}</option>`
      ).join('')}
    </select></div>
    <div class="field"><label>Designation</label><input class="control" data-level-designation list="salary-desk-designations" maxlength="100" value="${escapeHtml(level.designation_required || '')}" placeholder="Choose a designation">
      <div class="field-hint">Optional unless the source is Employee designation.</div></div>
    <div class="field"><label>Minimum hierarchy level</label><input class="control" data-level-hierarchy type="number" min="1" max="5" step="1" value="${escapeHtml(level.min_hierarchy_level ?? '')}" placeholder="Optional"></div>
    ${type === 'expense' ? `<div class="field"><label>Minimum amount</label><input class="control" data-level-minimum-amount type="number" min="0" step="0.01" value="${escapeHtml(level.minimum_amount ?? '')}" placeholder="No minimum"></div>
    <div class="field"><label>Maximum amount</label><input class="control" data-level-maximum-amount type="number" min="0" step="0.01" value="${escapeHtml(level.maximum_amount ?? '')}" placeholder="No maximum"></div>` : ''}
    <label class="check-field"><input type="checkbox" data-level-auto ${level.auto_approve ? 'checked' : ''}> Auto-approve</label>
    <button class="button small danger" type="button" data-action="remove-approval-step" data-type="${type}">Remove step</button>
  </div>`;
}

function approvalWorkflowDiagramMarkup(levels) {
  return levels.length ? levels.map((step, index) => {
      const designation = step.designation_required || step.role_required || step.level_name;
      const guide = designationGuideEntry(designation);
      return `${index ? '<span class="approval-flow-arrow" aria-hidden="true">↓</span>' : ''}
        <div class="approval-flow-node" role="listitem">
          <strong>${escapeHtml(designation)}</strong>
          ${step.minimum_amount != null || step.maximum_amount != null ? `<span>Amount: ${step.minimum_amount == null ? 'any' : escapeHtml(step.minimum_amount)}–${step.maximum_amount == null ? 'up' : escapeHtml(step.maximum_amount)}</span>` : ''}
          ${guide ? `<span>${escapeHtml(guide.description)}</span>` : ''}
          ${step.auto_approve ? '<span>Auto-approved</span>' : ''}
        </div>`;
    }).join('') : '<p class="empty-approval-steps field-hint">No approval steps configured. Add designation steps to create this workflow.</p>';
}

function renderApprovalWorkflowDiagram(workflow) {
  return `<div class="approval-flow-diagram" data-approval-flow-diagram="${workflow.request_type}" role="list" aria-label="${escapeHtml(workflow.name)}">
    ${approvalWorkflowDiagramMarkup(workflow.levels || [])}
  </div>`;
}

function updateApprovalWorkflowDiagram(type) {
  const container = document.querySelector(`[data-approval-levels="${CSS.escape(type)}"]`);
  const diagram = document.querySelector(`[data-approval-flow-diagram="${CSS.escape(type)}"]`);
  if (!container || !diagram) return;
  const levels = [...container.querySelectorAll('[data-approval-level]')].map((row) => {
    const designation = row.querySelector('[data-level-designation]').value.trim();
    return {
      level_name: designation || row.querySelector('[data-level-role]').value || row.querySelector('[data-level-source]').value,
      approver_source: row.querySelector('[data-level-source]').value,
      role_required: row.querySelector('[data-level-role]').value || null,
      designation_required: designation,
      min_hierarchy_level: row.querySelector('[data-level-hierarchy]').value || null,
      minimum_amount: row.querySelector('[data-level-minimum-amount]')?.value || null,
      maximum_amount: row.querySelector('[data-level-maximum-amount]')?.value || null,
      auto_approve: row.querySelector('[data-level-auto]').checked
    };
  });
  diagram.innerHTML = approvalWorkflowDiagramMarkup(levels);
}

function renderApprovalWorkflowSettings(workflow) {
  const canEdit = canAccessModule('rule-settings', 'manage');
  return `<section class="panel approval-workflow-panel" style="margin-top:14px">
    <div class="panel-header"><div><h3 class="panel-title">${escapeHtml(workflow.name)}</h3><div class="field-hint">${escapeHtml(workflow.description || '')}</div></div>
      ${canEdit ? `<div class="toolbar"><button class="button secondary" type="button" data-action="add-approval-step" data-type="${workflow.request_type}">Add step</button><button class="button primary" type="button" data-action="save-approval-workflow" data-type="${workflow.request_type}">Save workflow</button></div>` : ''}
    </div>
    <div class="panel-body"><p class="field-hint">Steps run from top to bottom. Choose a designation for each approval step. Account role permissions remain separate. An empty workflow has no default approvers and blocks new submissions.</p>
      ${renderApprovalWorkflowDiagram(workflow)}
      <div class="approval-workflow-steps" data-approval-levels="${workflow.request_type}">
        ${(workflow.levels || []).map((level) => approvalWorkflowLevelRow(workflow.request_type, level)).join('') || '<div class="empty-approval-steps field-hint">No approval steps configured.</div>'}
      </div>
    </div>
  </section>`;
}

async function saveApprovalWorkflow(type) {
  const container = document.querySelector(`[data-approval-levels="${CSS.escape(type)}"]`);
  const levels = [...(container?.querySelectorAll('[data-approval-level]') || [])].map((row) => ({
    level_name: row.querySelector('[data-level-designation]').value.trim()
      || row.querySelector('[data-level-role]').value
      || row.querySelector('[data-level-source]').value,
    approver_source: row.querySelector('[data-level-source]').value,
    role_required: row.querySelector('[data-level-role]').value || null,
    designation_required: row.querySelector('[data-level-designation]').value.trim() || null,
    min_hierarchy_level: row.querySelector('[data-level-hierarchy]').value || null,
    minimum_amount: row.querySelector('[data-level-minimum-amount]')?.value || null,
    maximum_amount: row.querySelector('[data-level-maximum-amount]')?.value || null,
    auto_approve: row.querySelector('[data-level-auto]').checked
  }));
  await api(`/api/approval-workflows/${encodeURIComponent(type)}/levels`, {
    method: 'PUT',
    body: JSON.stringify({ levels })
  });
  toast(`${type === 'expense' ? 'Expense' : 'Attendance'} approval workflow saved.`);
  await loadView();
}

function travelSettingsCard(key, label, explanation, value) {
  return `<div class="rule-card"><div class="field"><label for="travel-${key}">${escapeHtml(label)}</label>
    <input class="control" type="number" min="0" step="any" id="travel-${key}" data-travel-setting="${key}" value="${value}"></div>
    <div class="field-hint">${escapeHtml(explanation)}</div></div>`;
}

async function saveSettings() {
  const body = Object.fromEntries([...document.querySelectorAll('[data-setting]')].map((input) => [input.dataset.setting, Number(input.value)]));
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
  toast('Payroll rules saved. Payroll and payslips will recalculate.');
  await loadView();
}

async function saveTravelSettings() {
  const body = Object.fromEntries([...document.querySelectorAll('[data-travel-setting]')].map((input) => [input.dataset.travelSetting, Number(input.value)]));
  await api('/api/travel-settings', { method: 'PUT', body: JSON.stringify(body) });
  toast('Travel settings saved. Approved journeys and payroll will recalculate.');
  await loadView();
}

async function saveCompanySettings() {
  const body = Object.fromEntries([...document.querySelectorAll('[data-company-setting]')].map((input) => {
    if (input.type === 'checkbox') {
      return [input.dataset.companySetting, input.checked ? '1' : '0'];
    }
    return [input.dataset.companySetting, input.value];
  }));
  await api('/api/company-settings', { method: 'PUT', body: JSON.stringify(body) });
  toast('Company & payslip settings saved.');
  await loadView();
}

function openAccessRoleModal(roleData, role = null) {
  const permissions = new Set((role?.permissions || []).map((permission) => `${permission.module}:${permission.action}`));
  const locked = role?.code === 'super_admin';
  const moduleRows = Object.entries(roleData.modules || {}).map(([module, label]) => `
    <tr><th scope="row">${escapeHtml(label)}</th>${(roleData.actions || []).map((action) => {
      const checked = permissions.has(`${module}:${action}`);
      return `<td><input type="checkbox" name="permission" value="${escapeHtml(`${module}:${action}`)}" aria-label="${escapeHtml(`${label} ${action}`)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}></td>`;
    }).join('')}</tr>`).join('');
  openModal(role ? `Edit ${escapeHtml(role.name)}` : 'Create functional role', `
    <form id="access-role-form" class="form-grid" data-id="${escapeHtml(role?.id || '')}" data-code="${escapeHtml(role?.code || '')}">
      ${role ? '' : `<div class="field"><label for="access-role-code">Role code</label><input class="control" id="access-role-code" name="code" pattern="[a-z][a-z0-9_]{1,39}" maxlength="40" required><span class="field-hint">Use a unique lowercase code, for example department_coordinator.</span></div>`}
      <div class="field"><label for="access-role-name">Role name</label><input class="control" id="access-role-name" name="name" maxlength="80" value="${escapeHtml(role?.name || '')}" required></div>
      <div class="field"><label for="access-role-description">Description</label><input class="control" id="access-role-description" name="description" maxlength="300" value="${escapeHtml(role?.description || '')}"></div>
      ${role ? `<label class="check-field"><input type="checkbox" name="is_active" ${role.is_active ? 'checked' : ''} ${role.code === 'super_admin' ? 'disabled' : ''}> Active</label>` : ''}
      <div class="field wide"><h3>Module permissions</h3><div class="table-wrap"><table class="permission-matrix"><thead><tr><th>Module</th>${(roleData.actions || []).map((action) => `<th>${escapeHtml(action)}</th>`).join('')}</tr></thead><tbody>${moduleRows}</tbody></table></div></div>
      ${locked ? '<p class="field-hint wide">Super Admin grants cannot be changed.</p>' : ''}
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="access-role-form">Save role</button>');
}

function openAssignAccessRolesModal(user, roleData) {
  const selected = new Set(String(user.access_roles || '').split(',').filter(Boolean));
  const options = (roleData.roles || []).filter((role) => role.is_active).map((role) =>
    `<label class="check-field"><input type="checkbox" name="role_id" value="${escapeHtml(role.id)}" ${selected.has(role.code) ? 'checked' : ''}> ${escapeHtml(role.name)}</label>`
  ).join('');
  openModal(`Assign roles to ${escapeHtml(user.username)}`, `
    <form id="access-assignment-form" class="form-grid" data-id="${escapeHtml(user.id)}">
      <p class="field-hint wide">Select one or more active functional roles. The account role remains separate.</p>
      <div class="field wide">${options}</div>
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="access-assignment-form">Save assignment</button>');
}

async function renderUsers() {
  if (!['users', 'roles', 'organization', 'audit'].includes(state.accessTab)) state.accessTab = 'users';
  const [users, roleData] = await Promise.all([
    api('/api/users'),
    api('/api/access/roles')
  ]);
  let content = '';
  if (state.accessTab === 'users') {
    content = renderAccessUsers(users);
  } else if (state.accessTab === 'roles') {
    content = renderAccessRoles(roleData);
  } else if (state.accessTab === 'organization') {
    const employees = await api('/api/access/organization');
    content = renderOrganizationEditor(employees);
  } else {
    const auditRows = await api('/api/access/audit?limit=100');
    content = renderAccessAudit(auditRows);
  }
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Access control', 'Use separate accounts and grant only the access needed for each role.',
      '<button class="button primary" type="button" data-action="new-user">＋ Add user</button>')}
    <div class="settings-tabs" role="tablist" aria-label="Access control sections">
      ${[['users', 'Users'], ['roles', 'Roles & permissions'], ['organization', 'Organization'], ['audit', 'Access audit']].map(([key, label]) =>
        `<button type="button" role="tab" class="settings-tab ${state.accessTab === key ? 'active' : ''}" data-action="set-access-tab" data-tab="${key}" aria-selected="${state.accessTab === key}">${label}</button>`
      ).join('')}
    </div>
    ${content}`;
}

function renderAccessUsers(users) {
  return `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Username</th><th>Account role</th><th>Functional roles</th><th>Designation</th><th>Recovery email</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${users.map((user) => {
      const designation = designationGuideEntry(user.designation);
      return `<tr><td class="primary-cell">${escapeHtml(user.username)}</td><td>${escapeHtml(roleTitle(user.role))}</td>
        <td>${String(user.access_roles || '').split(',').filter(Boolean).map(accessRoleTitle).map(escapeHtml).join(', ') || '—'}</td>
        <td>${user.designation ? `<span class="designation-tag">${escapeHtml(user.designation)}</span>${designation ? `<div class="secondary-cell">${escapeHtml(designation.description)}</div>` : ''}` : '—'}</td>
        <td>${user.has_recovery_email ? 'Configured' : 'Not set'}</td><td>${user.is_active ? 'Active' : 'Inactive'}</td><td><div class="toolbar"><button class="button small" type="button" data-action="assign-access-roles" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" data-access-roles="${escapeHtml(user.access_roles || '')}">Assign roles</button><button class="button small" type="button" data-action="toggle-user-active" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" data-active="${user.is_active ? 'true' : 'false'}" ${user.id === state.user?.id ? 'disabled' : ''}>${user.is_active ? 'Deactivate' : 'Activate'}</button><button class="button small" type="button" data-action="set-recovery-email" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}" data-has-email="${user.has_recovery_email ? 'true' : 'false'}">Recovery email</button><button class="button small" type="button" data-action="reset-user-password" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">Reset password</button>${user.id === state.user?.id ? '' : `<button class="button small danger" type="button" data-action="remove-user" data-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">Remove</button>`}</div></td></tr>`;
    }).join('')}
    </tbody></table></div></section>
    <div class="panel" style="margin-top:16px"><div class="panel-header"><h3 class="panel-title">Backup and recovery</h3></div><div class="panel-body">
      <p class="view-description">Download a JSON backup for recovery or import an Excel workbook converted by the included openpyxl script.</p>
      <div class="toolbar" style="margin-top:14px">
        <button class="button" type="button" data-action="download-backup">Download JSON backup</button>
        <label class="button" for="restore-file">Restore JSON backup</label><input hidden type="file" id="restore-file" accept=".json,application/json">
        <label class="button" for="workbook-import-file">Import converted workbook JSON</label><input hidden type="file" id="workbook-import-file" accept=".json,application/json">
      </div>
      <p class="field-hint">Imports update matching employee IDs and dates. Download a backup first; workbook import does not delete records that are absent from the source file.</p>
    </div></div>`;
}

function renderAccessRoles(roleData) {
  return `<section class="panel">
    <div class="panel-header"><div><h3 class="panel-title">Functional roles</h3><div class="field-hint">Account roles identify the login type; functional roles grant module and action permissions.</div></div>
      <button class="button primary" type="button" data-action="edit-access-role">Create role</button></div>
    <div class="table-wrap"><table><thead><tr><th>Role</th><th>Code</th><th>Users</th><th>Permissions</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${(roleData.roles || []).map((role) => `<tr>
        <td class="primary-cell">${escapeHtml(role.name)}${role.is_system ? '<div class="secondary-cell">System role</div>' : ''}</td>
        <td>${escapeHtml(role.code)}</td><td>${Number(role.assigned_users || 0)}</td>
        <td>${role.permissions.length} grants</td><td>${role.is_active ? 'Active' : 'Inactive'}</td>
        <td><div class="toolbar"><button class="button small" type="button" data-action="edit-access-role" data-id="${escapeHtml(role.id)}">Edit</button><button class="button small" type="button" data-action="duplicate-access-role" data-id="${escapeHtml(role.id)}" data-name="${escapeHtml(role.name)}">Duplicate</button></div></td>
      </tr>`).join('')}
    </tbody></table></div>
  </section>`;
}

function renderOrganizationEditor(employees) {
  const employeeOptions = employees.map((employee) =>
    `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)} · ${escapeHtml(employee.id)}</option>`
  ).join('');
  return `<section class="panel"><div class="panel-header"><div><h3 class="panel-title">Organizational hierarchy</h3><div class="field-hint">Assign department, region, area and reporting manager. Reporting cycles are rejected.</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Designation</th><th>Department</th><th>Region</th><th>Area</th><th>Reports to</th><th>Level</th><th></th></tr></thead><tbody>
      ${employees.map((employee) => `<tr><td class="primary-cell">${escapeHtml(employee.name)}<div class="secondary-cell">${escapeHtml(employee.id)}</div></td>
        <td><input class="control" data-org-designation list="salary-desk-designations" value="${escapeHtml(employee.designation || '')}" aria-label="Designation for ${escapeHtml(employee.name)}"></td>
        <td><input class="control" data-org-department value="${escapeHtml(employee.department || '')}" aria-label="Department for ${escapeHtml(employee.name)}"></td>
        <td><input class="control" data-org-region value="${escapeHtml(employee.region || '')}" aria-label="Region for ${escapeHtml(employee.name)}"></td>
        <td><input class="control" data-org-area value="${escapeHtml(employee.area || '')}" aria-label="Area for ${escapeHtml(employee.name)}"></td>
        <td><select class="control" data-org-manager aria-label="Reporting manager for ${escapeHtml(employee.name)}"><option value="">No manager</option>${employees.filter((candidate) => candidate.id !== employee.id).map((candidate) =>
          `<option value="${escapeHtml(candidate.id)}" ${candidate.id === employee.reports_to ? 'selected' : ''}>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.id)}</option>`
        ).join('')}</select></td>
        <td><input class="control" data-org-level type="number" min="1" max="5" step="1" value="${escapeHtml(employee.hierarchy_level ?? '')}" aria-label="Hierarchy level for ${escapeHtml(employee.name)}"></td>
        <td><button class="button small" type="button" data-action="save-organization" data-id="${escapeHtml(employee.id)}">Save</button></td></tr>`).join('')}
    </tbody></table></div>${designationDatalist()}</section>`;
}

function renderAccessAudit(rows) {
  return `<section class="panel"><div class="panel-header"><div><h3 class="panel-title">Access audit</h3><div class="field-hint">Recent role, account, organization and approval actions.</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Changes</th></tr></thead><tbody>
      ${rows.map((entry) => `<tr><td>${escapeHtml(entry.created_at)}</td><td>${escapeHtml(entry.actor_username)}</td><td>${escapeHtml(entry.action)}</td>
        <td>${escapeHtml(entry.target_type)} ${escapeHtml(entry.target_id || '')}</td>
        <td><details><summary>View</summary><pre>${escapeHtml(JSON.stringify({ old: entry.old_values, new: entry.new_values }, null, 2))}</pre></details></td></tr>`).join('') || '<tr><td colspan="5">No audit entries yet.</td></tr>'}
    </tbody></table></div>
  </section>`;
}

function openUserModal() {
  openModal('Create workspace user', `
    <form id="user-form" class="form-grid">
      <div class="field"><label for="user-name">Username</label><input class="control" id="user-name" name="username" maxlength="80" required></div>
      <div class="field"><label for="user-role">Role</label><select class="control" id="user-role" name="role"><option value="employee">Employee (self-service only)</option><option value="hr">HR manager</option><option value="payroll">Payroll manager</option><option value="admin">Administrator</option></select></div>
      <div class="field wide" id="user-access-role-field"><label for="user-access-role">Functional role</label><select class="control" id="user-access-role" name="access_role_code"><option value="employee">Employee / Field Executive</option><option value="area_manager">Area Manager</option><option value="regional_manager">Regional Manager</option><option value="department_head">Department Head</option></select><span class="field-hint">Functional permissions are separate from the account role. The employee role is retained for self-service access.</span></div>
      <div class="field wide" id="user-employee-field" style="display:none;"><label for="user-employee">Employee ID</label><select class="control" id="user-employee" name="employee_id"><option value="">Select employee...</option></select><span class="field-hint">Required for employee role. The employee's designation is managed on their employee record and is used by designation-based approval workflows.</span></div>
      <div class="field wide"><label for="user-recovery-email">Recovery email</label><input class="control" id="user-recovery-email" name="recovery_email" type="email" maxlength="254" autocomplete="email"><span class="field-hint">Optional. Used only for password recovery and verification codes.</span></div>
      <div class="field wide"><label for="user-password">Temporary password</label><input class="control" id="user-password" name="password" type="password" minlength="12" maxlength="200" required><span class="field-hint">At least 12 characters. Share this password securely and ask the user to rotate it outside this demo workflow.</span></div>
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="user-form">Create user</button>');

  // Load employees for the dropdown
  api('/api/employees').then((employees) => {
    const select = document.querySelector('#user-employee');
    if (select) {
      select.innerHTML = '<option value="">Select employee...</option>' + employees.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} (${escapeHtml(e.id)})${e.designation ? ` - ${escapeHtml(e.designation)}` : ''}</option>`).join('');
    }
  }).catch((error) => {
    toast('Could not load employee list: ' + error.message, true);
  });

  // Show/hide employee field based on role
  const roleSelect = document.querySelector('#user-role');
  const empField = document.querySelector('#user-employee-field');
  const employeeSelect = document.querySelector('#user-employee');
  const accessRoleField = document.querySelector('#user-access-role-field');
  if (roleSelect && empField) {
    const updateEmployeeFieldVisibility = () => {
      const isEmployee = roleSelect.value === 'employee';
      empField.style.display = isEmployee ? 'block' : 'none';
      if (employeeSelect) employeeSelect.required = isEmployee;
      if (accessRoleField) accessRoleField.style.display = isEmployee ? 'block' : 'none';
    };
    roleSelect.addEventListener('change', updateEmployeeFieldVisibility);
    updateEmployeeFieldVisibility();
  }
}

function openRecoveryEmailModal(userId, username, hasRecoveryEmail) {
  openModal(`Recovery email for ${escapeHtml(username)}`, `
    <form id="recovery-email-form" class="form-grid" data-id="${escapeHtml(userId)}">
      <div class="field wide"><label for="recovery-email">Recovery email</label><input class="control" id="recovery-email" name="recovery_email" type="email" maxlength="254" autocomplete="email"><span class="field-hint">${hasRecoveryEmail ? 'A recovery email is currently configured. Enter a new address to replace it, or leave this blank to clear it.' : 'No recovery email is configured. Enter an address to enable email password recovery.'}</span></div>
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="recovery-email-form">Save email</button>');
}

function openResetUserPasswordModal(userId, username) {
  openModal(`Reset password for ${escapeHtml(username)}`, `
    <form id="user-password-reset-form" class="form-grid" data-id="${escapeHtml(userId)}">
      <div class="field wide"><label for="user-new-password">Temporary password</label><input class="control" id="user-new-password" name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required><span class="field-hint">At least 12 characters. Share it securely; the user must sign in again on all devices and should change it after signing in.</span></div>
      <div class="field wide"><label for="user-confirm-password">Confirm temporary password</label><input class="control" id="user-confirm-password" name="confirm_password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></div>
    </form>`, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="user-password-reset-form">Reset password</button>');
}

async function renderProfileModal() {
  const user = state.user;
  if (!user) return;

  const surfaceOptions = Object.entries(styleFilterLabels.surface).map(([value, label]) =>
    `<button type="button" class="style-filter-option ${stylePrefs.surface === value ? 'active' : ''}" data-key="surface" data-val="${value}">${label}</button>`
  ).join('');

  const uiStyleOptions = Object.entries(styleFilterLabels.uiStyle).map(([value, label]) =>
    `<button type="button" class="style-filter-option ${stylePrefs.uiStyle === value ? 'active' : ''}" data-key="uiStyle" data-val="${value}">${label}</button>`
  ).join('');

  const bgMotionOptions = Object.entries(styleFilterLabels.bgMotion).map(([value, label]) =>
    `<button type="button" class="style-filter-option ${stylePrefs.bgMotion === value ? 'active' : ''}" data-key="bgMotion" data-val="${value}">${label}</button>`
  ).join('');

  const motionHoverOptions = Object.entries(styleFilterLabels.motionHover).map(([value, label]) =>
    `<button type="button" class="style-filter-option ${stylePrefs.motionHover === value ? 'active' : ''}" data-key="motionHover" data-val="${value}">${label}</button>`
  ).join('');

  const speedOptions = Object.entries(styleFilterLabels.speed).map(([value, label]) =>
    `<button type="button" class="style-filter-option small ${stylePrefs.speed === value ? 'active' : ''}" data-key="speed" data-val="${value}">${label}</button>`
  ).join('');

  const cornersOptions = Object.entries(styleFilterLabels.corners).map(([value, label]) =>
    `<button type="button" class="style-filter-option ${stylePrefs.corners === value ? 'active' : ''}" data-key="corners" data-val="${value}">${label}</button>`
  ).join('');

  const paletteOptions = Array.from({ length: 15 }, (_, i) => i + 1).map(num =>
    `<button type="button" class="palette-option ${stylePrefs.palette === num ? 'active' : ''}" data-palette="${num}">
      <div class="palette-color" style="background:hsl(${getComputedStyle(document.documentElement).getPropertyValue(`--palette-${num}-hsl`).trim()})"></div>
      <div class="palette-name">${['1. Ocean Depth','2. Seafoam','3. Soft Teal','4. Misty Blue','5. Sky Whisper','6. Forest Canopy','7. Moss Stone','8. Terracotta Clay','9. Warm Sand','10. Desert Dusk','11. Midnight Ink','12. Electric Violet','13. Neon Coral','14. Mint Pulse','15. Golden Hour'][num-1]}</div>
    </button>`
  ).join('');

  openModal('Profile Settings', `
    <div class="profile-modal">
      <div class="profile-modal-section">
        <h3>Your Account</h3>
        <div class="profile-details">
          <div class="profile-avatar-large">${escapeHtml(user.username.slice(0, 2).toUpperCase())}</div>
          <div>
            <div class="profile-name">${escapeHtml(user.username)}</div>
            <div class="profile-role">${escapeHtml(roleTitle(user.role))}</div>
            <div class="field-hint">Employee ID: ${escapeHtml(user.employee_id || '—')}</div>
          </div>
        </div>
      </div>
      <div class="profile-modal-section">
        <h3>User Preferences</h3>
        <p class="field-hint">Sign out and sign back in after changing your password.</p>
        <div class="field"><label for="profile-username">Username</label><input class="control" id="profile-username" value="${escapeHtml(user.username)}" readonly></div>
        <div class="field"><label for="profile-role">Role</label><select class="control" id="profile-role"><option value="employee" ${user.role === 'employee' ? 'selected' : ''}>Employee</option><option value="hr" ${user.role === 'hr' ? 'selected' : ''}>HR Manager</option><option value="payroll" ${user.role === 'payroll' ? 'selected' : ''}>Payroll Manager</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrator</option></select></div>
      </div>
      <div class="profile-modal-section">
        <h3>Dashboard Appearance</h3>
        <div class="field"><label>Surface</label><div class="style-filter-group" style="margin-top:6px">${surfaceOptions}</div></div>
        <div class="field" style="margin-top:12px"><label>UI Style</label><div class="style-filter-group" style="margin-top:6px">${uiStyleOptions}</div></div>
        <div class="field" style="margin-top:12px"><label>Background Motion</label><div class="style-filter-group" style="margin-top:6px">${bgMotionOptions}</div></div>
        <div class="field" style="margin-top:12px"><label>Motion Hover</label><div class="style-filter-group" style="margin-top:6px">${motionHoverOptions}</div></div>
        <div class="field" style="margin-top:12px"><label>Speed</label><div class="speed-options" style="margin-top:6px">${speedOptions}</div></div>
        <div class="field" style="margin-top:12px"><label>Corners</label><div class="style-filter-group" style="margin-top:6px">${cornersOptions}</div></div>
        <div class="field" style="margin-top:12px"><label>Palette</label>
          <div class="palette-grid" style="margin-top:6px">${paletteOptions}</div>
        </div>
        <div class="field" style="margin-top:12px"><label>Dark Mode</label>
          <label class="switch" style="margin-left:10px"><input type="checkbox" id="profile-dark-toggle" ${stylePrefs.mode === 'dark' ? 'checked' : ''}><span class="slider"></span></label>
        </div>
      </div>
    </div>
  `, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="button" data-action="save-profile">Save Changes</button>');}


function openModal(title, body, footer = '<button class="button" type="button" data-action="close-modal">Close</button>', large = false) {
  document.body.style.overflow = 'hidden';
  const root = document.querySelector('#modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal ${large ? 'large' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-header"><h2 class="modal-title" id="modal-title">${escapeHtml(title)}</h2><button class="button icon-button" type="button" aria-label="Close dialog" data-action="close-modal">×</button></header>
    <div class="modal-body">${body}</div><footer class="modal-footer">${footer}</footer></section></div>`;
}

function closeModal() {
  stopPunchCamera();
  punchSelfieBlobUrl = '';
  document.body.style.overflow = '';
  const root = document.querySelector('#modal-root');
  if (root) {
    root.innerHTML = '';
  }
}

async function downloadFile(url, filename) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Download failed.');
  }
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

async function importJsonFile(file, endpoint) {
  if (!file) return;
  const json = await file.text();
  await api(endpoint, { method: 'POST', body: json });
  toast('Import completed. Matching records were updated.');
  await loadView();
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

appRoot.addEventListener('click', async (event) => {
  // Handle style filter options - they use data-key/data-val instead of data-action
  const styleOption = event.target.closest('.style-filter-option');
  if (styleOption) {
    event.preventDefault();
    const key = styleOption.dataset.key;
    const val = styleOption.dataset.val;
    if (key && val) {
      document.querySelectorAll(`.style-filter-option[data-key="${key}"]`).forEach(o => o.classList.remove('active'));
      styleOption.classList.add('active');
      if (stylePrefs[key] !== undefined) {
        stylePrefs[key] = val;
        applyStylePrefs();
        // applyCategoryFilter() removed - all tabs always visible
      }
    }
    return;
  }

  // Handle employee tracking state filter (All / Live / Idle / Offline)
  const trackFilterBtn = event.target.closest('.tracking-filter-btn');
  if (trackFilterBtn) {
    state.trackingFilter = trackFilterBtn.dataset.trackFilter;
    document.querySelectorAll('.tracking-filter-btn').forEach(b => b.classList.toggle('active', b === trackFilterBtn));
    renderTrackingPanel();
    return;
  }

  // Handle employee filter dropdown on Travel page
  const employeeFilter = event.target.closest('#employee-travel-filter');
  if (employeeFilter) {
    currentEmployeeFilter = employeeFilter.value || null;
    renderTrackingPanel();
    if (managerLiveMap) refreshGoogleMapMarkers([]);
    return;
  }

  // Handle palette options
  const paletteOption = event.target.closest('.palette-option');
  if (paletteOption) {
    event.preventDefault();
    const paletteNum = Number(paletteOption.dataset.palette);
    document.querySelectorAll('.palette-option').forEach(o => o.classList.remove('active'));
    paletteOption.classList.add('active');
    if (stylePrefs.palette !== paletteNum) {
      stylePrefs.palette = paletteNum;
      applyStylePrefs();
    }
    return;
  }

  const settingsTab = event.target.closest('[data-settings-tab]');
  if (settingsTab) {
    state.settingsTab = settingsTab.dataset.settingsTab;
    document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
      const selected = tab === settingsTab;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== state.settingsTab;
    });
    return;
  }

  const categoryTab = event.target.closest('[data-nav-category]');
  if (categoryTab) {
    const category = categoryTab.dataset.navCategory;
    const group = navGroups().find((item) => item.key === category);
    if (group?.direct.length) {
      event.preventDefault();
      state.navCategory = category;
      state.view = group.direct[0];
      state.search = '';
      renderShell();
      await loadView();
      return;
    }

    state.navCategory = category;
    document.querySelectorAll('[data-nav-category]').forEach((tab) => {
      const selected = tab.dataset.navCategory === category;
      tab.classList.toggle('active', selected);
      if (tab.tagName === 'BUTTON') tab.setAttribute('aria-expanded', String(selected));
    });
    document.querySelectorAll('.nav-secondary-panel').forEach((panel) => {
      const selected = panel.id === `nav-panel-${category}`;
      panel.classList.toggle('active', selected);
      panel.setAttribute('aria-hidden', String(!selected));
      panel.inert = !selected;
    });
    return;
  }

  const nav = event.target.closest('[data-view]');
  if (nav) {
    event.preventDefault();
    state.view = nav.dataset.view;
    state.navCategory = null;
    state.search = '';
    renderShell();
    await loadView();
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'set-access-tab') {
      state.accessTab = button.dataset.tab;
      await loadView();
    } else if (action === 'edit-access-role') {
      const roleData = await api('/api/access/roles');
      const role = button.dataset.id
        ? roleData.roles.find((entry) => entry.id === button.dataset.id)
        : null;
      openAccessRoleModal(roleData, role || null);
    } else if (action === 'duplicate-access-role') {
      const name = prompt(`Name for the duplicate of ${button.dataset.name}:`, `${button.dataset.name} copy`);
      if (!name?.trim()) return;
      await api(`/api/access/roles/${encodeURIComponent(button.dataset.id)}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() })
      });
      toast('Role duplicated.');
      await loadView();
    } else if (action === 'assign-access-roles') {
      const roleData = await api('/api/access/roles');
      openAssignAccessRolesModal({
        id: button.dataset.id,
        username: button.dataset.username,
        access_roles: button.dataset.accessRoles
      }, roleData);
    } else if (action === 'save-organization') {
      const row = button.closest('tr');
      await api(`/api/access/organization/${encodeURIComponent(button.dataset.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          designation: row.querySelector('[data-org-designation]').value,
          department: row.querySelector('[data-org-department]').value,
          region: row.querySelector('[data-org-region]').value,
          area: row.querySelector('[data-org-area]').value,
          reports_to: row.querySelector('[data-org-manager]').value || null,
          hierarchy_level: Number(row.querySelector('[data-org-level]').value)
        })
      });
      toast('Organization details saved.');
      await loadView();
    } else if (action === 'toggle-user-active') {
      const active = button.dataset.active !== 'true';
      if (!confirm(`${active ? 'Activate' : 'Deactivate'} ${button.dataset.username}?`)) return;
      await api(`/api/users/${encodeURIComponent(button.dataset.id)}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active })
      });
      toast(`User ${active ? 'activated' : 'deactivated'}.`);
      await loadView();
    } else if (action === 'toggle-password') {
      const input = document.getElementById(button.dataset.target);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        button.textContent = input.type === 'password' ? 'Show' : 'Hide';
        button.setAttribute('aria-label', `${input.type === 'password' ? 'Show' : 'Hide'} password`);
      }
    } else if (action === 'forgot-password') {
      state.recoveryIdentifier = '';
      authScreen(false, 'recovery-request');
    } else if (action === 'back-to-login') {
      authScreen(false, 'login');
    } else if (action === 'resend-recovery-code') {
      const result = await api('/api/auth/recovery/request', {
        method: 'POST',
        body: JSON.stringify({ identifier: state.recoveryIdentifier })
      });
      authScreen(false, 'recovery-verify', result.message);
    } else if (action === 'logout') {
      await api('/api/logout', { method: 'POST', body: '{}' });
      location.reload();
    } else if (action === 'new-employee') {
      openEmployeeModal();
    } else if (action === 'edit-employee') {
      const employee = state.employeeRows.find((row) => row.id === button.dataset.id);
      if (employee) openEmployeeModal(employee);
    } else if (action === 'delete-employee') {
      if (confirm(`Archive employee ${button.dataset.id}? Historical payroll will be retained.`)) {
        await api(`/api/employees/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Employee archived.');
        await loadView();
      }
    } else if (action === 'new-revision') {
      openRevisionModal();
    } else if (action === 'delete-revision') {
      if (confirm('Delete this salary revision? Payroll for affected months will recalculate.')) {
        await api(`/api/revisions/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Salary revision deleted.');
        await loadView();
      }
    } else if (action === 'fill-present-all') {
      const selects = document.querySelectorAll('select[data-employee][data-day]');
      let filled = 0;
      for (const select of selects) {
        // Only fill days that are not already Weekly off or Paid holiday
        if (select.value === 'WO' || select.value === 'H') continue;
        select.value = 'P';
        select.dataset.code = 'P';
        select.className = 'control compact attendance-code-P';
        filled += 1;
      }
      state.attendanceDirty = true;
      toast(`Filled ${filled} weekday days as Present. Weekends and holidays left unchanged. Tap "Save change" to apply.`);
    } else if (action === 'toggle-presence-view') {
      if (confirm('Switch to the full calendar grid? The presence view hides cells you haven\'t edited.')) {
        const root = document.querySelector('#view-root');
        const table = root.querySelector('.table-wrap');
        if (table) {
          table.style.display = '';
          root.querySelectorAll('.attendance-presence select').forEach((s) => s.style.display = '');
        }
      }
    } else if (action === 'save-attendance') {
      await saveAttendance();
    } else if (action === 'save-adjustment') {
      await saveAdjustment(button);
    } else if (action === 'new-payroll-item') {
      await openPayrollItemModal(button.dataset.id);
    } else if (action === 'delete-payroll-item') {
      const recurring = button.dataset.recurring === 'true';
      const message = recurring
        ? `Stop this monthly item after ${state.month}? It will remain on this month's payroll.`
        : 'Remove this item from this payroll month?';
      if (confirm(message)) {
        await api(`/api/payroll/items/${encodeURIComponent(button.dataset.id)}?month=${encodeURIComponent(state.month)}`, { method: 'DELETE' });
        toast(recurring ? 'Monthly payroll item stopped after this month.' : 'Payroll item removed.');
        await loadView();
      }
    } else if (action === 'show-slip') {
      await showSlip(button.dataset.id);
    } else if (action === 'save-payroll-status') {
      const status = document.querySelector('#payroll-status').value;
      await api(`/api/payroll/${encodeURIComponent(state.month)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      toast(`Payroll status set to ${status}.`);
    } else if (action === 'new-holiday') {
      openHolidayModal();
    } else if (action === 'add-holiday-row') {
      addHolidayRow();
    } else if (action === 'remove-holiday-row') {
      removeHolidayRow(button);
    } else if (action === 'save-holidays') {
      const items = holidayRows().map((row) => ({
        holiday_date: row.querySelector('[name="holiday_date"]').value,
        name: row.querySelector('[name="name"]').value,
        paid: row.querySelector('[name="paid"]').checked
      }));
      const result = await api('/api/holidays', { method: 'POST', body: JSON.stringify(items) });
      closeModal();
      toast(`Saved ${Array.isArray(result) ? result.length : 1} holiday${Array.isArray(result) ? '' : ''}.`);
      await loadView();
    } else if (action === 'save-profile') {
      // Profile settings - save appearance preferences
      const surfaceActive = document.querySelector('.profile-modal [data-key="surface"].active');
      if (surfaceActive) stylePrefs.surface = surfaceActive.dataset.val;

      // Save uiStyle
      const uiStyleActive = document.querySelector('.profile-modal [data-key="uiStyle"].active');
      if (uiStyleActive) stylePrefs.uiStyle = uiStyleActive.dataset.val;

      // Save bgMotion
      const bgMotionActive = document.querySelector('.profile-modal [data-key="bgMotion"].active');
      if (bgMotionActive) stylePrefs.bgMotion = bgMotionActive.dataset.val;

      // Save motionHover
      const motionHoverActive = document.querySelector('.profile-modal [data-key="motionHover"].active');
      if (motionHoverActive) stylePrefs.motionHover = motionHoverActive.dataset.val;

      // Save speed
      const speedActive = document.querySelector('.profile-modal [data-key="speed"].active');
      if (speedActive) stylePrefs.speed = speedActive.dataset.val;

      // Save corners
      const cornersActive = document.querySelector('.profile-modal [data-key="corners"].active');
      if (cornersActive) stylePrefs.corners = cornersActive.dataset.val;

      // Save palette
      const paletteActive = document.querySelector('.profile-modal .palette-option.active');
      if (paletteActive) stylePrefs.palette = Number(paletteActive.dataset.palette);

      // Save dark mode
      const darkToggle = document.getElementById('profile-dark-toggle');
      if (darkToggle) stylePrefs.mode = darkToggle.checked ? 'dark' : 'light';

      saveStylePrefs();
      applyStylePrefs();
      // Profile settings - role changes require admin and are handled by users API
      toast('Profile settings saved. Note: role changes require admin access in Access control.');
      closeModal();
    } else if (action === 'delete-holiday') {
      if (confirm('Delete this holiday? Attendance already saved for the date will remain unchanged.')) {
        await api(`/api/holidays/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Holiday deleted.');
        await loadView();
      }
    } else if (action === 'save-settings') {
      await saveSettings();
    } else if (action === 'add-approval-step') {
      const type = button.dataset.type;
      const container = document.querySelector(`[data-approval-levels="${type}"]`);
      container?.querySelector('.empty-approval-steps')?.remove();
      container?.insertAdjacentHTML('beforeend', approvalWorkflowLevelRow(type));
      updateApprovalWorkflowDiagram(type);
    } else if (action === 'remove-approval-step') {
      const type = button.dataset.type;
      const container = document.querySelector(`[data-approval-levels="${type}"]`);
      button.closest('[data-approval-level]')?.remove();
      if (container && !container.querySelector('[data-approval-level]')) {
        container.innerHTML = '<div class="empty-approval-steps field-hint">No approval steps configured.</div>';
      }
      updateApprovalWorkflowDiagram(type);
    } else if (action === 'save-approval-workflow') {
      await saveApprovalWorkflow(button.dataset.type);
    } else if (action === 'save-travel-settings') {
      await saveTravelSettings();
    } else if (action === 'save-company-settings') {
      await saveCompanySettings();
    } else if (action === 'get-km-covered') {
      openKmCoveredModal();
    } else if (action === 'track-live') {
      await trackLive();
    } else if (action === 'stop-live') {
      await stopLiveTracking();
    } else if (action === 'new-dcr') {
      openDcrModal();
    } else if (action === 'sync-punch-attendance') {
      const result = await api('/api/travel/punch/sync', { method: 'POST', body: JSON.stringify({ month: state.month }) });
      toast(`Synced ${result.synced} punched days into attendance for ${state.month}.`);
      await loadView();
    } else if (action === 'new-journey') {
      openJourneyModal();
    } else if (action === 'submit-journey') {
      await api(`/api/travel/journeys/${encodeURIComponent(button.dataset.id)}`, { method: 'PUT', body: JSON.stringify({ status: 'submitted' }) });
      toast('Journey submitted for approval.');
      await loadView();
    } else if (action === 'approve-journey') {
      const defaultKm = button.dataset.km || '0';
      const enteredKm = prompt('Approved distance (KM):', defaultKm);
      if (enteredKm === null) return;
      const approvedKm = Number(enteredKm);
      if (approvedKm >= 0) {
        await api('/api/travel/adjustments', { method: 'PUT', body: JSON.stringify({ journey_id: button.dataset.id, approved_distance_km: approvedKm, status: 'approved' }) });
        toast('Journey approved; TA/DA will flow into payroll.');
        await loadView();
      }
    } else if (action === 'reject-journey') {
      const reason = prompt('Rejection reason (optional):', '') || '';
      await api('/api/travel/adjustments', { method: 'PUT', body: JSON.stringify({ journey_id: button.dataset.id, approved_distance_km: 0, status: 'rejected', reason }) });
      toast('Journey rejected.');
      await loadView();
    } else if (action === 'replay-journey') {
      await replayJourney(button.dataset.id);
    } else if (action === 'open-odometer') {
      await openOdometerModal(button.dataset.id);
    } else if (action === 'open-expense-claim') {
      await openExpenseClaimModal(button.dataset.id);
    } else if (action === 'submit-odometer') {
      const form = document.querySelector('#odometer-form');
      if (!form) return;
      const formData = new FormData(form);
      const beforeKm = parseFloat(formData.get('before_odometer_km'));
      const afterKm = parseFloat(formData.get('after_odometer_km'));
      const claimedKm = parseFloat(formData.get('claimed_km'));
      if (isNaN(beforeKm) || isNaN(afterKm) || isNaN(claimedKm)) {
        toast('Please fill in all odometer values.', true);
        return;
      }
      try {
        await api('/api/travel/odometer', {
          method: 'POST',
          body: JSON.stringify({
            journey_id: button.dataset.id,
            before_odometer_km: beforeKm,
            after_odometer_km: afterKm,
            claimed_km: claimedKm,
            before_photo_url: '',
            after_photo_url: ''
          })
        });
        closeModal();
        toast('Odometer verification submitted.');
        await loadView();
      } catch (error) {
        toast(`Failed to submit: ${error.message}`, true);
      }
    } else if (action === 'submit-expense') {
      const form = document.querySelector('#expense-form');
      if (!form) return;
      try {
        await api('/api/travel/expense-claim', {
          method: 'POST',
          body: JSON.stringify({
            journey_id: button.dataset.id,
            claimed_km: parseFloat(document.getElementById('expense-approved-km')?.value || 0)
          })
        });
        closeModal();
        toast('Expense claim submitted for approval.');
        await loadView();
      } catch (error) {
        toast(`Failed to submit expense: ${error.message}`, true);
      }
    } else if (action === 'delete-journey') {
      if (confirm('Delete this journey? Visits and audit entries will be removed.')) {
        await api(`/api/travel/journeys/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Journey deleted.');
        await loadView();
      }
    } else if (action === 'new-user') {
      openUserModal();
    } else if (action === 'set-recovery-email') {
      openRecoveryEmailModal(button.dataset.id, button.dataset.username, button.dataset.hasEmail === 'true');
    } else if (action === 'reset-user-password') {
      openResetUserPasswordModal(button.dataset.id, button.dataset.username);
    } else if (action === 'remove-user') {
      const username = button.dataset.username;
      if (confirm(`Permanently remove ${username}? This also ends their active sessions and cannot be undone.`)) {
        await api(`/api/users/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast(`User ${username} removed.`);
        await loadView();
      }
    } else if (action === 'open-request-modal' || action === 'open-my-request-modal') {
      openRequestModal();
    } else if (action === 'approve-leave') {
      await api(`/api/leave-requests/${encodeURIComponent(button.dataset.id)}`, { method: 'PUT', body: JSON.stringify({ status: 'approved' }) });
      toast('Leave request approved.');
      await loadView();
    } else if (action === 'reject-leave') {
      const reason = prompt('Rejection reason (optional):', '') || '';
      await api(`/api/leave-requests/${encodeURIComponent(button.dataset.id)}`, { method: 'PUT', body: JSON.stringify({ status: 'rejected', rejection_reason: reason }) });
      toast('Leave request rejected.');
      await loadView();
    } else if (action === 'download-backup') {
      await downloadFile('/api/backup', 'salary-app-backup.json');
      toast('Backup downloaded.');
    } else if (action === 'punch-in') {
      openPunchModal('in');
    } else if (action === 'punch-out') {
      openPunchModal('out');
    } else if (action === 'start-punch-camera') {
      await startPunchCamera();
    } else if (action === 'capture-punch-selfie') {
      capturePunchSelfie();
    } else if (action === 'new-customer') {
      openCustomerModal();
    } else if (action === 'edit-customer') {
      const customer = await api(`/api/travel/customers/${encodeURIComponent(button.dataset.id)}`);
      openCustomerModal(customer);
    } else if (action === 'delete-customer') {
      if (confirm('Delete this customer?')) {
        await api(`/api/travel/customers/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Customer deleted.');
        await loadView();
      }
    } else if (action === 'new-sample') {
      openSampleModal();
    } else if (action === 'new-order') {
      openOrderModal();
    } else if (action === 'new-task') {
      openTaskModal();
    } else if (action === 'close-modal') {
      closeModal();
    } else if (action === 'close-modal-backdrop' && event.target === button) {
      closeModal();
    } else if (action === 'print-slip') {
      window.print();
    } else if (action === 'open-employee-detail') {
      event.preventDefault();
      state.selectedEmployeeId = button.dataset.id;
      state.view = 'employee-detail';
      renderShell();
      await loadView();
    } else if (action === 'edit-employee') {
      const employee = state.employeeRows.find((row) => row.id === button.dataset.id);
      if (employee) openEmployeeModal(employee);
    } else if (action === 'view-route-playback') {
      state.selectedEmployeeId = button.dataset.id;
      state.view = 'route-playback';
      await loadView();
    } else if (action === 'toggle-satellite-map') {
      const btn = button;
      const isSatellite = btn.textContent.includes('Satellite');
      const mapTypeId = isSatellite ? 'satellite' : 'roadmap';
      // Toggle on all map instances
      const maps = [window.myRouteMap, window.routeMap, managerLiveMap, window.travelRouteMap];
      maps.forEach(map => {
        if (map && map instanceof google.maps.Map) {
          map.setMapTypeId(mapTypeId);
        }
      });
      btn.textContent = isSatellite ? 'Switch to Road View' : 'Switch to Satellite';
    } else if (action === 'mark-attendance-today') {
      const employeeId = button.dataset.employee;
      const today = new Date().toISOString().slice(0, 10);
      try {
        const result = await api('/api/attendance/today', {
          method: 'POST',
          body: JSON.stringify({
            employee_id: employeeId,
            work_date: today,
            notes: 'Marked from employee detail (customer visit)'
          })
        });
        toast(result.attendance ? 'Marked attendance for today.' : (result.message || 'Marked attendance for today.'));
        await loadView();
      } catch (error) {
        toast(`Failed to mark attendance: ${error.message}`, true);
      }
    } else if (action === 'mark-customer-visit') {
      const visitId = button.dataset.id;
      try {
        const result = await api(`/api/travel/visits/${encodeURIComponent(visitId)}/attend`, { method: 'POST' });
        toast(`Attendance marked for customer visit.`);
        await loadView();
      } catch (error) {
        toast(`Failed to mark attendance: ${error.message}`, true);
      }
    } else if (action === 'select-employee-route') {
      state.selectedEmployeeId = button.dataset.id;
      await loadView();
    } else if (action === 'process-my-approval') {
      const approvalAction = button.dataset.status;
      const comments = prompt(
        approvalAction === 'rejected' ? 'Rejection reason (required):' : 'Approval comments (optional):',
        ''
      ) || '';
      if (approvalAction === 'rejected' && !comments.trim()) {
        toast('Rejection reason is required.', true);
        return;
      }
      const endpoint = button.dataset.type === 'expense'
        ? `/api/expenses/${encodeURIComponent(button.dataset.id)}/approve`
        : `/api/attendance/regularisation/${encodeURIComponent(button.dataset.id)}/approve`;
      await api(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ action: approvalAction, comments: comments.trim() })
      });
      toast(approvalAction === 'approved' ? 'Request approved.' : 'Request rejected.');
      await loadView();
    } else if (action === 'approve-expense') {
      const comments = prompt('Approval comments (optional):', '') || '';
      await api(`/api/expenses/${button.dataset.id}/approve`, {
        method: 'PUT', body: JSON.stringify({ action: 'approved', comments })
      });
      toast('Expense approved.');
      await loadView();
    } else if (action === 'reject-expense') {
      const comments = prompt('Rejection reason (required):', '') || '';
      if (!comments) { toast('Rejection reason is required.', true); return; }
      await api(`/api/expenses/${button.dataset.id}/approve`, {
        method: 'PUT', body: JSON.stringify({ action: 'rejected', comments })
      });
      toast('Expense rejected.');
      await loadView();
    } else if (action === 'pay-expense') {
      await api(`/api/expenses/${button.dataset.id}/pay`, { method: 'PUT' });
      toast('Expense marked as paid.');
      await loadView();
    } else if (action === 'open-expense-modal') {
      await openExpenseModal();
    } else if (action === 'open-profile-modal') {
      await renderProfileModal();
    } else if (action === 'open-style-filter') {
      openStyleFilterModal();
    } else if (action === 'save-style-prefs') {
      // Save category
      const categoryActive = document.querySelector('.style-filter-option[data-key="category"].active');
      if (categoryActive) stylePrefs.category = categoryActive.dataset.val;

      // Save uiStyle
      const uiStyleActive = document.querySelector('.style-filter-option[data-key="uiStyle"].active');
      if (uiStyleActive) stylePrefs.uiStyle = uiStyleActive.dataset.val;

      // Save bgMotion
      const bgMotionActive = document.querySelector('.style-filter-option[data-key="bgMotion"].active');
      if (bgMotionActive) stylePrefs.bgMotion = bgMotionActive.dataset.val;

      // Save motionHover
      const motionHoverActive = document.querySelector('.style-filter-option[data-key="motionHover"].active');
      if (motionHoverActive) stylePrefs.motionHover = motionHoverActive.dataset.val;

      // Save speed
      const speedActive = document.querySelector('.style-filter-option[data-key="speed"].active');
      if (speedActive) stylePrefs.speed = speedActive.dataset.val;

      // Save corners
      const cornersActive = document.querySelector('.style-filter-option[data-key="corners"].active');
      if (cornersActive) stylePrefs.corners = cornersActive.dataset.val;

      // Save surface
      const surfaceActive = document.querySelector('.style-filter-option[data-key="surface"].active');
      if (surfaceActive) stylePrefs.surface = surfaceActive.dataset.val;

      // Save mode and palette
      const modeToggle = document.getElementById('style-mode-toggle');
      if (modeToggle) {
        stylePrefs.mode = modeToggle.checked ? 'dark' : 'light';
      }
      const paletteActive = document.querySelector('.palette-option.active');
      if (paletteActive) stylePrefs.palette = Number(paletteActive.dataset.palette);

      saveStylePrefs();
      applyStylePrefs();
      // applyCategoryFilter() removed - all tabs always visible
      closeModal();
      toast('Style preferences saved.');
    }
  } catch (error) {
    toast(error.message, true);
  }
});

appRoot.addEventListener('keydown', (event) => {
  const activeCategory = event.target.closest('[data-nav-category]');
  if (activeCategory && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
    const categories = [...document.querySelectorAll('[data-nav-category]')];
    const currentIndex = categories.indexOf(activeCategory);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? categories.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
    event.preventDefault();
    categories[nextIndex].focus();
    categories[nextIndex].click();
    return;
  }

  const activeTab = event.target.closest('[data-settings-tab]');
  if (!activeTab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  const currentIndex = tabs.indexOf(activeTab);
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[nextIndex].focus();
  tabs[nextIndex].click();
});

appRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const formId = form.getAttribute('id');
  try {
    if (formId === 'auth-form') {
      const values = formValues(form);
      if (!state.needsSetup) values.rememberMe = form.elements.remember_me.checked;
      const result = await api(state.needsSetup ? '/api/setup' : '/api/login', {
        method: 'POST', body: JSON.stringify(values)
      });
      state.user = result.user;
      state.view = result.user.role === 'employee' ? 'my-attendance' : 'dashboard';
      renderShell();
      // applyCategoryFilter() removed - all tabs always visible
      await loadView();
    } else if (formId === 'access-role-form') {
      const values = formValues(form);
      const roleId = form.dataset.id;
      const body = {
        name: values.name,
        description: values.description || ''
      };
      if (roleId) {
        const active = form.querySelector('[name="is_active"]');
        if (active) body.is_active = active.checked;
        if (form.dataset.code !== 'super_admin') {
          body.permissions = [...form.querySelectorAll('input[name="permission"]:checked')].map((input) => {
            const [module, action] = input.value.split(':');
            return { module, action };
          });
        }
        await api(`/api/access/roles/${encodeURIComponent(roleId)}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
      } else {
        body.code = values.code;
        body.permissions = [...form.querySelectorAll('input[name="permission"]:checked')].map((input) => {
          const [module, action] = input.value.split(':');
          return { module, action };
        });
        await api('/api/access/roles', { method: 'POST', body: JSON.stringify(body) });
      }
      closeModal();
      toast(roleId ? 'Role updated.' : 'Role created.');
      await loadView();
    } else if (formId === 'access-assignment-form') {
      const role_ids = [...form.querySelectorAll('input[name="role_id"]:checked')].map((input) => input.value);
      await api(`/api/access/users/${encodeURIComponent(form.dataset.id)}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ role_ids })
      });
      closeModal();
      toast('User roles updated. The user must sign in again.');
      await loadView();
    } else if (formId === 'auth-recovery-request-form') {
      const values = formValues(form);
      state.recoveryIdentifier = values.identifier;
      const result = await api('/api/auth/recovery/request', {
        method: 'POST',
        body: JSON.stringify({ identifier: values.identifier })
      });
      authScreen(false, 'recovery-verify', result.message);
    } else if (formId === 'auth-recovery-verify-form') {
      const values = formValues(form);
      if (values.password !== values.confirm_password) {
        toast('The passwords do not match.', true);
        return;
      }
      await api('/api/auth/recovery/verify', {
        method: 'POST',
        body: JSON.stringify({
          identifier: state.recoveryIdentifier,
          code: values.code,
          password: values.password
        })
      });
      state.recoveryIdentifier = '';
      authScreen(false, 'login', 'Your password has been reset. Sign in with your new password.');
    } else if (formId === 'employee-form') {
      const values = formValues(form);
      values.pf_applicable = form.elements.pf_applicable?.checked || false;
      values.esic_applicable = form.elements.esic_applicable?.checked || false;
      const id = form.dataset.id;
      await api(id ? `/api/employees/${encodeURIComponent(id)}` : '/api/employees', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(values)
      });
      closeModal();
      toast(id ? 'Employee updated.' : 'Employee created.');
      await loadView();
    } else if (formId === 'revision-form') {
      await api('/api/revisions', { method: 'POST', body: JSON.stringify(formValues(form)) });
      closeModal();
      toast('Salary revision saved.');
      await loadView();
    } else if (formId === 'holiday-form') {
      const items = holidayRows().map((row) => ({
        holiday_date: row.querySelector('[name="holiday_date"]').value,
        name: row.querySelector('[name="name"]').value,
        paid: row.querySelector('[name="paid"]').checked
      }));
      const result = await api('/api/holidays', { method: 'POST', body: JSON.stringify(items) });
      closeModal();
      toast(`Saved ${Array.isArray(result) ? result.length : 1} holiday${Array.isArray(result) ? '' : ''}.`);
      await loadView();
    } else if (formId === 'leave-request-form') {
      const values = formValues(form);
      values.half_day = form.elements.half_day?.checked ? 1 : 0;
      await api('/api/leave-requests', { method: 'POST', body: JSON.stringify(values) });
      closeModal();
      toast('Leave request submitted successfully.');
      await loadView();
    } else if (formId === 'payroll-item-form') {
      await savePayrollItem(form);
    } else if (formId === 'journey-form') {
      const values = formValues(form);
      const endpoint = state.user.role === 'employee' ? '/api/employee/travel/journeys' : '/api/travel/journeys';
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(values) });
      closeModal();
      toast(values.id ? 'Journey updated.' : 'Journey started.');
      await loadView();
    } else if (formId === 'live-tracking-form') {
      const values = formValues(form);
      const employeeId = state.user.role === 'employee' ? state.user.employee_id : values.employee_id;
      await beginLiveTracking(employeeId, values.travel_date);
    } else if (formId === 'dcr-form') {
      const values = formValues(form);
      const point = await geocodeAddress(values.location);
      if (!point) {
        toast('Could not resolve visit location. Use lat,lng format (e.g. 28.6139,77.2090).', true);
        return;
      }
      const body = {
        employee_id: values.employee_id,
        travel_date: values.visit_date,
        start_lat: point.lat,
        start_lng: point.lng,
        end_lat: point.lat,
        end_lng: point.lng,
        gps_distance_km: 0,
        road_distance_km: 0,
        notes: values.notes || ''
      };
      const endpoint = state.user.role === 'employee' ? '/api/employee/travel/journeys' : '/api/travel/journeys';
      await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      toast(`DCR visit saved for ${values.customer_name}. Use "Get KM covered" to compute distance from office.`);
      await loadView();
    } else if (formId === 'km-form') {
      const values = formValues(form);
      const [start, end] = await Promise.all([
        geocodeAddress(values.start_address),
        geocodeAddress(values.end_address)
      ]);
      if (!start || !end) {
        toast('Could not resolve one or both addresses. Use lat,lng format (e.g. 28.6139,77.2090).', true);
        return;
      }
      const km = haversineKmClient(start.lat, start.lng, end.lat, end.lng);
      const body = {
        employee_id: values.employee_id,
        travel_date: values.travel_date,
        start_lat: start.lat,
        start_lng: start.lng,
        end_lat: end.lat,
        end_lng: end.lng,
        gps_distance_km: km,
        road_distance_km: km,
        notes: values.notes || ''
      };
      const endpoint = state.user.role === 'employee' ? '/api/employee/travel/journeys' : '/api/travel/journeys';
      await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      toast(`Journey saved · ${km.toFixed(2)} KM covered.`);
      await loadView();
    } else if (formId === 'punch-form') {
      const values = formValues(form);
      const now = new Date();
      const nowDate = now.toISOString().slice(0, 10);
      const direction = values.direction || 'in';

      const selfieUrl = punchSelfieBlobUrl;

      if (!selfieUrl) {
        toast('Capture a live selfie before submitting this punch.', true);
        return;
      }

      const punchData = {
        employee_id: state.user.employee_id,
        punch_date: nowDate,
        direction,
        lat: values.lat ? Number(values.lat) : null,
        lng: values.lng ? Number(values.lng) : null,
        accuracy: values.accuracy ? Number(values.accuracy) : null,
        location: values.location || '',
        notes: values.notes || '',
        selfie_url: selfieUrl,
        face_verified: 0,
        recorded_at: now.toISOString()
      };

      try {
        await api('/api/travel/punch', { method: 'POST', body: JSON.stringify(punchData) });
        punchSelfieBlobUrl = ''; // Clear for next use
        closeModal();
        toast(`${direction === 'in' ? 'Punched In' : 'Punched Out'} successfully.`);
        await loadView();
      } catch (error) {
        if (error.message.includes('already exists')) {
          toast(`You already have a ${direction === 'in' ? 'Punch In' : 'Punch Out'} recorded for today.`, true);
        } else {
          toast(error.message, true);
        }
      }
    } else if (formId === 'customer-form') {
      const values = formValues(form);
      const isEdit = form.dataset.id;
      const endpoint = isEdit ? `/api/travel/customers/${encodeURIComponent(form.dataset.id)}` : '/api/travel/customers';
      const method = isEdit ? 'PUT' : 'POST';

      const customerData = {
        employee_id: values.employee_id,
        name: values.name,
        customer_type: values.customer_type,
        location: values.location,
        lat: values.lat ? Number(values.lat) : null,
        lng: values.lng ? Number(values.lng) : null,
        territory: values.territory,
        phone: values.phone,
        notes: values.notes,
        active: values.active !== undefined ? (values.active === 'true' || values.active === 'on' || true) : true
      };

      await api(endpoint, { method, body: JSON.stringify(customerData) });
      closeModal();
      toast(isEdit ? 'Customer updated.' : 'Customer added.');
      await loadView();
    } else if (formId === 'user-form') {
      const values = formValues(form);
      if (values.role === 'employee' && !values.employee_id) {
        toast('Select an employee for the employee role.', true);
        return;
      }
      const body = {
        username: values.username,
        password: values.password,
        role: values.role,
        recovery_email: values.recovery_email
      };
      if (values.role === 'employee') body.access_role_code = values.access_role_code;
      if (values.role === 'employee') {
        body.employee_id = values.employee_id;
      }
      await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      toast('User created.');
      await loadView();
    } else if (formId === 'recovery-email-form') {
      const values = formValues(form);
      await api(`/api/users/${encodeURIComponent(form.dataset.id)}/recovery-email`, {
        method: 'PUT',
        body: JSON.stringify({ recovery_email: values.recovery_email })
      });
      closeModal();
      toast('Recovery email updated.');
      await loadView();
    } else if (formId === 'user-password-reset-form') {
      const values = formValues(form);
      if (values.password !== values.confirm_password) {
        toast('The passwords do not match.', true);
        return;
      }
      await api(`/api/users/${encodeURIComponent(form.dataset.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: values.password })
      });
      closeModal();
      toast('User password reset. Their existing sessions have been signed out.');
      await loadView();
    } else if (formId === 'sample-form') {
      const values = formValues(form);
      const sampleData = {
        employee_id: values.employee_id,
        sample_name: values.sample_name,
        batch_number: values.batch_number,
        quantity: Number(values.quantity),
        unit: values.unit,
        allocated_at: values.allocated_at,
        notes: values.notes,
        status: values.status || 'allocated'
      };
      if (form.dataset.id) {
        await api(`/api/samples/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(sampleData) });
        toast('Sample updated.');
      } else {
        await api('/api/samples', { method: 'POST', body: JSON.stringify(sampleData) });
        toast('Sample recorded.');
      }
      closeModal();
      await loadView();
    } else if (formId === 'order-form') {
      const values = formValues(form);
      const product = await api(`/api/products/${encodeURIComponent(values.product_id)}`);
      const itemTotal = Number(values.quantity) * Number(values.unit_price);
      const orderData = {
        employee_id: state.user?.employee_id,
        customer_id: null,
        order_date: values.order_date,
        total_amount: itemTotal,
        status: 'pending',
        items: [{
          product_id: values.product_id,
          quantity: Number(values.quantity),
          unit_price: Number(values.unit_price),
          line_total: itemTotal
        }],
        notes: values.notes || ''
      };
      const result = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderData) });
      toast(`Order ${result.id.slice(0, 8)} created.`);
      closeModal();
      await loadView();
    } else if (formId === 'task-form') {
      const values = formValues(form);
      const taskData = {
        employee_id: values.employee_id,
        title: values.title,
        description: values.description,
        task_type: values.task_type,
        priority: values.priority,
        due_date: values.due_date || null,
        status: values.status || 'open'
      };
      if (form.dataset.id) {
        await api(`/api/tasks/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(taskData) });
        toast('Task updated.');
      } else {
        await api('/api/tasks', { method: 'POST', body: JSON.stringify(taskData) });
        toast('Task created.');
      }
      closeModal();
      await loadView();
    } else if (formId === 'expense-form') {
      const values = formValues(form);
      const expenseData = {
        employee_id: values.employee_id || null,
        expense_type: values.expense_type,
        amount: parseFloat(values.amount),
        expense_date: values.expense_date,
        description: values.description || '',
        bill_photo: values.bill_photo || '',
        journey_id: values.journey_id || null
      };
      await api('/api/expenses', { method: 'POST', body: JSON.stringify(expenseData) });
      closeModal();
      toast('Expense submitted for approval.');
      await loadView();
    }
  } catch (error) {
    toast(error.message, true);
  }
});

appRoot.addEventListener('input', (event) => {
  const designationInput = event.target.closest('[data-level-designation]');
  if (designationInput) {
    updateApprovalWorkflowDiagram(designationInput.closest('[data-approval-levels]').dataset.approvalLevels);
  }
  if (event.target.id === 'employee-search') {
    state.search = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadView(), 220);
  }
});

appRoot.addEventListener('change', async (event) => {
  const approvalLevel = event.target.closest('[data-approval-level]');
  if (approvalLevel && event.target.matches('[data-level-auto]')) {
    updateApprovalWorkflowDiagram(approvalLevel.closest('[data-approval-levels]').dataset.approvalLevels);
  }
  // Handle style mode toggle (dark/light mode)
  if (event.target.id === 'style-mode-toggle') {
    stylePrefs.mode = event.target.checked ? 'dark' : 'light';
    applyStylePrefs();
    return;
  }

  if (event.target.id === 'payroll-item-component') {
    const component = event.target.selectedOptions[0];
    const label = document.querySelector('#payroll-item-label');
    const kind = document.querySelector('#payroll-item-kind');
    const reusable = Boolean(event.target.value);
    label.value = reusable ? component.dataset.label : '';
    label.disabled = reusable;
    kind.value = reusable ? component.dataset.kind : 'earning';
    kind.disabled = reusable;
  } else if (event.target.id === 'month-control') {
    if (state.attendanceDirty && !confirm('Attendance has unsaved changes. Discard them and change month?')) {
      event.target.value = state.month;
      return;
    }
    state.month = event.target.value;
    if (state.view === 'holidays') await loadView();
    else await loadView();
  } else if (event.target.closest('[data-employee]')) {
    state.attendanceDirty = true;
    const select = event.target.closest('select[data-code]');
    if (select) select.dataset.code = select.value;
  } else if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0];
    if (file && confirm('Restore this backup? Existing matching records will be overwritten.')) {
      try {
        await importJsonFile(file, '/api/backup/restore');
      } catch (error) {
        toast(error.message, true);
      }
    }
  } else if (event.target.id === 'workbook-import-file') {
    const file = event.target.files?.[0];
    if (file && confirm('Import this converted workbook? Existing matching records will be updated.')) {
      try {
        await importJsonFile(file, '/api/import/workbook-json');
      } catch (error) {
        toast(error.message, true);
      }
    }
  }
});

/* Employee self-service render functions */
async function renderMyAttendance() {
  const user = state.user;
  const data = await api(`/api/employee/attendance?month=${encodeURIComponent(state.month)}`);
  const { month, daysInMonth, codes, employee, entries } = data;

  // Build day headers (1..N)
  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .map((d) => `<th scope="col">${d}</th>`).join('');

  const codeOptions = Object.entries(codes).map(([code, label]) =>
    `<option value="${code}">${code} — ${label}</option>`).join('');

  const html = entries.map((entry) => {
    const dayCells = entry.days.map((status, idx) => {
      const date = `${month}-${String(idx + 1).padStart(2, '0')}`;
      const isReadonly = true; // Employee cannot edit their own attendance
      const selectClass = isReadonly ? 'attendance-select readonly' : 'attendance-select';
      const disabled = isReadonly ? 'disabled' : '';
      const selectedStatus = status || '';
      return `<td>
        <select class="${selectClass}" ${disabled} data-employee="${escapeHtml(entry.employeeId)}" data-day="${idx + 1}" data-code="${escapeHtml(selectedStatus)}">
          ${codeOptions}
        </select>
      </td>`;
    }).join('');
    return `<tr><th scope="row">${escapeHtml(employee.name)}</th>${dayCells}</tr>`;
  }).join('');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('My Attendance', `Attendance record for ${employee.name} (${employee.id}) — ${month}`)}
    <div class="table-wrap">
      <table class="attendance-table" role="grid">
        <thead><tr><th scope="col">Employee</th>${dayHeaders}</tr></thead>
        <tbody>${html}</tbody>
      </table>
    </div>
    <div class="notice">This is a read-only view. Contact HR/Administrator for corrections.</div>
  `;

  // Set the select values after rendering
  document.querySelectorAll('.attendance-select').forEach((select) => {
    select.value = select.dataset.code || '';
  });
}

async function renderMyTravel() {
  const monthParam = state.month ? `&month=${encodeURIComponent(state.month)}` : '';
  const data = await api(`/api/employee/travel?${monthParam.slice(1)}`);
  const { journeys, settings } = data;

  const rowHtml = journeys.map((journey) => {
    const statusLabel = travelStatusLabels[journey.status] || journey.status;
    const statusClass = journey.status === 'approved' ? 'green'
      : journey.status === 'rejected' ? 'red'
        : journey.status === 'live' || journey.status === 'submitted' ? 'amber' : '';
    const taDa = journey.approved_distance_km > 0 && journey.status === 'approved'
      ? calculateTaDaClient(journey.approved_distance_km, settings)
      : { ta: 0, da: 0 };

    // Check if odometer record exists
    const hasOdometer = journey.odometer_id ? true : false;
    const hasExpense = journey.expense_id ? true : false;

    let actions = '';
    if (journey.status === 'approved' && !hasExpense) {
      actions = `<button class="button small" data-action="open-expense-claim" data-id="${escapeHtml(journey.id)}">Submit Expense</button>`;
    }
    if (journey.status === 'approved' && !hasOdometer) {
      actions += ` <button class="button small" data-action="open-odometer" data-id="${escapeHtml(journey.id)}">Odometer</button>`;
    }
    if (journey.status === 'approved' && hasOdometer && !hasExpense) {
      actions += ` <button class="button small" data-action="open-expense-claim" data-id="${escapeHtml(journey.id)}">Submit Expense</button>`;
    }
    if (journey.route_points && journey.route_points.length > 0) {
      actions += ` <button class="button small" data-action="replay-journey" data-id="${escapeHtml(journey.id)}">Replay</button>`;
    }
    if (journey.status === 'draft') {
      actions = `<button class="button small" data-action="edit-journey" data-id="${escapeHtml(journey.id)}">Edit</button>`;
    }

    return `<tr>
      <td>${dateLabel(journey.travel_date)}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
      <td>${journey.gps_distance_km ? km(journey.gps_distance_km) : '—'}</td>
      <td>${journey.road_distance_km ? km(journey.road_distance_km) : '—'}</td>
      <td>${journey.approved_distance_km ? km(journey.approved_distance_km) : '—'}</td>
      <td>${currency(taDa.ta)} / ${currency(taDa.da)}</td>
      <td>${escapeHtml(journey.notes || '—')}</td>
      <td>${actions || '—'}</td>
    </tr>`;
  }).join('');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('My Travel', `Your field-sales journeys — ${state.month}`,
      `<button class="button primary" type="button" data-action="track-live"><span class="button-icon">📍</span> Live GPS Tracking</button>
       <button class="button" type="button" data-action="new-journey"><span class="button-icon">⊕</span> Add Journey</button>
       <button class="button" type="button" data-action="get-km-covered"><span class="button-icon">🗺</span> Get KM Covered</button>`)}
    <div class="table-wrap">
      <table class="travel-table" role="grid">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
            <th scope="col">GPS KM</th>
            <th scope="col">Road KM</th>
            <th scope="col">Approved KM</th>
            <th scope="col">TA / DA</th>
            <th scope="col">Notes</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>${rowHtml || '<tr><td colspan="8" style="text-align:center;color:var(--muted)">No journeys recorded this month</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// Punch In/Out view for field force employees
async function renderPunch() {
  const user = state.user;
  const employeeId = user.employee_id || '';
  if (!employeeId) {
    document.querySelector('#view-root').innerHTML = `
      ${viewTitle('Punch In/Out', 'GPS location and selfie attendance')}
      <div class="notice warning">This account is not linked to an employee record. Contact an administrator to link your account to an employee, then reload this page.</div>`;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const [punches, settings] = await Promise.all([
    api(`/api/travel/punch?employee_id=${encodeURIComponent(employeeId)}&date=${today}`),
    api('/api/travel-settings')
  ]);

  const hasInPunch = punches.some(p => p.direction === 'in');
  const hasOutPunch = punches.some(p => p.direction === 'out');
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Punch In/Out', 'GPS location and selfie attendance',
      `${hasInPunch ? '' : '<button class="button primary" type="button" data-action="punch-in">📍 Punch In</button>'}
       ${hasInPunch && !hasOutPunch ? '<button class="button" type="button" data-action="punch-out">📤 Punch Out</button>' : ''}`)
    }
    <div class="cards">
      <article class="card">
        <div class="card-label">Date</div>
        <div class="card-value">${dateLabel(today)}</div>
        <div class="card-note">Current time: ${currentTime}</div>
      </article>
      <article class="card">
        <div class="card-label">Status</div>
        <div class="card-value"><span class="status-pill ${hasInPunch ? 'green' : 'amber'}">${hasInPunch ? 'Punched In' : 'Not Punched'}</span></div>
        <div class="card-note">${hasOutPunch ? 'Punched Out' : 'Waiting for punch out'}</div>
      </article>
      <article class="card">
        <div class="card-label">GPS Accuracy</div>
        <div class="card-value">${settings.gps_accuracy_m}m</div>
        <div class="card-note">Max acceptable accuracy</div>
      </article>
    </div>
    <section class="panel" style="margin-top:14px">
      <div class="panel-header"><h3 class="panel-title">Punch History (today)</h3></div>
      <div class="panel-body">
        ${punches.length ? punches.map(p => `
          <div class="list-row">
            <span class="status-pill ${p.direction === 'in' ? 'green' : 'red'}">${p.direction === 'in' ? 'In' : 'Out'}</span>
            <span>${dateLabel(p.punch_date)} · ${currentTime}</span>
            <span class="muted">${p.lat ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : 'GPS unavailable'}</span>
          </div>
        `).join('') : '<div class="notice">No punches recorded today.</div>'}
      </div>
    </section>
  `;
}

// Customer/Doctor master list
async function renderCustomers() {
  const canManageCustomers = ['admin', 'hr'].includes(state.user?.role);
  const [customers, employees] = await Promise.all([
    api('/api/travel/customers'),
    canManageCustomers ? api('/api/employees') : Promise.resolve([])
  ]);
  if (canManageCustomers) state.customerEmployees = employees;

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Customers', 'Doctor/Customer master for field visits',
      canManageCustomers ? `<button class="button primary" type="button" data-action="new-customer">＋ Add Customer</button>` : '')}
    <div class="cards">
      <article class="card">
        <div class="card-label">Total Customers</div>
        <div class="card-value">${customers.length}</div>
        <div class="card-note">Doctors, pharmacies, and other contacts</div>
      </article>
      <article class="card">
        <div class="card-label">Active</div>
        <div class="card-value">${customers.filter(c => c.active).length}</div>
        <div class="card-note">Available for visit scheduling</div>
      </article>
    </div>
    ${customers.length ? `
      <section class="panel" style="margin-top:14px">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Territory</th><th>Status</th></tr></thead>
            <tbody>
              ${customers.map(c => `
                <tr>
                  <td><div class="primary-cell">${escapeHtml(c.name)}</div><div class="secondary-cell">${escapeHtml(c.phone || '—')}</div></td>
                  <td>${escapeHtml(c.customer_type || 'doctor')}</td>
                  <td>${c.lat ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : escapeHtml(c.location || '—')}</td>
                  <td>${escapeHtml(c.territory || '—')}</td>
                  <td><span class="status-pill ${c.active ? 'green' : 'gray'}">${c.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    ` : '<div class="notice" style="margin-top:14px">No customers yet. Add your first doctor or pharmacy contact.</div>'}
  `;
}

// New: Employee Detail view - salary revision + attendance + travel merged
async function renderEmployeeDetail() {
  // Allow selection of employee via URL param or default to first active
  const employeeId = state.selectedEmployeeId || (state.employeeRows?.[0]?.id);
  if (!employeeId) {
    document.querySelector('#view-root').innerHTML = `
      ${viewTitle('Employee Detail', 'Salary revision, attendance, and travel combined')}
      <div class="notice">Select an employee to view details.</div>`;
    return;
  }

  const data = await api(`/api/employee-detail/${encodeURIComponent(employeeId)}?month=${encodeURIComponent(state.month)}`);
  const employee = data.employee;

  const attendanceBySource = {};
  data.attendance.days.forEach(d => {
    const src = d.source || 'manual';
    if (!attendanceBySource[src]) attendanceBySource[src] = 0;
    attendanceBySource[src]++;
  });

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle(`Employee: ${escapeHtml(employee.name)}`, 'Salary revision, attendance, and travel detail',
      `<button class="button small" type="button" data-action="edit-employee" data-id="${escapeHtml(employee.id)}">Edit</button>`)}
    <div class="cards">
      <article class="card"><div class="card-label">Employee ID</div><div class="card-value">${escapeHtml(employee.id)}</div></article>
      <article class="card"><div class="card-label">Department</div><div class="card-value">${escapeHtml(employee.department || '—')}</div></article>
      <article class="card"><div class="card-label">Designation</div><div class="card-value">${escapeHtml(employee.designation || '—')}</div></article>
      <article class="card"><div class="card-label">Monthly CTC</div><div class="card-value">${currency(employee.monthly_ctc)}</div></article>
    </div>

    <div style="margin-top:16px">
      <div class="tabs"><div class="tab active" data-tab="attendance">Attendance</div><div class="tab" data-tab="salary">Salary Revision</div><div class="tab" data-tab="travel">Travel</div><div class="tab" data-tab="leave">Leave</div></div>
    </div>

    <section id="tab-attendance" class="tab-panel active">
      <h3>Attendance Summary (${state.month})</h3>
      <div class="cards">
        <article class="card"><div class="card-label">Present</div><div class="card-value">${data.attendance.summary.present}</div></article>
        <article class="card"><div class="card-value">${data.attendance.summary.absent}</div><div class="card-label">Absent</div></article>
        <article class="card"><div class="card-value">${data.attendance.summary.leave}</div><div class="card-label">Leave</div></article>
      </div>

      <div class="panel" style="margin-top:12px">
        <h4>By Source</h4>
        <div class="list-row-wrap">
          ${Object.entries(attendanceBySource).map(([src, cnt]) => `<div class="list-row"><span class="badge">${escapeHtml(src)}</span> ${cnt} days</div>`).join('')}
        </div>
      </div>

      <div style="margin-top:12px"><button class="button small" type="button" data-action="mark-attendance-today" data-employee="${escapeHtml(employee.id)}">Mark today as Present (customer visit)</button></div>
    </section>

    <section id="tab-salary" class="tab-panel" style="display:none">
      <h3>Salary Revision</h3>
      ${data.salary_revision
        ? `<div class="cards">
            <article class="card"><div class="card-label">Effective Date</div><div class="card-value">${dateLabel(data.salary_revision.effective_date)}</div></article>
            <article class="card"><div class="card-label">Monthly CTC</div><div class="card-value">${currency(data.salary_revision.monthly_ctc)}</div></article>
            ${data.salary_revision.reason ? `<article class="card"><div class="card-label">Reason</div><div class="card-value">${escapeHtml(data.salary_revision.reason)}</div></article>` : ''}
          </div>`
        : `<div class="notice">No salary revision recorded for this employee.</div>`}
    </section>

    <section id="tab-travel" class="tab-panel" style="display:none">
      <h3>Travel History</h3>
      <div class="cards">
        <article class="card"><div class="card-label">Approved KM</div><div class="card-value">${km(data.travel.approved_km_total)}</div></article>
        <article class="card"><div class="card-label">Journeys</div><div class="card-value">${data.travel.journeys.length}</div></article>
      </div>
      ${data.travel.journeys.length ? `
        <div class="table-wrap" style="margin-top:12px">
          <table><thead><tr><th>Date</th><th>Status</th><th>GPS KM</th><th>Approved KM</th></tr></thead><tbody>
            ${data.travel.journeys.map(j => `
              <tr>
                <td>${dateLabel(j.travel_date)}</td>
                <td><span class="status-pill ${j.status === 'approved' ? 'green' : j.status === 'live' ? 'amber' : ''}">${j.status}</span></td>
                <td>${km(j.gps_distance_km)}</td>
                <td>${km(j.approved_distance_km)}</td>
              </tr>
            `).join('')}
          </tbody></table>
        </div>` : `<div class="notice" style="margin-top:12px">No travel recorded.</div>`}
    </section>

    <section id="tab-leave" class="tab-panel" style="display:none">
      <h3>Leave Balance</h3>
      <div class="table-wrap">
        <table><thead><tr><th>Type</th><th>Open</th><th>Accrued</th><th>Used</th><th>Balance</th></tr></thead><tbody>
          ${data.leave.balances.map(b => `
            <tr>
              <td>${escapeHtml(b.leave_name)} (${escapeHtml(b.leave_code)})</td>
              <td>${Number(b.opening_balance).toFixed(1)}</td>
              <td>+${Number(b.accrued).toFixed(1)}</td>
              <td>-${Number(b.used).toFixed(1)}</td>
              <td><strong>${Number(b.closing_balance).toFixed(1)}</strong></td>
            </tr>
          `).join('')}
        </tbody></table>
      </div>
    </section>
  `;

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });
      tab.classList.add('active');
      document.querySelector(`#tab-${tab.dataset.tab}`).style.display = '';
    });
  });
}

// Store last captured selfie blob URL for upload
let punchSelfieBlobUrl = '';
let punchCameraStream = null;

function stopPunchCamera() {
  punchCameraStream?.getTracks().forEach((track) => track.stop());
  punchCameraStream = null;
  const video = document.querySelector('#selfie-camera');
  if (video) video.srcObject = null;
}

async function startPunchCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Live camera capture is unavailable. Use a supported browser over HTTPS.');
  }
  stopPunchCamera();
  punchSelfieBlobUrl = '';
  const video = document.querySelector('#selfie-camera');
  const status = document.querySelector('#selfie-capture-status');
  if (!video) throw new Error('Selfie camera is not available in this form.');
  const preview = document.querySelector('#selfie-img');
  if (preview) preview.hidden = true;
  if (status) status.textContent = 'Requesting front camera access…';
  try {
    punchCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: false
    });
    video.srcObject = punchCameraStream;
    await video.play();
  } catch (error) {
    stopPunchCamera();
    if (status) status.textContent = `Camera unavailable: ${error.message}`;
    throw new Error(`Could not open the front camera: ${error.message}`);
  }
  video.hidden = false;
  document.querySelector('#selfie-img').hidden = true;
  document.querySelector('[data-action="capture-punch-selfie"]').disabled = false;
  document.querySelector('[data-action="start-punch-camera"]').hidden = true;
  if (status) status.textContent = 'Center your face, then capture a live selfie.';
}

function capturePunchSelfie() {
  const video = document.querySelector('#selfie-camera');
  const canvas = document.querySelector('#selfie-canvas');
  const preview = document.querySelector('#selfie-img');
  if (!video?.videoWidth || !canvas || !preview) {
    throw new Error('Wait for the camera preview before capturing your selfie.');
  }
  const scale = Math.min(1, 1280 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the live selfie image.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  punchSelfieBlobUrl = canvas.toDataURL('image/jpeg', 0.78);
  if (punchSelfieBlobUrl.length > 1_800_000) {
    punchSelfieBlobUrl = canvas.toDataURL('image/jpeg', 0.62);
  }
  if (punchSelfieBlobUrl.length > 1_800_000) {
    punchSelfieBlobUrl = '';
    throw new Error('Captured selfie is too large. Move closer to the camera and try again.');
  }
  stopPunchCamera();
  preview.src = punchSelfieBlobUrl;
  preview.hidden = false;
  video.hidden = true;
  document.querySelector('[data-action="capture-punch-selfie"]').disabled = true;
  document.querySelector('[data-action="start-punch-camera"]').hidden = false;
  document.querySelector('[data-action="start-punch-camera"]').textContent = 'Retake live selfie';
  document.querySelector('#selfie-capture-status').textContent = 'Live selfie captured. You can retake it before submitting.';
}

// Open punch in/out modal
async function openPunchModal(direction) {
  punchSelfieBlobUrl = '';
  const isPunchIn = direction === 'in';
  const settings = await api('/api/travel-settings').catch(() => ({ gps_accuracy_m: 25 }));
  const maxAccuracy = settings.gps_accuracy_m || 25;

  openModal(isPunchIn ? 'Punch In' : 'Punch Out', `
    <div class="notice">GPS location and a live camera selfie are required for every punch. Saved photos cannot be selected.</div>
    <form id="punch-form" class="form-grid">
      <input type="hidden" name="direction" value="${direction}">
      <div class="field"><label>Direction</label><div class="field-hint">${direction === 'in' ? 'Start of working day' : 'End of working day'}</div></div>
      <div class="field wide"><label for="punch-location">Location (auto-filled from GPS)</label><input class="control" id="punch-location" name="location" placeholder="lat,lng format" readonly></div>
      <div class="field wide"><label for="punch-lat">Latitude</label><input class="control" id="punch-lat" name="lat" type="number" step="any" inputmode="decimal" readonly></div>
      <div class="field wide"><label for="punch-lng">Longitude</label><input class="control" id="punch-lng" name="lng" type="number" step="any" inputmode="decimal" readonly></div>
      <div class="field wide"><label for="punch-accuracy">GPS Accuracy (m)</label><input class="control" id="punch-accuracy" name="accuracy" type="number" readonly></div>
      <div class="field wide"><label for="selfie-camera">Live selfie (required)</label>
        <div class="selfie-camera">
          <video id="selfie-camera" class="selfie-camera-preview" autoplay playsinline muted hidden></video>
          <img id="selfie-img" class="selfie-camera-preview" alt="Captured live selfie" hidden>
          <canvas id="selfie-canvas" hidden></canvas>
        </div>
        <div class="toolbar selfie-camera-actions">
          <button class="button" type="button" data-action="start-punch-camera">Open front camera</button>
          <button class="button primary" type="button" data-action="capture-punch-selfie" disabled>Capture live selfie</button>
        </div>
        <div id="selfie-capture-status" class="field-hint" role="status">Open the front camera to capture your selfie.</div>
      </div>
      <div class="field wide"><label for="punch-notes">Notes (optional)</label><textarea class="control" id="punch-notes" name="notes" rows="2" placeholder="Brief notes about this punch..."></textarea></div>
    </form>
    <div class="field-hint" id="punch-gps-status" style="margin-top:8px">Checking GPS...</div>
  `, `<button class="button" type="button" data-action="close-modal">Cancel</button>
      <button class="button primary" type="submit" form="punch-form" id="punch-submit">Submit</button>`);

  // Check GPS with accuracy validation
  setTimeout(() => {
    function showGpsStatus(msg, ok) {
      const el = document.querySelector('#punch-gps-status');
      if (!el) return;
      const pill = ok
        ? `<span class="status-pill green">${msg}</span>`
        : `<span class="status-pill red">${msg}</span>`;
      el.innerHTML = pill;
    }
    if (!navigator.geolocation) {
      showGpsStatus('Geolocation not supported — use HTTPS or localhost', false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        const accuracy = position.coords.accuracy;
        const latInput = document.getElementById('punch-lat');
        const lngInput = document.getElementById('punch-lng');
        const accuracyInput = document.getElementById('punch-accuracy');
        const locationInput = document.getElementById('punch-location');

        if (accuracy > maxAccuracy) {
          showGpsStatus(`GPS accuracy too low: ${accuracy.toFixed(0)}m (max ${maxAccuracy}m)`, false);
        } else {
          showGpsStatus(`GPS available · ${accuracy.toFixed(0)}m`, true);
          latInput.value = lat;
          lngInput.value = lng;
          accuracyInput.value = accuracy.toFixed(0);
          locationInput.value = `${lat}, ${lng}`;
        }
      },
      (error) => {
        let reason = 'Unknown error';
        if (error.code === error.PERMISSION_DENIED) reason = 'Permission denied — allow location access';
        else if (error.code === error.POSITION_UNAVAILABLE) reason = 'Location unavailable — check GPS';
        else if (error.code === error.TIMEOUT) reason = 'Timeout — try again';
        showGpsStatus(`GPS unavailable: ${reason}`, false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, 500);
}

// Open new customer modal
function openCustomerModal(customer = null) {
  const isEdit = Boolean(customer);
  const employeeOptions = (state.customerEmployees || []).map(e =>
    `<option value="${e.id}" ${e.id === customer?.employee_id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`
  ).join('');
  const customerTypeOptions = `
    <option value="doctor" ${customer?.customer_type === 'doctor' ? 'selected' : ''}>Doctor</option>
    <option value="pharmacy" ${customer?.customer_type === 'pharmacy' ? 'selected' : ''}>Pharmacy</option>
    <option value="other" ${customer?.customer_type === 'other' ? 'selected' : ''}>Other</option>
  `;
  openModal(isEdit ? 'Edit Customer' : 'Add Customer', `
    <form id="customer-form" class="form-grid">
      <div class="field wide"><label for="customer-employee">Responsible Employee</label>
        <select class="control" id="customer-employee" name="employee_id" required>
          <option value="">Select employee...</option>${employeeOptions}
        </select>
      </div>
      <div class="field"><label for="customer-name">Customer Name</label>
        <input class="control" id="customer-name" name="name" value="${escapeHtml(customer?.name || '')}" required>
      </div>
      <div class="field"><label for="customer-type">Type</label>
        <select class="control" id="customer-type" name="customer_type" required>
          ${customerTypeOptions}
        </select>
      </div>
      <div class="field wide"><label for="customer-location">Address</label>
        <input class="control" id="customer-location" name="location" value="${escapeHtml(customer?.location || '')}">
      </div>
      <div class="field"><label for="customer-lat">Latitude</label>
        <input class="control" id="customer-lat" name="lat" type="number" step="any" inputmode="decimal" value="${customer?.lat || ''}">
      </div>
      <div class="field"><label for="customer-lng">Longitude</label>
        <input class="control" id="customer-lng" name="lng" type="number" step="any" inputmode="decimal" value="${customer?.lng || ''}">
      </div>
      <div class="field wide"><label for="customer-territory">Territory</label>
        <input class="control" id="customer-territory" name="territory" value="${escapeHtml(customer?.territory || '')}">
      </div>
      <div class="field"><label for="customer-phone">Phone</label>
        <input class="control" id="customer-phone" name="phone" value="${escapeHtml(customer?.phone || '')}">
      </div>
      <div class="field wide"><label for="customer-notes">Notes</label>
        <textarea class="control" id="customer-notes" name="notes" rows="2">${customer?.notes || ''}</textarea>
      </div>
      <label class="check-field"><input type="checkbox" name="active" ${customer?.active !== false ? 'checked' : ''}> Active</label>
    </form>
  `, `<button class="button" type="button" data-action="close-modal">Cancel</button>
     <button class="button primary" type="submit" form="customer-form">${isEdit ? 'Update' : 'Add'} Customer</button>`);
}

// Replay journey with map
async function replayJourney(journeyId) {
  try {
    const points = await api(`/api/travel/route-points/${journeyId}`);
    if (!points || !points.length) {
      toast('No route points recorded for this journey.', true);
      return;
    }

    const first = points[0];
    const last = points[points.length - 1];

    const modalContent = `
      <div id="replay-map" style="height:300px;border-radius:8px;margin:4px 0;"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <div class="field"><label>Start Point</label><div class="field-hint">${first.lat.toFixed(4)}, ${first.lng.toFixed(4)}</div></div>
        <div class="field"><label>End Point</label><div class="field-hint">${last.lat.toFixed(4)}, ${last.lng.toFixed(4)}</div></div>
        <div class="field"><label>Total Points</label><div class="field-hint">${points.length}</div></div>
        <div class="field"><label>Total Distance</label><div class="primary-cell">${calculateRouteDistance(points).toFixed(2)} km</div></div>
      </div>
      <div class="notice" style="margin-top:8px;">Click "Play Replay" to watch the journey animation. Use scrubber to control playback.</div>
      <div style="margin-top:8px;">
        <button class="button" type="button" data-action="replay-play">▶ Play Replay</button>
        <button class="button" type="button" data-action="replay-reset">↺ Reset</button>
      </div>
      <input type="range" id="replay-scrubber" min="0" max="${points.length - 1}" value="0" style="width:100%;margin-top:8px;">
    `;

    openModal('Journey Replay', modalContent);

    // Initialize map
    setTimeout(() => {
      if (typeof google === 'undefined' || !google.maps) {
        toast('Map library not loaded.', true);
        return;
      }
      const map = new google.maps.Map(document.querySelector('#replay-map'), {
        center: { lat: first.lat, lng: first.lng },
        zoom: 13,
        zoomControl: true,
        mapTypeId: 'roadmap'
      });

      // Add route line
      const latlngs = points.map(p => ({ lat: p.lat, lng: p.lng }));
      const routeLine = new google.maps.Polyline({
        map,
        path: latlngs,
        strokeColor: '#3b82f6',
        strokeWeight: 4
      });
      const bounds = new google.maps.LatLngBounds();
      latlngs.forEach(p => bounds.extend(p));
      map.fitBounds(bounds);

      // Markers
      const circleIcon = (color, size) => ({
        path: google.maps.SymbolPath.CIRCLE,
        scale: size,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      });
      new google.maps.Marker({ map, position: { lat: first.lat, lng: first.lng }, icon: circleIcon('#10b981', 6), title: 'Start' });
      new google.maps.Marker({ map, position: { lat: last.lat, lng: last.lng }, icon: circleIcon('#ef4444', 6), title: 'End' });

      // Current position marker
      const currentMarker = new google.maps.Marker({
        map,
        position: { lat: first.lat, lng: first.lng },
        icon: circleIcon('#f59e0b', 7),
        title: 'Current'
      });

      let replayInterval = null;
      let currentIndex = 0;

      // Play replay
      document.querySelector('[data-action="replay-play"]').addEventListener('click', () => {
        if (replayInterval) {
          clearInterval(replayInterval);
          replayInterval = null;
          document.querySelector('[data-action="replay-play"]').textContent = '▶ Play Replay';
          return;
        }
        replayInterval = setInterval(() => {
          if (currentIndex >= points.length) {
            clearInterval(replayInterval);
            replayInterval = null;
            document.querySelector('[data-action="replay-play"]').textContent = '▶ Play Replay';
            return;
          }
          const p = points[currentIndex];
          currentMarker.setPosition({ lat: p.lat, lng: p.lng });
          map.setCenter({ lat: p.lat, lng: p.lng });
          document.querySelector('#replay-scrubber').value = currentIndex;
          currentIndex++;
        }, 100);
        document.querySelector('[data-action="replay-play"]').textContent = '⏸ Pause';
      });

      // Reset
      document.querySelector('[data-action="replay-reset"]').addEventListener('click', () => {
        if (replayInterval) clearInterval(replayInterval);
        replayInterval = null;
        currentIndex = 0;
        currentMarker.setPosition({ lat: first.lat, lng: first.lng });
        map.setCenter({ lat: first.lat, lng: first.lng });
        document.querySelector('#replay-scrubber').value = 0;
        document.querySelector('[data-action="replay-play"]').textContent = '▶ Play Replay';
      });

      // Scrubber
      document.querySelector('#replay-scrubber').addEventListener('input', (e) => {
        const idx = parseInt(e.target.value);
        currentIndex = idx;
        const p = points[idx];
        currentMarker.setPosition({ lat: p.lat, lng: p.lng });
        map.setCenter({ lat: p.lat, lng: p.lng });
      });

      // Store map reference for cleanup
      window._replayMap = map;
    }, 100);

  } catch (error) {
    toast(`Failed to load route: ${error.message}`, true);
  }
}

function calculateRouteDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKmClient(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
  }
  return total;
}

// Open odometer modal
async function openOdometerModal(journeyId) {
  openModal('Odometer Verification', `
    <div class="notice">Upload before and after odometer photos. The system will calculate actual distance and compare with claimed distance.</div>
    <form id="odometer-form" class="form-grid" style="margin-top:14px">
      <div class="field wide">
        <label for="odom-before-photo">Before Photo</label>
        <input class="control" id="odom-before-photo" name="before_photo" type="file" accept="image/*">
      </div>
      <div class="field wide">
        <label for="odom-after-photo">After Photo</label>
        <input class="control" id="odom-after-photo" name="after_photo" type="file" accept="image/*">
      </div>
      <div class="field">
        <label for="odom-before">Before Odometer (km)</label>
        <input class="control" id="odom-before" name="before_odometer_km" type="number" step="0.1" required>
      </div>
      <div class="field">
        <label for="odom-after">After Odometer (km)</label>
        <input class="control" id="odom-after" name="after_odometer_km" type="number" step="0.1" required>
      </div>
      <div class="field">
        <label for="odom-claimed">Claimed KM</label>
        <input class="control" id="odom-claimed" name="claimed_km" type="number" step="0.1" required>
      </div>
      <div class="field wide">
        <div id="odom-result" class="field-hint">Results will appear after entering values.</div>
      </div>
    </form>
  `, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="odometer-form">Submit Verification</button>');

  // Add input listeners for real-time calculation
  ['odom-before', 'odom-after', 'odom-claimed'].forEach(id => {
    document.getElementById(id).addEventListener('input', calculateOdometerResult);
  });
}

function calculateOdometerResult() {
  const before = parseFloat(document.getElementById('odom-before').value) || 0;
  const after = parseFloat(document.getElementById('odom-after').value) || 0;
  const claimed = parseFloat(document.getElementById('odom-claimed').value) || 0;
  const actual = Math.max(0, after - before);
  const discrepancy = Math.abs(actual - claimed);

  const resultDiv = document.getElementById('odom-result');
  if (resultDiv) {
    resultDiv.innerHTML = `
      <strong>Actual Distance:</strong> ${actual.toFixed(2)} km<br>
      <strong>Claimed Distance:</strong> ${claimed.toFixed(2)} km<br>
      <strong>Discrepancy:</strong> ${discrepancy.toFixed(2)} km
      ${discrepancy > 0.5 ? '<br><span style="color:var(--danger)">⚠️ Large discrepancy detected</span>' : ''}
    `;
  }
}

async function openExpenseClaimModal(journeyId) {
  try {
    const [journey, settings] = await Promise.all([
      api(`/api/travel/journeys/${journeyId}`),
      api('/api/travel-settings')
    ]);
    const approvedKm = journey.approved_distance_km || 0;
    const taPerKm = settings.ta_per_km || 5;
    const daDaily = settings.da_daily || 150;
    const minDailyKm = settings.min_daily_km || 0;
    const maxDailyKm = settings.max_daily_km || 200;

    // Calculate TA/DA properly
    const payableKm = Math.min(approvedKm, maxDailyKm);
    const ta = Math.round(payableKm * taPerKm * 100) / 100;
    const da = payableKm >= minDailyKm ? Math.round(daDaily * 100) / 100 : 0;
    const total = Math.round((ta + da) * 100) / 100;

    openModal('Submit Expense Claim', `
      <div class="notice">Submit your expense claim based on approved distance. TA/DA will be calculated automatically.</div>
      <form id="expense-form" class="form-grid" style="margin-top:14px">
        <input type="hidden" id="expense-journey" name="journey_id" value="${escapeHtml(journeyId)}">
        <div class="field">
          <label>Approved KM</label>
          <input class="control" id="expense-approved-km" type="text" value="${approvedKm.toFixed(2)}" readonly>
        </div>
        <div class="field">
          <label>TA (${numberToLocaleString(taPerKm)}/km)</label>
          <input class="control" id="expense-ta" type="text" value="₹${ta.toFixed(2)}" readonly>
        </div>
        <div class="field">
          <label>DA (${numberToLocaleString(daDaily)}/day min ${maxDailyKm}km)</label>
          <input class="control" id="expense-da" type="text" value="₹${da.toFixed(2)}" readonly>
        </div>
        <div class="field wide">
          <label>Total Claim</label>
          <input class="control" id="expense-total" type="text" value="₹${total.toFixed(2)}" readonly>
        </div>
        <div class="field wide">
          <label for="expense-type">Expense Type</label>
          <select class="control" id="expense-type" name="expense_type" required>
            <option value="travel">Travel</option>
            <option value="food">Food</option>
            <option value="hotel">Hotel</option>
            <option value="fuel">Fuel</option>
            <option value="toll">Toll</option>
            <option value="parking">Parking</option>
            <option value="accommodation">Accommodation</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="field">
          <label for="expense-amount">Amount (₹)</label>
          <input class="control" id="expense-amount" name="amount" type="number" step="0.01" min="0" required>
        </div>
        <div class="field">
          <label for="expense-date">Expense Date</label>
          <input class="control" id="expense-date" name="expense_date" type="date" value="${new Date().toISOString().slice(0, 10)}" required>
        </div>
        <div class="field wide">
          <label for="expense-desc">Description</label>
          <textarea class="control" id="expense-desc" name="description" rows="2" placeholder="What was this expense for?"></textarea>
        </div>
      </form>
    `, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="expense-form">Submit Claim</button>');
  } catch (error) {
    toast(`Failed to load journey data: ${error.message}`, true);
  }
}

async function renderMySlip() {
  const user = state.user;
  const data = await api(`/api/employee/slip?month=${encodeURIComponent(state.month)}`);
  const { employee, company, month, paidDays, daysInMonth, leaveDays, absentDays, presentReportedDays, weeklyOffDays, holidayDays,
    earnings, deductions, totalDeduction, netPayable, reimbursement, travelTa, travelDa, travelTotal, customEarnings, customDeductions, finalPayable } = data;

  const showPaidDays = company.payslip_show_paid_days !== '0';
  const showLeaveDays = company.payslip_show_leave_days !== '0';
  const showAttendanceSummary = company.payslip_show_attendance_summary !== '0';
  const showAutoGenerated = company.payslip_auto_generated_notice !== '0';
  const footerText = company.payslip_footer_text || 'This is a computer-generated payslip and does not require a signature.';
  const authorizedSignatory = company.payslip_authorized_signatory || '';

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle(`My Payslip · ${month}`, employee.name, `
      <button class="button primary" type="button" data-action="print-slip">Print / Save PDF</button>`)}
    <article class="slip">
      <header class="slip-header">
        <div>
          <div class="slip-company">${escapeHtml(company.company_name || 'Salary statement')}</div>
          <div class="slip-title">Confidential · ${escapeHtml(month)}</div>
          ${company.company_address ? `<div class="slip-address">${escapeHtml(company.company_address).replace(/\n/g, '<br>')}</div>` : ''}
        </div>
        <strong>${escapeHtml(employee.id)}</strong>
      </header>
      <div class="slip-meta">
        <div><strong>Employee</strong>${escapeHtml(employee.name)}</div>
        <div><strong>Employee ID</strong>${escapeHtml(employee.id)}</div>
        <div><strong>Department</strong>${escapeHtml(employee.department || '—')}</div>
        <div><strong>Designation</strong>${escapeHtml(employee.designation || '—')}</div>
        <div><strong>Joining date</strong>${dateLabel(employee.joiningDate)}</div>
        <div><strong>Relieving date</strong>${dateLabel(employee.relievingDate)}</div>
        <div><strong>PAN</strong>${escapeHtml(employee.pan || '—')}</div>
        <div><strong>UAN</strong>${escapeHtml(employee.uan || '—')}</div>
        <div><strong>ESIC number</strong>${escapeHtml(employee.esicNumber || '—')}</div>
        <div><strong>Email</strong>${escapeHtml(employee.email || '—')}</div>
        <div><strong>Bank account</strong>${escapeHtml(employee.bankAccount || '—')}</div>
        <div><strong>IFSC</strong>${escapeHtml(employee.ifsc || '—')}</div>
        <div><strong>Month</strong>${escapeHtml(month)}</div>
        ${showPaidDays && paidDays !== undefined ? `<div><strong>Paid Days</strong>${paidDays} / ${daysInMonth}</div>` : ''}
        ${showLeaveDays && leaveDays !== undefined ? `<div><strong>Leave Days</strong>${leaveDays}</div>` : ''}
        ${showAttendanceSummary && absentDays !== undefined ? `
          <div><strong>Absent Days</strong>${absentDays}</div>
          <div><strong>Present Days</strong>${presentReportedDays}</div>
          <div><strong>Weekly Off</strong>${weeklyOffDays}</div>
          <div><strong>Holidays</strong>${holidayDays}</div>
        ` : ''}
        ${company.company_pan ? `<div><strong>Company PAN</strong>${escapeHtml(company.company_pan)}</div>` : ''}
        ${company.company_tan ? `<div><strong>Company TAN</strong>${escapeHtml(company.company_tan)}</div>` : ''}
        ${company.company_gstin ? `<div><strong>Company GSTIN</strong>${escapeHtml(company.company_gstin)}</div>` : ''}
      </div>
      <div class="slip-columns">
        <section><h3>Salary details</h3>${earnings.map(([label, amount]) => `<div class="slip-item"><span>${escapeHtml(label)}</span><strong>${currency(amount)}</strong></div>`).join('')}</section>
        <section><h3>Deductions</h3>${deductions.map(([label, amount]) => `<div class="slip-item"><span>${escapeHtml(label)}</span><strong>${currency(amount)}</strong></div>`).join('')}
          <div class="slip-item slip-total"><span>Total deduction</span><strong>${currency(totalDeduction)}</strong></div>
          <div class="slip-item"><span>Net payable</span><strong>${currency(netPayable)}</strong></div>
          <div class="slip-item"><span>TA & DA</span><strong>${currency(reimbursement)}</strong></div>
        </section>
      </div>
      <div class="slip-final"><span>Final payable</span><span>${currency(finalPayable)}</span></div>
      ${authorizedSignatory ? `<div class="slip-signatory"><strong>Authorized Signatory</strong><br>${escapeHtml(authorizedSignatory)}</div>` : ''}
      <p class="field-hint">${showAutoGenerated ? '🔹 This is an automatically generated payslip. ' : ''}${footerText}</p>
    </article>
  `;
}

function calculateTaDaClient(approvedKm, settings) {
  if (approvedKm <= 0) return { ta: 0, da: 0 };
  const payableKm = Math.min(approvedKm, settings.max_daily_km);
  if (payableKm <= 0) return { ta: 0, da: 0 };
  const ta = payableKm * settings.ta_per_km;
  const da = payableKm >= settings.min_daily_km ? settings.da_daily : 0;
  return { ta, da };
}

/* Leave management render functions */
async function renderLeave() {
  const [leaveTypes, balances, requests] = await Promise.all([
    api('/api/leave-types'),
    api(`/api/leave-balances?year=${new Date().getFullYear()}`),
    api('/api/leave-requests')
  ]);

  const typeColors = Object.fromEntries(leaveTypes.map(t => [t.code, t.color]));
  const typeNames = Object.fromEntries(leaveTypes.map(t => [t.id, t.name]));

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Leave Management', 'Leave types, balances, and approval workflow',
      '<button class="button primary" type="button" data-action="open-request-modal">＋ Request Leave</button>')}
    <div class="cards">
      <article class="card">
        <div class="card-label">Pending Requests</div>
        <div class="card-value">${requests.filter(r => r.status === 'pending').length}</div>
        <div class="card-note">Awaiting approval</div>
      </article>
      <article class="card">
        <div class="card-label">Approved This Year</div>
        <div class="card-value">${requests.filter(r => r.status === 'approved').length}</div>
        <div class="card-note">Leave requests approved</div>
      </article>
      ${balances.map(b => `
        <article class="card" style="border-left:3px solid ${typeColors[b.leave_code] || '#6366f1'}">
          <div class="card-label">${b.leave_name} (${b.leave_code})</div>
          <div class="card-value">${Number(b.closing_balance).toFixed(1)}</div>
          <div class="card-note">Balance remaining this year</div>
        </article>
      `).join('')}
    </div>
    <section class="panel"><div class="panel-header"><h3 class="panel-title">Leave Types</h3></div><div class="panel-body">
      <div class="list-row-wrap">
        ${leaveTypes.map(t => `<div class="list-row"><span><span class="status-pill" style="background:${t.color};color:#fff">${escapeHtml(t.code)}</span> ${escapeHtml(t.name)}</span><span>${t.accrual_count} day${t.accrual_count !== 1 ? 's' : ''} per ${t.accrual_cycle}</span></div>`).join('')}
      </div>
    </div></section>
    <section class="panel"><div class="panel-header"><h3 class="panel-title">Leave Balances (${new Date().getFullYear()})</h3></div><div class="panel-body">
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Type</th><th>Opening</th><th>Accrued</th><th>Used</th><th>Balance</th></tr></thead>
        <tbody>
          ${balances.map(b => `<tr>
            <td>${escapeHtml(b.employee_name)}</td>
            <td><span class="status-pill" style="background:${typeColors[b.leave_code]}">${escapeHtml(b.leave_name)}</span></td>
            <td>${Number(b.opening_balance).toFixed(1)}</td>
            <td>+${Number(b.accrued).toFixed(1)}</td>
            <td>-${Number(b.used).toFixed(1)}</td>
            <td><strong>${Number(b.closing_balance).toFixed(1)}</strong></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div></section>
    <section class="panel"><div class="panel-header"><h3 class="panel-title">Leave Requests</h3></div><div class="panel-body">
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${requests.map(r => `<tr>
            <td>${escapeHtml(r.employee_name)}</td>
            <td>${escapeHtml(r.leave_name)}</td>
            <td>${dateLabel(r.start_date)}</td>
            <td>${dateLabel(r.end_date)}</td>
            <td>${r.half_day ? 'Half' : Number(r.days).toFixed(1)}</td>
            <td><span class="status-pill status-${r.status}">${escapeHtml(r.status)}</span></td>
            <td>
              ${r.status === 'pending' ? `
                <button class="button small success" data-action="approve-leave" data-id="${escapeHtml(r.id)}">✓</button>
                <button class="button small danger" data-action="reject-leave" data-id="${escapeHtml(r.id)}">✗</button>
              ` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div></section>
  `;
}

function openRequestModal() {
  const today = new Date().toISOString().slice(0, 10);
  api('/api/leave-types').then(types => {
    const typeOptions = types.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.code})</option>`).join('');
    openModal('Request Leave', `
      <form id="leave-request-form" class="form-grid">
        <div class="field"><label for="lr-employee">Employee</label>
          <select class="control" id="lr-employee" name="employee_id" required>
            ${state.user?.role !== 'admin' && state.user?.role !== 'hr'
              ? `<option value="${state.user.employee_id}">${state.user.username}</option>`
              : '<option value="">Select employee...</option>'}
          </select>
        </div>
        <div class="field"><label for="lr-type">Leave Type</label>
          <select class="control" id="lr-type" name="leave_type_id" required>${typeOptions}</select>
        </div>
        <div class="field"><label for="lr-start">Start Date</label>
          <input class="control" id="lr-start" name="start_date" type="date" value="${today}" required>
        </div>
        <div class="field"><label for="lr-end">End Date</label>
          <input class="control" id="lr-end" name="end_date" type="date" value="${today}" required>
        </div>
        <div class="field"><label for="lr-days">Number of Days</label>
          <input class="control" id="lr-days" name="days" type="number" step="0.5" min="0.5" max="365" value="1" required>
        </div>
        <div class="field"><label for="lr-halfday">Half Day</label>
          <label class="check-field"><input type="checkbox" name="half_day" value="1"> Check for half day</label>
        </div>
        <div class="field wide"><label for="lr-reason">Reason</label>
          <textarea class="control" id="lr-reason" name="reason" rows="2" placeholder="Optional reason..."></textarea>
        </div>
      </form>
    `, '<button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit" form="leave-request-form">Submit Request</button>');
  });
}

/* ============================================================
   TrackOlap Modal Functions
   ============================================================ */

async function openSampleModal(sample = null) {
  const isEdit = Boolean(sample);
  const employeeOptions = (state.employeeRows || []).map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  openModal(isEdit ? 'Edit Sample' : 'Record Sample Allocation', `
    <form id="sample-form" class="form-grid"${isEdit ? ` data-id="${sample.id}"` : ''}>
      <div class="field"><label for="sample-employee">Employee</label>
        <select class="control" id="sample-employee" name="employee_id" required>
          <option value="">Select employee...</option>${employeeOptions}
        </select>
      </div>
      <div class="field"><label for="sample-name">Sample Name</label>
        <input class="control" id="sample-name" name="sample_name" value="${escapeHtml(sample?.sample_name || '')}" required>
      </div>
      <div class="field"><label for="sample-batch">Batch Number</label>
        <input class="control" id="sample-batch" name="batch_number" value="${escapeHtml(sample?.batch_number || '')}" required>
      </div>
      <div class="field"><label for="sample-quantity">Quantity</label>
        <input class="control" id="sample-quantity" name="quantity" type="number" min="1" value="${sample?.quantity || 1}" required>
      </div>
      <div class="field"><label for="sample-unit">Unit</label>
        <input class="control" id="sample-unit" name="unit" value="${escapeHtml(sample?.unit || 'piece')}" required>
      </div>
      <div class="field"><label for="sample-date">Allocated Date</label>
        <input class="control" id="sample-date" name="allocated_at" type="date" value="${sample?.allocated_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)}" required>
      </div>
      <div class="field wide"><label for="sample-notes">Notes</label>
        <textarea class="control" id="sample-notes" name="notes" rows="2">${sample?.notes || ''}</textarea>
      </div>
      ${isEdit ? `
      <div class="field"><label>Status</label>
        <select class="control" id="sample-status" name="status">
          <option value="allocated" ${sample?.status === 'allocated' ? 'selected' : ''}>Allocated</option>
          <option value="consumed" ${sample?.status === 'consumed' ? 'selected' : ''}>Consumed</option>
          <option value="returned" ${sample?.status === 'returned' ? 'selected' : ''}>Returned</option>
          <option value="lost" ${sample?.status === 'lost' ? 'selected' : ''}>Lost</option>
        </select>
      </div>
      ` : ''}
    </form>
  `, `<button class="button" type="button" data-action="close-modal">Cancel</button>
     <button class="button primary" type="submit" form="sample-form">${isEdit ? 'Update' : 'Record'} Sample</button>`);
}

async function openOrderModal() {
  const products = await api('/api/products');
  const productOptions = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} - ₹${p.unit_price}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);

  openModal('Create Order', `
    <form id="order-form" class="form-grid">
      <div class="field"><label for="order-date">Order Date</label>
        <input class="control" id="order-date" name="order_date" type="date" value="${today}" required>
      </div>
      <div class="field wide"><label for="order-product">Product</label>
        <select class="control" id="order-product" name="product_id" required>${productOptions}</select>
      </div>
      <div class="field"><label for="order-quantity">Quantity</label>
        <input class="control" id="order-quantity" name="quantity" type="number" min="1" value="1" required>
      </div>
      <div class="field"><label for="order-price">Unit Price (₹)</label>
        <input class="control" id="order-price" name="unit_price" type="number" step="0.01" min="0" value="0" required>
      </div>
      <div class="field wide"><label for="order-notes">Notes</label>
        <textarea class="control" id="order-notes" name="notes" rows="2"></textarea>
      </div>
    </form>
  `, `<button class="button" type="button" data-action="close-modal">Cancel</button>
     <button class="button primary" type="submit" form="order-form">Create Order</button>`);
}

async function openTaskModal(task = null) {
  const isEdit = Boolean(task);
  const employeeOptions = (state.employeeRows || []).map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');

  openModal(isEdit ? 'Edit Task' : 'Create Task', `
    <form id="task-form" class="form-grid">
      <div class="field"><label for="task-employee">Employee</label>
        <select class="control" id="task-employee" name="employee_id" required>
          <option value="">Select employee...</option>${employeeOptions}
        </select>
      </div>
      <div class="field"><label for="task-title">Title</label>
        <input class="control" id="task-title" name="title" value="${escapeHtml(task?.title || '')}" required>
      </div>
      <div class="field"><label for="task-type">Type</label>
        <select class="control" id="task-type" name="task_type">
          <option value="visit" ${task?.task_type === 'visit' ? 'selected' : ''}>Visit</option>
          <option value="order" ${task?.task_type === 'order' ? 'selected' : ''}>Order</option>
          <option value="sample" ${task?.task_type === 'sample' ? 'selected' : ''}>Sample</option>
          <option value="collection" ${task?.task_type === 'collection' ? 'selected' : ''}>Collection</option>
          <option value="other" ${task?.task_type === 'other' ? 'selected' : ''}>Other</option>
        </select>
      </div>
      <div class="field"><label for="task-priority">Priority</label>
        <select class="control" id="task-priority" name="priority">
          <option value="low" ${task?.priority === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${task?.priority === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>High</option>
          <option value="urgent" ${task?.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
        </select>
      </div>
      <div class="field"><label for="task-due">Due Date</label>
        <input class="control" id="task-due" name="due_date" type="date">
      </div>
      <div class="field wide"><label for="task-description">Description</label>
        <textarea class="control" id="task-description" name="description" rows="2">${task?.description || ''}</textarea>
      </div>
      ${isEdit ? `
      <div class="field"><label>Status</label>
        <select class="control" id="task-status" name="status">
          <option value="open" ${task?.status === 'open' ? 'selected' : ''}>Open</option>
          <option value="in_progress" ${task?.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="completed" ${task?.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="cancelled" ${task?.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </div>
      ` : ''}
    </form>
  `, `<button class="button" type="button" data-action="close-modal">Cancel</button>
     <button class="button primary" type="submit" form="task-form">${isEdit ? 'Update' : 'Create'} Task</button>`);
}

async function renderMyLeave() {
  const user = state.user;
  const [leaveTypes, balances, requests] = await Promise.all([
    api('/api/leave-types'),
    api(`/api/leave-balances?year=${new Date().getFullYear()}&employee_id=${encodeURIComponent(user.employee_id)}`),
    api(`/api/leave-requests?employee_id=${encodeURIComponent(user.employee_id)}`)
  ]);

  const typeColors = Object.fromEntries(leaveTypes.map(t => [t.code, t.color]));

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('My Leave', 'View your leave balance and request leave')}
    <div class="cards">
      ${balances.map(b => `
        <article class="card" style="border-left:3px solid ${typeColors[b.leave_code] || '#6366f1'}">
          <div class="card-label">${b.leave_name} (${b.leave_code})</div>
          <div class="card-value">${Number(b.closing_balance).toFixed(1)}</div>
          <div class="card-note">Available this year</div>
        </article>
      `).join('')}
    </div>
    <div style="margin-top:16px">
      <button class="button primary" type="button" data-action="open-my-request-modal">＋ Request Leave</button>
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-header"><h3 class="panel-title">My Leave History</h3></div><div class="panel-body">
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th></tr></thead>
        <tbody>
          ${requests.map(r => `<tr>
            <td>${escapeHtml(r.leave_name)}</td>
            <td>${dateLabel(r.start_date)}</td>
            <td>${dateLabel(r.end_date)}</td>
            <td>${r.half_day ? 'Half' : Number(r.days).toFixed(1)}</td>
            <td><span class="status-pill status-${r.status}">${escapeHtml(r.status)}</span></td>
          </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No leave requests yet</td></tr>'}
        </tbody>
      </table></div>
    </div></section>
  `;
}

/* ============================================================
   Route Playback Views - Employee and Manager
   ============================================================ */
async function renderRoutePlayback() {
  const user = state.user;
  if (user.role === 'employee') {
    // Employee sees their own route
    await renderMyRoute();
    return;
  }

  // Manager view - select employee
  const employees = state.employeeRows || await api('/api/employees');
  const selectedEmployeeId = state.selectedEmployeeId || (employees[0]?.id);

  const [employeeData, routes] = await Promise.all([
    api(`/api/employees/${encodeURIComponent(selectedEmployeeId || '')}/route-playback?month=${encodeURIComponent(state.month)}`),
    api(`/api/employees/${encodeURIComponent(selectedEmployeeId || '')}/route-playback?month=${encodeURIComponent(state.month)}`)
  ]);

  const showSelfies = employeeData.selfies && employeeData.selfies.length > 0;
  const hasRoutes = routes.journeys && routes.journeys.length > 0;

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Route Playback', `Field routes for ${employeeData.employee_name || selectedEmployeeId}`,
      `<select class="control" id="route-employee-select">
        ${employees.map(e => `<option value="${escapeHtml(e.id)}" ${e.id === selectedEmployeeId ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
      </select>
      <label class="check-field"><input type="checkbox" id="show-selfies" ${showSelfies ? 'checked' : ''}> Show selfies</label>`)}

    <div class="cards">
      <article class="card"><div class="card-label">Total Routes</div><div class="card-value">${routes.journeys?.length || 0}</div></article>
      <article class="card"><div class="card-value">${routes.journeys?.reduce((sum, j) => sum + (Number(j.approved_distance_km) || 0), 0) || 0}</div><div class="card-label">Total KM</div></article>
      ${showSelfies ? `<article class="card"><div class="card-value">${employeeData.selfies.length}</div><div class="card-label">Selfies Recorded</div></article>` : ''}
    </div>

    ${hasRoutes ? `
      <section class="panel" style="margin-top:14px">
        <h3>Route Map</h3>
        <div id="route-map-container" style="height:320px;border:1px solid #e2e8f0;border-radius:12px;margin-top:12px"></div>
        <div style="margin-top:12px">
          <button class="button small" type="button" data-action="toggle-satellite-map">Switch to Satellite</button>
        </div>
      </section>
    ` : `<div class="notice" style="margin-top:14px">No routes recorded for this month yet.</div>`}

    ${routes.journeys?.length > 0 ? `
      <section class="panel" style="margin-top:14px">
        <h3>Journey Details</h3>
        <div class="journey-list">
          ${routes.journeys.map(j => `
            <article class="card journey-card">
              <div class="journey-header">
                <strong>${escapeHtml(j.destination || 'Travel')} (${dateLabel(j.travel_date)})</strong>
              </div>
              <div class="journey-meta">
                <span>KM: ${Number(j.approved_distance_km || j.gps_distance_km || 0).toFixed(1)}</span>
                <span>Status: <span class="status-pill ${j.status}">${escapeHtml(j.status)}</span></span>
              </div>
              ${j.start_lat && j.end_lat ? `<div class="journey-coords">
                From: [${Number(j.start_lat).toFixed(4)}, ${Number(j.start_lng).toFixed(4)}]
                To: [${Number(j.end_lat).toFixed(4)}, ${Number(j.end_lng).toFixed(4)}]
              </div>` : ''}
            </article>
          `).join('')}
        </div>
      </section>
    ` : ''}

    ${showSelfies ? `
      <section class="panel" style="margin-top:14px">
        <h3>Selfies Captured</h3>
        <div class="table-wrap">
          <table><thead><tr><th>Date</th><th>Time</th><th>Status</th></tr></thead><tbody>
            ${employeeData.selfies.map(s => `
              <tr>
                <td>${dateLabel(s.travel_date)}</td>
                <td>${new Date(s.recorded_at).toLocaleTimeString()}</td>
                <td><span class="status-pill ${s.face_verified ? 'green' : 'amber'}">${s.face_verified ? 'Verified' : 'Not Verified'}</span></td>
              </tr>
            `).join('')}
          </tbody></table>
        </div>
      </section>
    ` : ''}
  `;

  // Load Google Maps and create map after render
  if (typeof google !== 'undefined' && google.maps && routes.journeys?.length && routes.journeys.some(j => j.start_lat && j.end_lat)) {
    const routesAfterRender = routes.journeys; // capture for closure
    setTimeout(() => {
      const container = document.querySelector('#route-map-container');
      if (!container) return;
      if (!window.routeMap) {
        window.routeMap = new google.maps.Map(container, {
          center: { lat: 20.5937, lng: 78.9629 },
          zoom: 5,
          mapTypeControl: true,
          zoomControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeId: 'roadmap'
        });
      }

      // Fit bounds to show all routes
      const bounds = new google.maps.LatLngBounds();
      routesAfterRender.forEach(j => {
        if (j.start_lat) bounds.extend({ lat: Number(j.start_lat), lng: Number(j.start_lng) });
        if (j.end_lat) bounds.extend({ lat: Number(j.end_lat), lng: Number(j.end_lng) });
      });
      if (!bounds.isEmpty()) window.routeMap.fitBounds(bounds, 50);

      // Group routes by color based on status
      const statusColors = {
        'approved': '#10b981',
        'pending': '#f59e0b',
        'rejected': '#ef4444',
        'completed': '#3b82f6'
      };

      // Add route lines and markers with location names
      routesAfterRender.forEach(journey => {
        if (journey.start_lat && journey.end_lat) {
          const color = statusColors[journey.status?.toLowerCase()] || '#3b82f6';
          const dest = journey.destination || 'Destination';
          new google.maps.Polyline({
            map: window.routeMap,
            path: [
              { lat: Number(journey.start_lat), lng: Number(journey.start_lng) },
              { lat: Number(journey.end_lat), lng: Number(journey.end_lng) }
            ],
            strokeColor: color,
            strokeWeight: 3,
            strokeOpacity: 0.7
          });

          const letterIcon = (letter, bg) => ({
            path: google.maps.SymbolPath.CIRCLE,
            scale: 13,
            fillColor: bg,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            label: { text: letter, color: '#fff', font: 'bold 10px Arial' }
          });

          const startMarker = new google.maps.Marker({
            map: window.routeMap,
            position: { lat: Number(journey.start_lat), lng: Number(journey.start_lng) },
            icon: letterIcon(dest[0] || 'A', color),
            title: dest
          });
          startMarker.addListener('click', () => {
            const info = new google.maps.InfoWindow({
              content: `<strong>${escapeHtml(dest)}</strong><br>Start<br>[${Number(journey.start_lat).toFixed(4)}, ${Number(journey.start_lng).toFixed(4)}]`
            });
            info.open(window.routeMap, startMarker);
          });

          if (journey.end_lat && journey.end_lng) {
            const endDest = journey.end_location || 'End Point';
            const endMarker = new google.maps.Marker({
              map: window.routeMap,
              position: { lat: Number(journey.end_lat), lng: Number(journey.end_lng) },
              icon: letterIcon('B', '#ef4444'),
              title: endDest
            });
            endMarker.addListener('click', () => {
              const info = new google.maps.InfoWindow({
                content: `<strong>${escapeHtml(endDest)}</strong><br>End<br>[${Number(journey.end_lat).toFixed(4)}, ${Number(journey.end_lng).toFixed(4)}]`
              });
              info.open(window.routeMap, endMarker);
            });
          }
        }
      });
    }, 100);
  }

  state.selectedEmployeeId = selectedEmployeeId;
}

async function renderMyRoute() {
  const user = state.user;
  const employeeId = user.employee_id;
  const month = state.month;

  if (!employeeId) {
    document.querySelector('#view-root').innerHTML = `
      ${viewTitle('My Route', 'Your GPS routes and selfies')}
      <div class="notice warning">This account is not linked to an employee record. Contact administrator for access.</div>`;
    return;
  }

  const data = await api(`/api/employee/route-playback?month=${encodeURIComponent(month)}`);

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('My Route', `Your GPS routes for ${month}`)}

    <div class="cards">
      <article class="card"><div class="card-label">Routes Recorded</div><div class="card-value">${data.journeys.length}</div></article>
      <article class="card"><div class="card-value">${data.journeys.reduce((sum, j) => sum + (Number(j.gps_distance_km) || 0), 0)}</div><div class="card-label">GPS KM</div></article>
      ${data.selfies.length > 0 ? `<article class="card"><div class="card-value">${data.selfies.length}</div><div class="card-label">Selfies</div></article>` : ''}
    </div>

    ${data.journeys.length ? `
      <section class="panel" style="margin-top:14px">
        <h3>Your Route Timeline</h3>
        <div id="journey-timeline" style="margin-top:12px"></div>
      </section>
      <section class="panel" style="margin-top:14px">
        <h3>Your Routes on Map</h3>
        <div id="my-route-map" style="height:280px;border:1px solid #e2e8f0;border-radius:12px"></div>
        <div style="margin-top:12px">
          <button class="button small" type="button" data-action="toggle-satellite-map">Switch to Satellite</button>
        </div>
      </section>
    ` : `<div class="notice" style="margin-top:14px">No routes recorded yet. Start tracking from the Punch In/Out view.</div>`}

    ${data.selfies.length ? `
      <section class="panel" style="margin-top:14px">
        <h3>Selfies Captured</h3>
        <div class="grid-gutter">
          ${data.selfies.map(s => `
            <a href="${s.image_data || '#'}" class="card selfie-card" target="_blank" style="display:inline-block;width:120px;overflow:hidden;border-radius:8px;overflow:hidden">
              <img src="${s.image_data || 'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><text x=\"50\" y=\"55\" text-anchor=\"middle\" font-size=\"14\">No Image</text></svg>'}"
                   alt="Selfie" style="width:100%;height:80px;object-fit:cover">
              <div style="padding:6px">${dateLabel(s.travel_date)}</div>
            </a>
          `).join('')}
        </div>
      </section>
    ` : ''}
  `;

  // Create timeline visualization
  if (data.journeys.length) {
    const timeline = document.getElementById('journey-timeline');
    const totalKm = data.journeys.reduce((sum, j) => sum + (Number(j.gps_distance_km || j.approved_distance_km || 0)), 0);
    const timelineHTML = `
      <div class="timeline-visual" style="margin:12px 0">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="width:80px;font-weight:600">Date</span>
          <div style="flex:1">
            <div style="background:#f1f5f9;border-radius:6px;height:24px;display:flex;overflow:hidden">
              ${data.journeys.map((j, i) => {
                const pct = (Number(j.approved_distance_km || j.gps_distance_km || 0) / totalKm * 100) || 10;
                return `<div style="width:${pct}%;background:#3b82f6;display:flex;align-items:center;justify-content:center;min-width:${pct > 10 ? '40px' : '20px'};font-size:10px;color:#fff;font-weight:600">${dateLabel(j.travel_date).slice(5)}</div>`;
              }).join('')}
            </div>
          </span>
        </div>
      </div>
      <table style="width:100%;font-size:13px">
        <thead><tr><th style="text-align:left">Date</th><th>Destination</th><th>KM</th><th>Status</th></tr></thead>
        <tbody>
          ${data.journeys.map(j => `
            <tr style="border-bottom:1px solid #e2e8f0;padding:8px 0">
              <td>${dateLabel(j.travel_date)}</td>
              <td>${escapeHtml(j.destination || 'Travel')}</td>
              <td>${Number(j.gps_distance_km || j.approved_distance_km || 0).toFixed(1)}</td>
              <td><span class="status-pill">${escapeHtml(j.status || 'completed')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    timeline.innerHTML = timelineHTML;
  }

  // Initialize employee map with satellite option
  if (typeof google !== 'undefined' && google.maps && data.journeys.length && data.journeys.some(j => j.start_lat && j.end_lat)) {
    setTimeout(() => {
      const container = document.querySelector('#my-route-map');
      if (!container) return;
      if (!window.myRouteMap) {
        window.myRouteMap = new google.maps.Map(container, {
          center: { lat: 20.5937, lng: 78.9629 },
          zoom: 5,
          mapTypeControl: true,
          zoomControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeId: 'roadmap'
        });
      }

      // Fit map to all routes
      const bounds = new google.maps.LatLngBounds();
      data.journeys.forEach(j => {
        if (j.start_lat) bounds.extend({ lat: Number(j.start_lat), lng: Number(j.start_lng) });
        if (j.end_lat) bounds.extend({ lat: Number(j.end_lat), lng: Number(j.end_lng) });
      });
      if (!bounds.isEmpty()) window.myRouteMap.fitBounds(bounds, 50);

      // Add route lines
      const journeyColors = ['#0d9488', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
      data.journeys.forEach((journey, idx) => {
        if (journey.start_lat && journey.end_lat) {
          const color = journeyColors[idx % journeyColors.length];
          new google.maps.Polyline({
            map: window.myRouteMap,
            path: [
              { lat: Number(journey.start_lat), lng: Number(journey.start_lng) },
              { lat: Number(journey.end_lat), lng: Number(journey.end_lng) }
            ],
            strokeColor: color,
            strokeWeight: 4,
            strokeOpacity: 0.8
          });

          // Add markers with village/hospital names
          const letterIcon = (letter, bg) => ({
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: bg,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            label: { text: letter, color: '#fff', font: 'bold 10px Arial' }
          });
          const startMarker = new google.maps.Marker({
            map: window.myRouteMap,
            position: { lat: Number(journey.start_lat), lng: Number(journey.start_lng) },
            icon: letterIcon('A', color),
            title: journey.destination || 'Origin'
          });
          startMarker.addListener('click', () => {
            const info = new google.maps.InfoWindow({
              content: `<strong>Start</strong><br>${escapeHtml(journey.destination || 'Origin')}<br>${Number(journey.start_lat).toFixed(4)}, ${Number(journey.start_lng).toFixed(4)}`
            });
            info.open(window.myRouteMap, startMarker);
          });
        }
      });
    }, 100);
  }
}

/* ============================================================
   Expenses Management - Configurable Sequential Approval
   ============================================================ */
async function renderExpenses() {
  const user = state.user;
  const canManage = ['admin', 'hr', 'payroll'].includes(user.role);

  let expenses;
  if (user.role === 'employee') {
    const [mine, approvals] = await Promise.all([
      api('/api/expenses/mine'),
      api('/api/expenses/approvals')
    ]);
    expenses = [...mine, ...approvals];
  } else {
    expenses = await api('/api/expenses');
  }

  const statusLabels = {
    pending: 'Pending',
    area_approved: 'Area Approved',
    regional_approved: 'Regional Approved',
    dept_approved: 'Dept Approved',
    finance_approved: 'Finance Approved',
    rejected: 'Rejected',
    returned: 'Returned',
    paid: 'Paid'
  };

  const levelLabels = {
    4: 'Area Manager',
    3: 'Regional Manager',
    2: 'Department Head',
    1: 'HR Admin',
    0: 'Finance'
  };

  const typeColors = {
    travel: 'var(--color-primary)',
    food: 'var(--color-success)',
    hotel: 'var(--color-warning)',
    fuel: '#f97316',
    toll: 'var(--color-text-muted)',
    parking: 'var(--color-text-muted)',
    accommodation: 'var(--color-warning)',
    other: 'var(--color-text-muted)'
  };

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Expenses', 'Track, approve and manage travel & office expenses',
      '<button class="button primary" type="button" data-action="open-expense-modal">＋ Submit Expense</button>')}

    <section class="panel" style="margin-top:14px">
      <div class="panel-header">
        <h3 class="panel-title">${canManage ? 'All Expenses' : user.role === 'employee' ? 'My Expenses & Approvals' : 'My Expenses'}</h3>
      </div>
      <div class="panel-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
                <th>Approval Hierarchy</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${expenses.map(e => `
                <tr>
                  <td class="primary-cell">${escapeHtml(e.employee_name || e.employee_id)}</td>
                  <td><span style="color:${typeColors[e.expense_type] || 'inherit'}">${escapeHtml(e.expense_type)}</span></td>
                  <td>₹${Number(e.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>${dateLabel(e.expense_date)}</td>
                  <td><span class="status-pill ${e.status}">${statusLabels[e.status] || e.status}</span></td>
                  <td><ol class="expense-approval-chain">
                    ${(e.approval_chain || []).map((step) => {
                      const active = e.status === 'pending' && Number(step.order_index) === Number(e.current_approver_level);
                      const completed = ['finance_approved', 'paid'].includes(e.status)
                        || e.status === 'pending' && Number(step.order_index) > Number(e.current_approver_level);
                      const designation = designationGuideEntry(step.level_name) || designationGuideEntry(step.designation_required);
                      return `<li class="${active ? 'current' : completed ? 'completed' : ''}">
                        <span>${escapeHtml(step.level_name)}${step.auto_approve ? ' · automatic' : ''}${active ? ' · current' : ''}</span>
                        ${designation ? `<small class="expense-approval-description">${escapeHtml(designation.description)}</small>` : ''}
                      </li>`;
                    }).join('') || `<li>${e.current_approver_level ? escapeHtml(levelLabels[e.current_approver_level] || 'Legacy approval') : 'No approval steps configured'}</li>`}
                  </ol></td>
                  <td>
                    ${(canManage || e.can_approve_current) && e.status === 'pending' ? `
                      <button class="button small" type="button" data-action="approve-expense" data-id="${escapeHtml(e.id)}">Approve</button>
                      <button class="button small" type="button" data-action="reject-expense" data-id="${escapeHtml(e.id)}">Reject</button>
                    ` : e.status === 'finance_approved' && canManage ? `
                      <button class="button small primary" type="button" data-action="pay-expense" data-id="${escapeHtml(e.id)}">Mark Paid</button>
                    ` : ''}
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted)">No expenses found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>

  `;
}

async function renderMyApprovals() {
  const { pending, history } = await api('/api/approvals/inbox');
  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('My Approvals', 'Requests currently routed to you, followed by decisions you have recorded.')}
    <section class="panel">
      <div class="panel-header"><h3 class="panel-title">Pending requests</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Request</th><th>Employee</th><th>Date</th><th>Amount</th><th>Step</th><th>Reason</th><th>Actions</th></tr></thead><tbody>
        ${pending.map((request) => `<tr>
          <td class="primary-cell">${escapeHtml(request.title || request.request_type)}<div class="secondary-cell">${request.request_type === 'expense' ? 'Expense' : 'Attendance'}</div></td>
          <td>${escapeHtml(request.employee_name || request.employee_id)}</td>
          <td>${dateLabel(request.expense_date || request.work_date)}</td>
          <td>${request.amount == null ? '—' : currency(request.amount)}</td>
          <td>${escapeHtml(request.level_name || request.designation_required || request.role_required || 'Configured approver')}</td>
          <td>${escapeHtml(request.description || request.reason || '—')}</td>
          <td><div class="toolbar">
            ${canAccessModule(request.request_type === 'expense' ? 'expenses' : 'attendance', 'approve') ? `<button class="button small primary" type="button" data-action="process-my-approval" data-type="${escapeHtml(request.request_type)}" data-id="${escapeHtml(request.request_id)}" data-status="approved">Approve</button>` : ''}
            ${canAccessModule(request.request_type === 'expense' ? 'expenses' : 'attendance', 'reject') ? `<button class="button small danger" type="button" data-action="process-my-approval" data-type="${escapeHtml(request.request_type)}" data-id="${escapeHtml(request.request_id)}" data-status="rejected">Reject</button>` : ''}
          </div></td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty-state">No requests are currently assigned to you.</div></td></tr>'}
      </tbody></table></div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header"><h3 class="panel-title">Your approval history</h3></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Request</th><th>Employee</th><th>Decision</th><th>Comments</th><th>Current status</th></tr></thead><tbody>
        ${history.map((entry) => `<tr>
          <td>${escapeHtml(entry.created_at)}</td>
          <td class="primary-cell">${escapeHtml(entry.title || entry.request_type)}<div class="secondary-cell">${escapeHtml(entry.request_type)} · ${dateLabel(entry.request_date)}</div></td>
          <td>${escapeHtml(entry.employee_name)}</td><td>${escapeHtml(entry.action)}</td>
          <td>${escapeHtml(entry.comments || '—')}</td><td>${escapeHtml(entry.status)}</td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">No approval decisions recorded yet.</div></td></tr>'}
      </tbody></table></div>
    </section>`;
}

async function openExpenseModal() {
  const user = state.user;
  const canManage = ['admin', 'hr', 'payroll'].includes(user.role);

  openModal('Submit Expense', `
    <form id="expense-form" class="form-grid">
      ${canManage ? `
      <div class="field"><label for="expense-employee">Employee</label>
        <select class="control" id="expense-employee" name="employee_id">
          <option value="">Select employee...</option>
          ${(state.employeeRows || []).map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="field"><label for="expense-type">Expense Type</label>
        <select class="control" id="expense-type" name="expense_type" required>
          <option value="travel">Travel</option>
          <option value="food">Food</option>
          <option value="hotel">Hotel</option>
          <option value="fuel">Fuel</option>
          <option value="toll">Toll</option>
          <option value="parking">Parking</option>
          <option value="accommodation">Accommodation</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field"><label for="expense-amount">Amount (₹)</label>
        <input class="control" id="expense-amount" name="amount" type="number" step="0.01" min="0" required>
      </div>
      <div class="field"><label for="expense-date">Expense Date</label>
        <input class="control" id="expense-date" name="expense_date" type="date" value="${new Date().toISOString().slice(0, 10)}">
      </div>
      <div class="field wide"><label for="expense-desc">Description</label>
        <textarea class="control" id="expense-desc" name="description" rows="2" placeholder="What was this expense for?"></textarea>
      </div>
      <div class="field"><label for="expense-journey">Journey ID (optional)</label>
        <input class="control" id="expense-journey" name="journey_id" type="text">
      </div>
    </form>
  `, `<button class="button" type="button" data-action="close-modal">Cancel</button>
     <button class="button primary" type="submit" form="expense-form">Submit Expense</button>`);
}

/* ============================================================
   TrackOlap Feature Views - Samples, Orders, Shifts, Tasks
   ============================================================ */

async function renderSamples() {
  const canManage = ['admin', 'hr', 'payroll'].includes(state.user?.role);
  const samples = await api('/api/samples');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Sample Tracking', 'Track promotional samples and field inputs',
      canManage ? '<button class="button primary" type="button" data-action="new-sample">＋ Record Sample</button>' : '')}
    <div class="cards">
      <article class="card"><div class="card-label">Total Allocated</div><div class="card-value">${samples.filter(s => s.status === 'allocated').length}</div><div class="card-note">Ready for field use</div></article>
      <article class="card"><div class="card-label">Returned</div><div class="card-value">${samples.filter(s => s.status === 'returned').length}</div><div class="card-note">Collected from field</div></article>
      <article class="card"><div class="card-value">${samples.filter(s => s.status === 'consumed').length}</div><div class="card-label">Consumed</div><div class="card-note">Marked as used</div></article>
    </div>
    ${samples.length ? `
      <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Sample Allocations</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Sample</th><th>Batch</th><th>Qty</th><th>Allocated</th><th>Status</th></tr></thead>
        <tbody>
          ${samples.map(s => `
            <tr>
              <td>${escapeHtml(s.sample_name)}</td>
              <td><code>${escapeHtml(s.batch_number)}</code></td>
              <td>${Number(s.quantity)} ${s.unit}</td>
              <td>${dateLabel(s.allocated_at)}</td>
              <td><span class="status-pill status-${s.status}">${escapeHtml(s.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div></div>
    ` : '<div class="notice" style="margin-top:14px">No samples recorded yet. Start tracking field inputs!</div>'}
  `;
}

async function renderOrders() {
  const canManage = ['admin', 'hr', 'payroll'].includes(state.user?.role);
  const [orders, products] = await Promise.all([
    api('/api/orders'),
    api('/api/products')
  ]);

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Chemist Orders', 'Browse products and book orders for dispatch',
      canManage ? '<button class="button primary" type="button" data-action="new-order">＋ New Order</button>' : '')}
    <div class="cards">
      <article class="card"><div class="card-label">Total Orders</div><div class="card-value">${orders.length}</div><div class="card-note">All orders placed</div></article>
      <article class="card"><div class="card-value">${orders.filter(o => ['confirmed', 'dispatched', 'delivered'].includes(o.status)).length}</div><div class="card-label">Confirmed</div><div class="card-note">Ready for processing</div></article>
      <article class="card"><div class="card-value">${products.length}</div><div class="card-label">Products</div><div class="card-note">In catalog</div></article>
    </div>
    ${orders.length ? `
      <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Recent Orders</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Order ID</th><th>Date</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${orders.slice(0, 25).map(o => `
            <tr>
              <td><code>${escapeHtml(o.id.slice(0, 8))}...</code></td>
              <td>${dateLabel(o.order_date)}</td>
              <td>₹${Number(o.total_amount).toFixed(2)}</td>
              <td><span class="status-pill status-${o.status}">${escapeHtml(o.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div></div>
    ` : '<div class="notice" style="margin-top:14px">No orders yet. Place your first order!</div>'}
  `;
}

async function renderShifts() {
  const shifts = await api('/api/shifts');
  const myAssignment = state.user?.role !== 'employee' ? null : await api(`/api/employees/${state.user.employee_id}/shifts`).catch(() => null);

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Shift Roster', 'Manage shift rosters and employee assignments')}
    <div class="cards">
      <article class="card"><div class="card-label">Active Shifts</div><div class="card-value">${shifts.filter(s => s.active).length}</div><div class="card-note">Currently in use</div></article>
      ${state.user?.role !== 'employee' && state.user?.employee_id ? `
        <article class="card"><div class="card-label">Your Shift</div><div class="card-value">${myAssignment?.length ? myAssignment[0].shift_name : 'None'}</div><div class="card-note">Today's schedule</div></article>
      ` : ''}
    </div>
    ${shifts.length ? `
      <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Available Shifts</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Lunch</th><th>Active</th></tr></thead>
        <tbody>
          ${shifts.map(s => `
            <tr>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.start_time)}</td>
              <td>${escapeHtml(s.end_time)}</td>
              <td>${s.lunch_break_minutes ? `${s.lunch_break_minutes}m` : 'None'}</td>
              <td><span class="status-pill ${s.active ? 'green' : 'gray'}">${s.active ? 'Active' : 'Inactive'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div></div>
    ` : '<div class="notice" style="margin-top:14px">No shifts configured. Contact your administrator.</div>'}
  `;
}

async function renderTasks() {
  const canManage = ['admin', 'hr', 'payroll'].includes(state.user?.role);
  const tasks = await api('/api/tasks');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Field Tasks', 'Assign, track, and close field tasks',
      canManage ? '<button class="button primary" type="button" data-action="new-task">＋ New Task</button>' : '')}
    <div class="cards">
      <article class="card"><div class="card-value">${tasks.filter(t => t.status === 'open').length}</div><div class="card-label">Open</div><div class="card-note">Pending assignments</div></article>
      <article class="card"><div class="card-value">${tasks.filter(t => t.status === 'in_progress').length}</div><div class="card-label">In Progress</div><div class="card-note">Active work</div></article>
      <article class="card"><div class="card-value">${tasks.filter(t => t.status === 'completed').length}</div><div class="card-label">Completed</div><div class="card-note">Finished work</div></article>
    </div>
    ${tasks.length ? `
      <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Recent Tasks</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead>
        <tbody>
          ${tasks.slice(0, 25).map(t => `
            <tr>
              <td><div class="primary-cell">${escapeHtml(t.title)}</div><div class="secondary-cell">${escapeHtml(t.task_type || 'visit')}</div></td>
              <td><span class="status-pill status-${t.status}">${escapeHtml(t.status)}</span></td>
              <td><span class="status-pill priority-${t.priority}">${escapeHtml(t.priority)}</span></td>
              <td>${t.created_at ? dateLabel(t.created_at.slice(0, 10)) : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div></div>
    ` : '<div class="notice" style="margin-top:14px">No tasks yet. Create your first task!</div>'}
  `;
}

async function renderDashboardKpis() {
  const kpis = await api('/api/dashboard/kpis');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Manager Dashboard', 'Field force KPIs and analytics')}
    <div class="cards">
      <article class="card"><div class="card-label">Total Distance</div><div class="card-value">${Number(kpis.total_km).toFixed(1)} km</div><div class="card-note">Approved travel this month</div></article>
      <article class="card"><div class="card-value">${kpis.active_on_field}</div><div class="card-label">On Field</div><div class="card-note">Currently active</div></article>
      <article class="card"><div class="card-value">${kpis.punch_rate_percent}%</div><div class="card-label">Punch Rate</div><div class="card-note">Attendance compliance</div></article>
      <article class="card"><div class="card-value">₹${Number(kpis.orders_amount).toFixed(0)}</div><div class="card-label">Orders Value</div><div class="card-note">This month's total</div></article>
    </div>
    ${Object.keys(kpis.tasks_by_status || {}).length ? `
      <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Task Progress</h3></div>
      <div class="cards">
        ${Object.entries(kpis.tasks_by_status).map(([status, count]) => `
          <article class="card"><div class="card-value">${Number(count)}</div><div class="card-label">${escapeHtml(status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()))}</div></article>
        `).join('')}
      </div></div>
    ` : ''}
    <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">KPI Snapshot</h3></div>
    <div class="cards">
      <article class="card"><div class="card-label">Orders Count</div><div class="card-value">${kpis.orders_count}</div><div class="card-note">Placed this month</div></article>
      <article class="card"><div class="card-label">Samples Allocated</div><div class="card-value">${kpis.samples_allocated}</div><div class="card-note">This month</div></article>
    </div></section>
  `;
}

async function start() {
  // Load saved style preferences
  loadStylePrefs();
  applyStylePrefs();
  // applyCategoryFilter() removed - all tabs always visible

  try {
    const session = await api('/api/session');
    state.user = session.user;
    state.needsSetup = session.needsSetup;
    if (!state.user) {
      authScreen(state.needsSetup);
      return;
    }
    if (state.user.role === 'employee') state.view = 'my-attendance';
    renderShell();
    await loadView();
  } catch (error) {
    appRoot.innerHTML = `<div class="login-screen"><div class="login-card"><h1>Unable to start</h1><p>${escapeHtml(error.message)}</p><p>Check that database migrations are applied and the Worker is connected to the expected D1 database, then reload.</p></div></div>`;
  }
}

async function renderTasksView() {
  const canManage = state.user?.role;
  const tasks = await api('/api/tasks');

  document.querySelector('#view-root').innerHTML = `
    ${viewTitle('Field Tasks', 'Assign, track, and close field tasks',
      canManage ? '<button class="button primary" type="button" data-action="new-task">＋ New Task</button>' : '')}
    <div class="cards">
      <article class="card"><div class="card-value">${tasks.filter(t => t.status === 'open').length}</div><div class="card-label">Open</div><div class="card-note">Pending assignments</div></article>
      <article class="card"><div class="card-value">${tasks.filter(t => t.status === 'in_progress').length}</div><div class="card-label">In Progress</div><div class="card-note">Active work</div></article>
      <article class="card"><div class="card-value">${tasks.filter(t => t.status === 'completed').length}</div><div class="card-label">Completed</div><div class="card-note">Finished work</div></article>
    </div>
    ${tasks.length ? `
      <section class="panel" style="margin-top:14px"><div class="panel-header"><h3 class="panel-title">Recent Tasks</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead>
        <tbody>
          ${tasks.slice(0, 25).map(t => `
            <tr>
              <td><div class="primary-cell">${escapeHtml(t.title)}</div><div class="secondary-cell">${escapeHtml(t.task_type || 'visit')}</div></td>
              <td><span class="status-pill status-${t.status}">${escapeHtml(t.status)}</span></td>
              <td><span class="status-pill priority-${t.priority}">${escapeHtml(t.priority)}</span></td>
              <td>${t.created_at ? dateLabel(t.created_at.slice(0, 10)) : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div></div>
    ` : '<div class="notice" style="margin-top:14px">No tasks yet. Create your first task!</div>'}
  `;
}



start();
