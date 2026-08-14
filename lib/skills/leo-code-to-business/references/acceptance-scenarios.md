# Acceptance Scenarios

## Work-Order Creation

The first benchmark repository is `/Users/pa/project/JZ/utopia-scs-recorder` at commit
`c6893715d0d52477849595e7ed7c8c5ec276f322`.

Required chain:

```text
POST /construction/site/work-order/add
-> ConstructionSiteController.addWorkOrder
-> ConstructionSiteRectificationService.addWorkOrder
-> ArtisanWorkOrderProvider.addWorkOrder
-> external workOrderApi.addWorkOrder2
```

Explain:

- `projectId` identifies the target project order;
- publisher and operator derive from the construction-site inspector;
- project order type is fixed to `HOME2`;
- work-order type is fixed to `TODO`;
- images are joined with commas;
- planned completion comes from input;
- actual creation occurs in the external work-order system;
- empty or failed external response produces false and an error record.

Do not invent authorization, missing-site behavior, duplicate prevention, image constraints, or
plan-time validation. Create field-specific searched unknowns unless new current-source evidence
resolves them.

## Construction-Site and Video Binding

Main entry:

```text
POST /app/video/relate
```

Explain:

- explicit tenant overrides context tenant; otherwise inherit context;
- deduplication key uses `projectId + acceptanceNode`;
- rapid repeated operations are rejected;
- `deviceType == LINJING` selects the 3D/head-mounted branch;
- other device types select the normal/ear-mounted branch;
- the evidenced branch expands selected videos to all videos in the same folders;
- binding writes project, acceptance node, address, foreman, inspector, operator, status, and time;
- database update is followed by Elasticsearch or index synchronization.

Represent the full family as confirmed, inferred, or searched unresolved:

```text
normal application binding
3D binding
uploaded-video binding
pending-upload binding
WXON binding
precheck/status check
unbind
operational relink
```

Record alternate-entry and backward-writer investigations.

## Gate

An answer limited to one controller method fails even when technically accurate. No semantic rubric
dimension may score 0 and the total must be at least 13/16.
