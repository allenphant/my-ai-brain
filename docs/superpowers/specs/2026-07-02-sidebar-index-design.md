# Sidebar Index Feature Design

## Purpose
Add a quick-jump sidebar index to help users easily navigate through a growing list of categories. On mobile devices, this sidebar will be accessible via a hamburger menu.

## Architecture & Layout Changes
- **Container Adjustment:** Change the main application container (`#main-app-container`) from a single column (`max-w-5xl`) to a two-column layout (`max-w-7xl`, `flex`).
- **Sidebar Component:** Add an `<aside>` element. On desktop (`md:block`), it will have a fixed width (e.g., `w-64`) and be `sticky` to the top to remain visible during scrolling. On mobile, it will be hidden by default (`hidden md:block`), but shown when toggled.

## Mobile Behavior (Hamburger Menu)
- **Toggle Button:** A hamburger icon (`☰`) will be added to the mobile header.
- **Drawer Behavior:** Clicking the toggle will slide the sidebar in from the left and display a semi-transparent backdrop.
- **Auto-close:** Clicking a link in the sidebar or clicking the backdrop will close the drawer.

## Functionality & Interaction
- **Dynamic List:** The sidebar will dynamically render list items based on the `currentCategories` array, including the "Inbox" (which is static but part of the content).
- **Smooth Scroll:** Sidebar links will use `element.scrollIntoView({ behavior: 'smooth' })` to navigate to the target category wrapper.
- **Active State Highlighting:** An `IntersectionObserver` will track which category wrapper is currently visible in the viewport and highlight the corresponding sidebar link.

## Dependencies & State
- Reads from `currentCategories` array to generate the list.
- IntersectionObserver needs to be re-initialized when new categories are added or rendered.
- Requires CSS utility classes (Tailwind) for off-canvas sliding and mobile backdrop.
