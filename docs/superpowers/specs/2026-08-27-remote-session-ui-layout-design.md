# Remote Session UI Layout Design

## Goal

Reduce crowding in the remote-session forms and make the remote-session catalog read as one grouped card grid.

## Modal layout

Official link create/edit and peer edit dialogs use a dedicated modal shell:

- 720px maximum width on desktop, full width on small screens.
- Fixed header, scrollable body, and footer action areas.
- Content is laid out in a two-column responsive form grid; long fields and textareas span both columns.
- Keyboard focus and click-outside behavior remain unchanged.

## Catalog layout

The two remote-session catalog entries live in one `endpoints-grid`. They use the existing `node-card` component and share the same hover, focus, responsive, and accessibility behavior as proxy node cards. The grid fills horizontally and wraps automatically on narrower viewports.

## Verification

Static UI structure tests assert the grouped grid and modal shell. The existing remote-session suite and panel build must pass.
