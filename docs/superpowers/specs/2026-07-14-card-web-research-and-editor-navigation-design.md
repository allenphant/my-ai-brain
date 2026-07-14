# Card Web Research and Editor Navigation Design

## Objective

Move manual AI web research from content-entry forms to eligible existing cards. A user starts research from a specific card, previews the result, and explicitly appends it to that card's detailed note. The card's primary text and URL are never overwritten.

At the same time, correct editor navigation so opening an external card link does not open the card editor in the background, and the browser or mobile Back action closes an open overlay before leaving the application.

## Scope

This change includes:

- A visible, persistent `AI 研讀` action on every eligible existing card.
- Removal of manual web-research controls from the main input form and add-card modal.
- A preview-and-confirm flow before writing any AI result.
- Append-only writes to the card's EditorJS detailed note.
- Existing 24-hour cache, 60-second global cooldown, status reporting, and quota handling.
- Correct link-click event isolation and browser-history behavior for the editor and research preview.
- Automated pure-logic tests and browser-level interaction regression tests.

This change does not include automatic research, multi-URL research, changes to AI auto-sort, or overwriting card titles.

## Eligibility and Card UI

A card is eligible when its trimmed primary text:

- contains exactly one unique `http://` or `https://` URL; and
- is no longer than 1,200 characters.

Eligible cards display an always-visible `AI 研讀` button near the link preview. The button is not hidden inside the hover-only copy/edit/move/delete action group. Cards that do not meet the rules do not display the button.

The same control and behavior applies to text, todo, and bookmark card renderers. The action must stop event propagation so it neither opens the external link nor opens the card editor.

## Research and Preview Flow

1. The user clicks `AI 研讀` on an eligible card.
2. The application checks for a configured Gemini API key.
3. It checks the 24-hour content cache before checking cooldown.
4. A cache hit returns the stored result without consuming cooldown or making a network request.
5. On a cache miss, the application checks the global 60-second cooldown.
6. If allowed, it records the request start time and sends one Gemini request with Google Search grounding.
7. A successful result is cached and displayed in a preview modal. No Firestore data has changed yet.
8. The user either cancels or selects `追加到詳細筆記`.

Closing or cancelling the preview discards only the pending UI state. The cached research result remains reusable for 24 hours.

## Preview UI

The preview modal contains:

- A clear `AI 網址研讀預覽` title.
- The generated result in a scrollable, selectable text area or read-only content region.
- `取消` and `追加到詳細筆記` actions.
- A loading state on the append action while Firestore is being updated.

The preview must escape generated content before inserting it into HTML. It must remain open when the append write fails so the user can retry without another Gemini request.

## Append-Only Detailed Note Write

On confirmation, the application reads the latest `details/note` document for that card and appends two EditorJS blocks:

1. A level-two header: `AI 網址研讀｜YYYY/MM/DD HH:mm`.
2. A paragraph containing the escaped AI research result, preserving readable line breaks.

All existing EditorJS blocks and document metadata are preserved. If no detailed note exists, the application creates a valid EditorJS data object before appending. The card's primary document and `text` field are not updated.

The append should use a Firestore transaction so the operation is based on the latest stored note and does not replace blocks that were present when confirmation began. On success, the preview closes and a success message is shown. On failure, no success message is shown and the preview remains available for retry.

## Cache, Cooldown, and Errors

- Cache keys continue to derive from normalized card primary text.
- Cached results take precedence over cooldown and still require preview confirmation.
- The 60-second cooldown begins only for a real Gemini request, not a cache hit.
- Failed real requests retain the cooldown to prevent repeated quota consumption.
- Expired, malformed, or incomplete cache entries are removed and treated as misses.
- Gemini `429`, `quota`, and `too many requests` responses produce the dedicated quota message.
- Network, HTTP, empty-candidate, interrupted-generation, and empty-content failures produce specific failure feedback where available.
- Any research failure leaves both the card and detailed note unchanged.
- Any append failure leaves the preview and pending result unchanged.

The existing AI status panel continues to record cache hits, cooldown, success, quota errors, and other failures.

## External Link Event Isolation

The current bug occurs because link-preview anchors bubble their click event to the card container, whose handler calls `openEditor()`.

Card click handlers must ignore events originating from or inside:

- anchors;
- buttons; and
- other explicitly interactive controls introduced by this feature.

Opening an external link therefore opens only that link. Returning to the application shows the card list in its previous state, without an editor opened in the background.

## Editor and Browser History

Opening a card editor from the list creates an application-owned history entry instead of replacing the current entry. The history state identifies the editor card and collection.

Behavior is unified as follows:

- Browser or mobile Back while the research preview is open closes the preview first.
- Browser or mobile Back while the editor is open closes the editor and returns to the card list.
- Editor close button, backdrop click, and desktop Escape close the same editor state and consume or normalize the corresponding history entry.
- Closing the editor removes `editor` and `col` query parameters.
- The editor save-before-close behavior is retained regardless of how the editor closes.
- A `popstate` listener closes application overlays without recursively adding or replacing history entries.

Any startup handling for an existing `?editor=...&col=...` deep link must establish a base application state so the first Back action closes the editor rather than leaving the application.

## Code Organization

Pure, independently testable web-research helpers should move to a small local module rather than adding more responsibilities to the already large `app.js`. This module owns eligibility checks, URL extraction, cache-key normalization, cache parsing, cooldown calculation, and EditorJS append-block construction.

`app.js` remains responsible for DOM rendering, event wiring, Gemini requests, Firestore transactions, status display, and browser-history coordination.

## Test Strategy

Implementation follows test-driven development. Tests are added and observed failing before production changes.

Pure-logic tests cover:

- zero, one, duplicate, and multiple URL eligibility;
- the 1,200-character limit;
- normalized cache keys;
- valid, expired, malformed, and incomplete cache values;
- cooldown calculation;
- append-block construction, timestamp format, escaping, and preservation of existing blocks.

Browser-level tests use intercepted Gemini requests and controlled browser history to cover:

- the research action appears only on eligible cards;
- clicking the action does not open the editor or link;
- successful research opens a preview without writing details;
- cancel performs no append;
- confirm appends header and paragraph blocks without changing card text;
- cache hit performs no second Gemini POST;
- cooldown blocks a different uncached card;
- 429 and generic failures preserve all card data;
- append failure keeps the preview open;
- clicking an external link does not call `openEditor()`;
- returning from an external link leaves the list visible;
- mobile/browser Back closes preview before editor, then leaves the app only after overlays are closed;
- Escape, close button, backdrop, and Back retain the same save-and-close result.

## Acceptance Criteria

The work is complete when:

- No manual web-research action remains in either new-content input.
- Every eligible existing card has a discoverable `AI 研讀` action.
- No AI result is written before explicit preview confirmation.
- Confirmation only appends the approved header and paragraph to the latest detailed note.
- Card primary text and URL remain unchanged in success, cancellation, cooldown, and error paths.
- External-link clicks never open the editor.
- Mobile/browser Back closes preview and editor overlays in the correct order before exiting the application.
- Automated tests and a mobile-width browser verification pass without unexpected console errors.
