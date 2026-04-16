```markdown
# Design System Specification: Architectural Indigo

## 1. Overview & Creative North Star: "The Digital Blueprint"
The Creative North Star for this design system is **Architectural Logic**. This is not merely a dark mode; it is an exercise in structural depth and tonal sophistication. By utilizing a foundation of deep slates and charcoal grays, the system mimics the aesthetic of high-end technical drafting and editorial design.

The system breaks the "generic template" look by rejecting traditional box-models. Instead, we use **Intentional Asymmetry** and **Tonal Layering**. Elements are not just placed; they are "anchored" into a hierarchy of light and shadow, where the Primary Indigo (`#3F51B5`) serves as the electrical pulse through a monolithic structure.

---

## 2. Color Theory & Tonal Depth
The palette is built on a "Deep Surface" philosophy. We move away from pure blacks to avoid visual crushing, favoring charcoal and slate tones that allow for more nuanced layering.

### The Foundation
*   **Surface (Base):** `#111316` — The bedrock of the application.
*   **On-Surface:** `#e2e2e6` — High-contrast off-white for maximum legibility without the harshness of pure white.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning. 
Structure must be achieved through **Tonal Transitions**. To separate a sidebar from a main content area, shift from `surface` to `surface_container_low`. This creates a cleaner, more premium editorial feel that mimics high-end interior architecture.

### Surface Hierarchy & Nesting
Depth is achieved through the physical stacking of tiers. 
*   **Deep Backgrounds:** Use `surface_container_lowest` (`#0c0e11`) for background areas that need to feel receded.
*   **Raised Cards:** Place a `surface_container_high` (`#282a2d`) element atop a `surface` (`#111316`) background to create a "lifted" effect.
*   **The Glass Rule:** For floating headers or navigation, use semi-transparent `surface_bright` with a `20px` backdrop-blur. This integrates the UI into the background rather than sitting "on top" of it.

---

## 3. Typography: The Editorial Scale
We utilize **Manrope** for its geometric clarity and modern, architectural proportions.

*   **Display (Large/Medium):** Use these for "Hero" moments. They should be set with tight letter-spacing (-0.02em) to feel like a premium magazine masthead.
*   **Headlines:** These are the "beams" of your layout. Use them to anchor the eye in asymmetrical layouts.
*   **Body (Large/Medium):** Optimized for long-form reading. High contrast (`on_surface`) is mandatory.
*   **Labels:** Use for metadata. These can utilize `on_surface_variant` (`#c5c5d4`) to recede slightly in importance.

---

## 4. Elevation & Depth: Tonal Layering
In this system, shadows are an exception, not a rule. We prioritize **Tonal Elevation**.

*   **The Layering Principle:** To elevate a component (like a modal), shift its background to `surface_container_highest` (`#333538`). The "pop" comes from the contrast in value, not a drop shadow.
*   **Ambient Shadows:** If a floating action button (FAB) or high-level modal requires a shadow, it must be an "Ambient Glow." Use a 24px blur at 6% opacity, using the `primary` color as the shadow tint. This mimics the light emitted from the Indigo elements.
*   **The Ghost Border:** If a boundary is strictly required for accessibility, use `outline_variant` (`#454652`) at **15% opacity**. It should be felt, not seen.

---

## 5. Component Logic

### Buttons: The Kinetic Engine
*   **Primary:** Background: `primary_container` (`#3f51b5`). Text: `on_primary_container`. These should feel like illuminated glass blocks.
*   **Secondary:** Background: `secondary_container`. No borders.
*   **Tertiary:** No background. Use `primary` (`#bac3ff`) for text.

### Cards & Lists: The "Invisible Container"
*   **Rule:** Forbid the use of divider lines. 
*   **Execution:** Use 32px or 48px vertical spacing to separate content blocks. For list items, use a hover state that shifts the background to `surface_container_low` rather than adding a line.

### Input Fields: Minimalist Drafting
*   **Style:** Background: `surface_container_lowest`. A simple 2px bottom-bar in `outline` that transforms into `primary` on focus. No 4-sided boxes.

### Signature Component: The "Architectural Breadcrumb"
*   Use `label-md` in all caps with 1.5pt letter-spacing to create a technical, drafting-table aesthetic at the top of pages.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical margins (e.g., a wider left margin than right) to create a custom editorial feel.
*   **Do** leverage "Indigo Glow" — use a subtle radial gradient of `primary` at 5% opacity behind key hero text to give it a "soul."
*   **Do** respect the 4px roundness; it provides a professional, "machined" edge that is softer than 0px but more serious than 8px.

### Don’t:
*   **Don’t** use 100% opaque borders. They clutter the "Blueprint" aesthetic.
*   **Don’t** use pure black (`#000000`). It kills the depth of the Slate/Charcoal palette.
*   **Don’t** use standard "Drop Shadows." Only use tinted Ambient Glows for floating objects.
*   **Don’t** crowd the layout. If a section feels cramped, increase the vertical whitespace rather than adding a divider line.

---
*Director's Final Note: This system is about the "unseen" structure. Trust the colors and the typography to do the heavy lifting. If the layout feels empty, add more negative space, not more decoration.*```