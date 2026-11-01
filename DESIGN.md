---
name: "Wisprsight"
description: "Compact monochrome workspace with direct Notra controls and focused calibration."
colors:
  "background": "#fff"
  "foreground": "#202020"
  "rail": "#f7f7f7"
  "muted-foreground": "#666"
  "border": "#e5e5e5"
  "primary": "#242424"
  "primary-foreground": "#fff"
  "secondary": "#f2f2f2"
  "muted-surface": "#f5f5f5"
  "accent": "#ededed"
  "destructive": "#ad3535"
  "ring": "#777"
  "table-shell": "#f3f3f2"
  "table-shell-border": "#e7e7e5"
  "table-card": "#ffffff"
  "table-card-border": "#e5e5e5"
  "table-row-border": "#efefee"
  "info": "oklch(.55 .02 140)"
  "success": "oklch(.52 .09 145)"
  "warning": "oklch(.58 .1 65)"
  "dark-background": "#0d0d0d"
  "dark-foreground": "#eee"
  "dark-rail": "#171717"
  "dark-field": "#111"
  "dark-muted-foreground": "#a0a0a0"
  "dark-border": "#2a2a2a"
  "dark-primary": "#e5e5e5"
  "dark-primary-foreground": "#171717"
  "dark-secondary": "#242424"
  "dark-muted-surface": "#222"
  "dark-accent": "#262626"
  "dark-destructive": "#e18c8c"
  "dark-input": "#333"
  "dark-ring": "#888"
  "dark-table-shell": "#161616"
  "dark-table-shell-border": "#232323"
  "dark-table-card": "#1f1f1f"
  "dark-table-card-border": "#2c2c2c"
  "dark-table-row-border": "#292929"
  "dark-info": "oklch(.7 .02 140)"
  "dark-success": "oklch(.7 .09 145)"
  "dark-warning": "oklch(.75 .1 65)"
typography:
  "body": {"fontFamily": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", "fontSize": "14px", "fontWeight": 400, "lineHeight": 1.5}
  "headline": {"fontFamily": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", "fontSize": "20px", "fontWeight": 600, "lineHeight": 1.4, "letterSpacing": "-.025em"}
  "title": {"fontFamily": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", "fontSize": "14px", "fontWeight": 600}
  "label": {"fontFamily": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", "fontSize": "13px", "fontWeight": 500}
  "sentence": {"fontFamily": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", "fontSize": "clamp(28px, 4vw, 44px)", "fontWeight": 550, "lineHeight": 1.45, "letterSpacing": "-.025em"}
  "code": {"fontFamily": "ui-monospace, SFMono-Regular, monospace", "fontSize": "12px"}
rounded:
  "sm": "4px"
  "md": "6px"
  "lg": "8px"
  "xl": "10px"
  "toast": "12px"
  "registry-popup": "14px"
  "registry-panel": "16px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "40": "40px"
components:
  "button-primary": {"backgroundColor": "{colors.primary}", "textColor": "{colors.primary-foreground}", "rounded": "{rounded.lg}", "height": "32px", "padding": "0 10px"}
  "button-outline": {"backgroundColor": "{colors.background}", "textColor": "{colors.foreground}", "rounded": "{rounded.lg}", "height": "32px", "padding": "0 10px"}
  "button-ghost": {"backgroundColor": "transparent", "textColor": "{colors.foreground}", "rounded": "{rounded.lg}", "height": "32px", "padding": "0 10px"}
  "input": {"backgroundColor": "{colors.background}", "textColor": "{colors.foreground}", "rounded": "{rounded.md}", "height": "36px", "padding": "7px 10px"}
  "sidebar-item": {"textColor": "{colors.foreground}", "rounded": "{rounded.lg}", "height": "32px", "padding": "8px"}
  "calibration-panel": {"backgroundColor": "{colors.table-shell}", "rounded": "{rounded.registry-panel}"}
  "alert": {"backgroundColor": "{colors.background}", "textColor": "{colors.destructive}", "rounded": "{rounded.lg}", "padding": "8px 10px"}
---
# Design System: Wisprsight

## Overview

**Creative North Star: "Local dictation and guided calibration"**

A compact monochrome workspace follows the user-selected dplprint.glynn.cc reference: a solid navigation rail, thin toolbar, plain headings and functional content. System typography and neutral surfaces keep attention on text and camera work.

The implementation imports actual installed Notra registry buttons, select, sidebar, InstrumentModule cards and toasts directly. Their supplied material treatments remain intact; Base UI-backed progress and alerts share the registry foundation. The reference is directional, not a claim of pixel equivalence.


**Key Characteristics:**
- Compact shell and restrained monochrome surfaces.
- Direct registry controls with their supplied states.
- Full-screen sentence focus with a subordinate camera preview.

## Colors

The primary is near-black in light appearance and pale gray in dark appearance. Background, foreground, rail, borders, muted copy and fields form the neutral hierarchy. Small semantic status accents distinguish success, warning and errors; there is no decorative brand accent.

### Primary

Use primary and primary-foreground for principal actions and filled progress. In dark appearance, use their dark counterparts. The registry button derives its gradient from the live primary token rather than a second brand palette.

### Neutral

Use background for the workspace, rail for navigation, and muted-foreground for supporting copy. Table-shell and table-card distinguish the installed InstrumentModule layers. Registry card and popover backgrounds use the rail tone in dark appearance; ordinary text inputs use dark-field. The global danger text differs from registry destructive: light (#a53131), dark (#f0a3a3).

The root element follows the operating-system color preference and synchronizes the registry's dark class. Both media-query app tokens and class-based registry tokens exist in the current source. Frontmatter names beginning with dark- describe alternate values; they are documentation names, not additional source CSS variables.

## Typography

System sans-serif covers headings, labels and body. Monospace is reserved for technical paths. The ordinary heading is compact; large type belongs to the sentence being mouthed. Registry button text is medium-weight (14px), with smaller controls using their installed size variants. Supporting text commonly uses (12px) or (13px). Sentence counts and durations use tabular numerals.

## Layout

The workspace has a solid Notra sidebar, initially collapsed to an icon rail (48px). Expanded width starts at (248px), constrained to (240–256px); below the registry's (768px) provider breakpoint it opens as a sheet. The toolbar is (48px) tall. Main content centers within (1152px) with (32px) padding, reducing at (700px) and (480px). These describe the active registry shell; older custom-sidebar CSS remains in the stylesheet and is not the component contract.

Calibration covers the viewport above the shell. A (64px) header and thin progress track frame a centered sentence stage with a (960px) maximum width. The camera footer stays subordinate, with a mirrored (160×120px) preview and plain privacy copy. Below (600px), the preview becomes (100×90px) and spacing tightens. The session can scroll rather than clipping controls.

## Elevation & Depth

The shell uses borders and tonal differences. Actual registry controls retain their supplied gradients, inset highlights and low shadows. The calibration panel uses the registry's table-card shadow. Select popups and toasts have stronger installed overlay shadows; they are functional overlays, not a shell-wide elevation system. Do not flatten these into custom approximations or propagate their treatments into unrelated surfaces.

## Shapes

Ordinary fields use gently curved corners; registry buttons use the base large radius, with supplied squircle support increasing supported button corners to (12px). The installed panel has an outer corner of (16px) and inner corner of (14px). Dropdown popups use (14px), while the global toast rule sets (12px). These are observed registry exceptions to the user's general compact-corner preference. Progress uses a fully rounded thin track, not a pill-shaped action.

## Components

### Buttons

Use direct Notra default, outline, ghost and destructive variants. Default and outline variants retain supplied vertical gradients and inset highlights. Hover changes brightness or background; focus shows the registry ring and global visible outline. Pressed buttons have the supplied one-pixel downward movement. Disabled controls suppress pointer interaction and reduce opacity; loading/progress sets aria-busy and disables repeated actions. Loading dots and label swaps are registry behavior, not a pattern to add elsewhere.

### Inputs / Fields

Native inputs and textareas use a simple border, explicit labels, neutral fill and visible keyboard focus. Placeholders use muted text. Existing form constraints control required values and maximum length; do not imply validation solely through color. Textareas retain vertical resizing.

### Navigation

Use the installed Sidebar and menu components. Hover, active and expanded popup states use the sidebar accent, with active text at medium weight. Collapsed destinations retain accessible names and tooltips. The sidebar supports its built-in keyboard toggle and resize behavior. Profile selection uses the direct Notra ghost SelectTrigger and registry popup, highlighted items, selected indicator and disabled behavior.

### Cards / Containers

The calibration introduction uses the actual panel InstrumentModule: a shell header and overlapping bordered inner content with supplied depth. Its eyebrow prop supplies the ordinary title, not a new decorative label. Other sections remain plain functional sections and rows.

### Alerts, Progress and Toasts

Registry alerts present errors inline with a title and actionable recovery where available. Base UI progress exposes calibration or training progress through a thin solid track. Direct Notra Sonner toasts appear bottom-right with success/error/warning semantics, close controls and descriptions. There are no fabricated success metrics.

### Audio and Visual Comparison

Spoken takes pair a local Whisper audio reference with the visual-only prediction from the same recording. Use the existing labeled textareas and plain supporting text: the reference remains editable, the visual prediction is read-only, and the word-error comparison updates with reference edits. Describe this as disagreement between predictions, not independently measured accuracy. Usable references save automatically; uncertain references require review. Saved references expose a correction action, and unsaved reference edits pause idle learning until saved or discarded.

### Calibration Sequence

One sentence occupies the central stage. Automatic completion observes mouth motion followed by a pause, saves the example, then advances using a horizontal exit/entry animation. This is sentence progression, not an implemented touch-swipe gesture. Done remains available while recording; manual completion is the fallback when tracking is unavailable. Errors expose retry, and eligible states allow sentence editing. The final saved sentence leads into local training and an explicit completion state.

Entry uses (280ms ease); exit uses (250ms ease). Reduced-motion preference removes sentence animation and global transitions/animations. Preserve progress, feedback and completion text when movement is absent.

Silent calibration requests the camera with the microphone off; spoken calibration requests both through the native browser permission flow. Spoken prompts ask the user to read aloud. Local Whisper supplies the teacher reference while prediction remains visual-only. Usable examples save automatically; uncertain references or prompt mismatches pause the sequence with an editable Whisper reference, the visual prediction, and actions to save or record again. Training starts after the final saved sentence.

The preview reports actual live camera and microphone state, including permission denial and released tracks. The session releases both devices on exit and before training. Keep this state visible beside the preview. These are observed interface behaviors, not a new data-retention policy.

## Do's and Don'ts

### Do:
- Do import the installed Notra components from their source paths.
- Do use real loading, disabled, error and selected states.
- Do preserve keyboard focus visibility and reduced-motion behavior.
- Do show camera and microphone state in plain text.

### Don't:
- Don't replace registry components with lookalike adapters.
- Don't introduce decorative dashboard cards, invented charts or performance claims.
- Don't add blue accents, decorative gradients, glass shells or ornamental headings.
- Don't treat the supplied registry depth effects as permission to decorate the surrounding shell.
