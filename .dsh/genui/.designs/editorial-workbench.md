# Editorial Workbench

## Intent
Build a quiet, content-first workspace that feels edited rather than decorated. Let the user's words, choices, and source material carry the visual weight.

## Color
- Support light and dark mode with CSS custom properties and prefers-color-scheme.
- Light canvas: #ffffff; raised surface: #f6f5f2; primary ink: #302f2c; muted ink: #74716b.
- Dark canvas: #191919; raised surface: #222220; primary ink: #eeeeeb; muted ink: #a19e97.
- Use one muted semantic accent only when an action or state needs it. No gradients or neon glow.

## Type
- Use a precise sans face for controls and a restrained serif for an occasional editorial heading.
- Body text is 14-16px with a relaxed 1.5-1.65 line height.
- Use sentence case. Avoid oversized hero type and decorative all-caps labels.

## Layout
- Keep the main reading column between 720px and 980px.
- Use 8px spacing increments, generous page margins, and compact controls.
- Prefer document flow, simple tables, checklists, and inline properties over nested cards.

## Components
- Borders are 1px and low contrast. Radius stays between 4px and 8px.
- Buttons look like quiet controls until hovered; destructive actions remain explicit.
- Use icons sparingly and never as decoration.
- Empty states say what is missing and offer one next action.

## Motion
- Use 120-180ms fades or small position changes only when they explain a state transition.
- Respect prefers-reduced-motion.

## Copy
- Use concrete nouns and verbs from the user's situation.
- Labels stay short: "Add recipe", "Packed", "Saturday".
- Do not mention AI, prompts, architecture, or design systems unless the user asks.
