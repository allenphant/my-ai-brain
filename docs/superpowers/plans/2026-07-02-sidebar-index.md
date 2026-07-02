# Sidebar Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sticky sidebar with clickable category links on desktop, and a hamburger-triggered slide-in drawer on mobile.

**Architecture:** A new `<aside id="sidebar">` element is added to the HTML. On desktop (`md:` breakpoint), it renders as a sticky column next to the main content. On mobile, it's hidden off-screen (translated left) and slides in via a CSS class toggled by JavaScript. An `IntersectionObserver` watches each `.category-wrapper` to highlight the currently visible category in the sidebar.

**Tech Stack:** Vanilla JS, Tailwind CSS (CDN), Firebase Firestore (existing), Font Awesome icons (existing).

## Global Constraints

- Single-file project: all changes are in `/home/cdc/CCdevelopment/my-ai-brain/index.html`
- No new libraries or CDN scripts — use only what is already loaded
- Mobile device detection via feature detection (`('ontouchstart' in window) || (navigator.maxTouchPoints > 0)`), NOT screen width
- Tailwind CSS is used for utility classes; custom CSS goes in the existing `<style>` block
- All new JS goes inside the existing `<script type="module">` block

---

### Task 1: HTML Structure — Outer Layout Wrapper & Sidebar Shell

**Files:**
- Modify: `index.html:99-191` (body tag through `#main-app-container`)

**What we are building:** Replace the flat single-column layout with a two-column flex layout. The left column is the sidebar `<aside>`, the right column is the existing main content.

- [ ] **Step 1: Add hamburger button to the existing mobile header**

  In `index.html`, find the `<header>` element (around line 103). Inside the flex row, right before the brain icon `<i>` tag, add:
  ```html
  <button id="sidebar-toggle-btn" class="md:hidden text-slate-500 hover:text-indigo-600 transition-colors p-2 rounded-lg hover:bg-slate-100 mr-1" aria-label="開啟導覽">
      <i class="fas fa-bars text-lg"></i>
  </button>
  ```

- [ ] **Step 2: Wrap existing content into two-column layout**

  Change the outer container from:
  ```html
  <div class="max-w-5xl mx-auto" id="main-app-container">
  ```
  to a new outer wrapper `#page-wrapper`, with a sidebar `<aside>` before the renamed inner div. The final structure:
  ```html
  <div class="max-w-7xl mx-auto flex gap-6 items-start" id="page-wrapper">

      <!-- Sidebar -->
      <aside id="sidebar" class="hidden md:flex flex-col w-56 shrink-0 sticky top-4 self-start bg-white rounded-2xl border border-slate-200 shadow-sm p-4 max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
          <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest">快速跳轉</h2>
              <button id="sidebar-close-btn" class="md:hidden text-slate-400 hover:text-slate-600 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-100">
                  <i class="fas fa-times text-sm"></i>
              </button>
          </div>
          <nav id="sidebar-nav" class="flex flex-col gap-1">
              <!-- Populated by JS -->
          </nav>
      </aside>

      <!-- Main Content (keep id="main-app-container" as existing JS references it) -->
      <div class="flex-1 min-w-0" id="main-app-container">
          <!-- All existing content stays here unchanged -->
      </div>
  </div>
  ```

- [ ] **Step 3: Add mobile backdrop element**

  Just before the closing `</body>` tag (before the `<script>` block), add:
  ```html
  <!-- Mobile Sidebar Backdrop -->
  <div id="sidebar-backdrop" class="hidden fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[90]"></div>
  ```

- [ ] **Step 4: Add mobile drawer CSS to `<style>` block**

  In the existing `<style>` block, append:
  ```css
  /* Mobile Sidebar Drawer */
  @media (max-width: 767px) {
      #sidebar {
          display: flex !important;
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          max-height: 100vh;
          width: 280px;
          border-radius: 0;
          z-index: 100;
          transform: translateX(-100%);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #sidebar.is-open {
          transform: translateX(0);
          box-shadow: 4px 0 20px rgba(0,0,0,0.15);
      }
  }
  ```

- [ ] **Step 5: Verify HTML structure in browser**

  - Desktop (≥768px): Sidebar visible as left column with "快速跳轉" heading, main content to the right.
  - Mobile (<768px): Sidebar not visible (off-screen). ☰ button visible in header.

- [ ] **Step 6: Commit**
  ```bash
  git add index.html
  git commit -m "feat(sidebar): add HTML structure for sidebar and two-column layout"
  ```

---

### Task 2: CSS — Sidebar Link Styles & Active State

**Files:**
- Modify: `index.html` — `<style>` block

- [ ] **Step 1: Add sidebar link CSS**

  Append to the existing `<style>` block:
  ```css
  /* Sidebar Nav Link Styles */
  .sidebar-link {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.5rem 0.625rem;
      border-radius: 0.625rem;
      font-size: 0.8125rem;
      font-weight: 500;
      color: #64748b;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      transition: background-color 0.15s, color 0.15s;
  }
  .sidebar-link:hover {
      background-color: #f1f5f9;
      color: #334155;
  }
  .sidebar-link.is-active {
      background-color: #eef2ff;
      color: #4f46e5;
      font-weight: 600;
  }
  .sidebar-link .sidebar-link-icon {
      width: 1.125rem;
      text-align: center;
      font-size: 0.875rem;
      flex-shrink: 0;
  }
  .sidebar-link .sidebar-link-text {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      flex: 1;
  }
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add index.html
  git commit -m "feat(sidebar): add sidebar link CSS styles and active state"
  ```

---

### Task 3: JavaScript — Rendering & Open/Close Logic

**Files:**
- Modify: `index.html` — `<script type="module">` block

**Interfaces:**
- Consumes: `currentCategories` array (`id`, `name`, `icon` per item)
- Consumes: DOM elements `#sidebar`, `#sidebar-nav`, `#sidebar-backdrop`, `#sidebar-toggle-btn`, `#sidebar-close-btn`
- Produces: `renderSidebar(categories)`, `openSidebar()`, `closeSidebar()`

- [ ] **Step 1: Add `renderSidebar` and `createSidebarLink` functions**

  After the `renderCategoryManagerList` function (around line 560), add:
  ```js
  // ✨ Sidebar Index
  function renderSidebar(categories) {
      const nav = document.getElementById('sidebar-nav');
      if (!nav) return;
      nav.innerHTML = '';

      // Static: Inbox
      nav.appendChild(createSidebarLink('inbox', 'fas fa-inbox', '收件匣'));

      // Divider
      if (categories.length > 0) {
          const divider = document.createElement('div');
          divider.className = 'my-2 border-t border-slate-100';
          nav.appendChild(divider);
      }

      // Dynamic categories
      categories.forEach(cat => {
          nav.appendChild(createSidebarLink(cat.id, cat.icon, cat.name));
      });
  }

  function createSidebarLink(targetId, iconClass, labelText) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-link';
      btn.setAttribute('data-target', targetId);
      btn.innerHTML = `
          <i class="${iconClass} sidebar-link-icon"></i>
          <span class="sidebar-link-text">${escapeHtml(labelText)}</span>
      `;
      btn.addEventListener('click', () => {
          const targetEl = targetId === 'inbox'
              ? document.querySelector('[data-col="inbox"]')?.closest('.category-wrapper')
              : document.getElementById(`list-${targetId}`)?.closest('.category-wrapper');
          if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          closeSidebar();
      });
      return btn;
  }
  ```

- [ ] **Step 2: Add `openSidebar` and `closeSidebar` functions**

  After `renderSidebar`, add:
  ```js
  function openSidebar() {
      document.getElementById('sidebar').classList.add('is-open');
      document.getElementById('sidebar-backdrop').classList.remove('hidden');
  }

  function closeSidebar() {
      document.getElementById('sidebar').classList.remove('is-open');
      document.getElementById('sidebar-backdrop').classList.add('hidden');
  }
  ```

- [ ] **Step 3: Wire up event listeners for toggle/close/backdrop**

  After `closeSidebar`, add:
  ```js
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', openSidebar);
  document.getElementById('sidebar-close-btn')?.addEventListener('click', closeSidebar);
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeSidebar);
  ```

- [ ] **Step 4: Call `renderSidebar` from the categories `onSnapshot`**

  In `setupRealtimeListeners`, find the `onSnapshot(getCol('categories'), ...)` block. After `updateCategorySelectOptions(currentCategories)`, add:
  ```js
  renderSidebar(currentCategories);
  ```

- [ ] **Step 5: Test open/close behavior**

  - Resize browser to <768px (or use DevTools mobile emulation).
  - Click ☰ → sidebar slides in, backdrop appears.
  - Click backdrop → sidebar closes.
  - Click × → sidebar closes.
  - Click a category link → page scrolls to section, sidebar closes.

- [ ] **Step 6: Commit**
  ```bash
  git add index.html
  git commit -m "feat(sidebar): add renderSidebar, open/close logic, and scroll-to behavior"
  ```

---

### Task 4: JavaScript — IntersectionObserver Active Highlighting

**Files:**
- Modify: `index.html` — `<script type="module">` block

**What we are building:** An `IntersectionObserver` that watches `.category-wrapper` elements. When one becomes the dominant visible section, its sidebar link gets `is-active`.

**Interfaces:**
- Consumes: `.category-wrapper` elements, each containing a `[data-col]` child
- Consumes: `.sidebar-link` buttons with `data-target` attribute
- Produces: `initSidebarObserver()` — called after renders complete

- [ ] **Step 1: Add `initSidebarObserver` function**

  After the `closeSidebar` function, add:
  ```js
  let sidebarObserver = null;

  function initSidebarObserver() {
      if (sidebarObserver) sidebarObserver.disconnect();

      const wrappers = document.querySelectorAll('.category-wrapper');
      if (wrappers.length === 0) return;

      sidebarObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
              if (!entry.isIntersecting) return;
              const listEl = entry.target.querySelector('[data-col]');
              const colId = listEl ? listEl.getAttribute('data-col') : null;
              if (!colId) return;

              document.querySelectorAll('.sidebar-link').forEach(link => {
                  link.classList.toggle('is-active', link.getAttribute('data-target') === colId);
              });
          });
      }, {
          rootMargin: '-10% 0px -60% 0px',
          threshold: 0
      });

      wrappers.forEach(wrapper => sidebarObserver.observe(wrapper));
  }
  ```

- [ ] **Step 2: Call `initSidebarObserver` after categories render**

  In the `onSnapshot(getCol('categories'), ...)` block, after `renderSidebar(currentCategories)`, add:
  ```js
  setTimeout(initSidebarObserver, 100);
  ```

  Also in the `onSnapshot(getCol('inbox'), ...)` block (inbox renders separately), at the end of the callback, add:
  ```js
  setTimeout(initSidebarObserver, 100);
  ```

- [ ] **Step 3: Verify active state**

  - Scroll down the page slowly.
  - Confirm each sidebar link highlights when its section is near the top of the viewport.
  - Only one link should be `is-active` at a time.

- [ ] **Step 4: Commit**
  ```bash
  git add index.html
  git commit -m "feat(sidebar): add IntersectionObserver active state highlighting"
  ```

---

### Task 5: Polish — Editor Side-Layout Compatibility & CURRENT_STATE Update

**Files:**
- Modify: `index.html` — `<style>` block
- Modify: `CURRENT_STATE.md`

- [ ] **Step 1: Add side-layout compatibility CSS**

  In the `<style>` block, append:
  ```css
  /* Sidebar + Editor side-layout: compress page-wrapper on desktop */
  body.side-layout-active.editor-open #page-wrapper {
      max-width: calc(50vw - 2rem);
      margin-left: 0;
  }
  /* On mobile, sidebar sits above editor backdrop */
  @media (max-width: 767px) {
      body.editor-open #sidebar.is-open {
          z-index: 95;
      }
  }
  ```

- [ ] **Step 2: Verify editor side-layout still works**

  Open any note to launch the Editor modal. Click the columns icon (side-layout toggle). Confirm:
  - Sidebar + main content columns compress to the left half.
  - Editor panel occupies the right half.
  - Sidebar links still work to scroll content.

- [ ] **Step 3: Update `CURRENT_STATE.md`**

  Overwrite `/home/cdc/CCdevelopment/my-ai-brain/CURRENT_STATE.md` with a new snapshot reflecting the completed sidebar feature. Follow the existing format.

- [ ] **Step 4: Final commit**
  ```bash
  git add index.html CURRENT_STATE.md
  git commit -m "feat(sidebar): polish editor compatibility and finalize sidebar index"
  ```
