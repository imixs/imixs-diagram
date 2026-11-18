# CLAUDE.md

Context and decisions for working on this repository. Read this first.

## Project

Imixs-Diagram is a lightweight diagram editor in plain JavaScript. It will be embedded in Jakarta EE Faces applications, mainly Imixs-Office-Workflow. It covers three use cases on one shared core:

1. **Meta model**: simple BPMN-like process models (start, task, gateway, end; fewer than 10 elements)
2. **Org chart**: hierarchical tree
3. **Skill map**: hierarchical tree, subtrees can be re-parented

The model is JSON and is only used by the backend for persistence. BPMN 2.0 compliance is not a goal.

## Decisions (do not revisit without asking)

- **Vanilla JS.** No UI framework, no runtime dependencies, no build step. Plain ES modules that run directly in the browser.
- Evaluated and rejected: Sprotty (too much editor tooling to rebuild without GLSP), React Flow (requires React), diagram-js (does not fit org chart / skill map), X6 / JointJS / maxGraph / Svelte Flow (not needed for this scope).
- **Nodes are HTML/CSS, edges are SVG.** Node size is defined by CSS only; the model stores positions, never sizes.
- **The model is the single source of truth.** All user actions change the model; views re-render from it on the `change` event. Views keep no state of their own.
- **Edges are routed automatically.** Orthogonal (Manhattan) routing with rounded corners. Users never edit route points; the model stores only `source` and `target`.
- **Later delivery:** packaged as a WebJar-style Maven artifact (`META-INF/resources/imixs-diagram/`), so Faces apps only need a dependency.

## Conventions

- Code comments and JSDoc in **English**.
- Public functions and classes get a short JSDoc comment.
- Small, focused modules; pure logic (model, router, layout) is kept DOM-free so it can be tested with Node.
- Every behavior change in pure logic comes with a test in `test/`.
- The user communicates in **German**. For error analysis, go step by step: one step per answer, not several solution steps at once.

## Structure

```
src/model.js          JSON model, change events, toJSON()
src/nodes.js          NodeLayer: HTML nodes, drag with pointer events, getBounds()
src/edges.js          EdgeLayer: SVG edges with arrow marker, uses router
src/router.js         computeRoute() + toRoundedPath(), pure functions
src/index.js          public API: createDiagram(element, data) -> { getModel, onChange }
src/imixs-diagram.css styling
demo/index.html       playground page
test/*.test.js        node:test tests
```

## Commands

```bash
python3 -m http.server 8080   # then open http://localhost:8080/demo/
node --test                   # run all tests
```

ES modules need a web server; `file://` does not work.

## Router logic (src/router.js)

1. Nodes share a height (or width) range → straight edge. Rectangles keep `CORNER_MARGIN` to their corners; circles attach on the circle border, preferring the circle center.
2. Enough horizontal gap (`MIN_GAP`) and mainly side by side → Z-shape horizontal-vertical-horizontal, bend at half distance.
3. Enough vertical gap → Z-shape vertical-horizontal-vertical.
4. Otherwise → L-shape (leave horizontally, enter vertically).

Corners are rounded with `CORNER_RADIUS`, shrinking on short segments. Known limitation: edges do not avoid other nodes.

## Model format

```json
{
  "type": "metamodel",
  "nodes": [
    {
      "id": "n1",
      "type": "start",
      "x": 60,
      "y": 80,
      "properties": { "name": "Start" }
    }
  ],
  "edges": [{ "id": "e1", "source": "n1", "target": "n2", "properties": {} }]
}
```

## Status

Done:

- Model with `moveNode()`, `toJSON()`, change events
- HTML nodes (start, task, end) with drag & drop
- SVG edges with automatic orthogonal routing and rounded corners
- Demo page with live JSON output; tests for model and router

## Direction under discussion: structured editor

Instead of letting users draw edges by hand, the editor works on structure. The diagram is derived from it, and the model is always valid:

| Action                           | Effect                |
| -------------------------------- | --------------------- |
| Insert element on an edge        | A→B becomes A→New→B   |
| Append element after an element  | new successor         |
| Delete element (1 in, 1 out)     | A→X→B becomes A→B     |
| Add child (org chart, skill map) | new edge parent→child |

This makes all three use cases share the same interaction model.

### Open questions (ask the user before deciding)

1. **Layout:** (A) positions fully automatic via layout algorithm, no manual dragging; or (B) automatic placement, then freely movable by the user.
2. **Gateways:** how is a second branch created (e.g. "add branch" action on the gateway)?
3. **Merging branches:** automatic closing gateway, or other approach?
4. **Loops / back edges** (e.g. review → back to edit): probably a small "connect to…" action via a selection list instead of drawing.
5. **Deleting gateways or tree nodes with children:** delete the subtree, move children up to the parent, or block deletion?
6. Final set of element types for the palette.

## Roadmap (may change with the structured editor approach)

| Step | Scope                                                                         |
| ---- | ----------------------------------------------------------------------------- |
| M0   | Project skeleton, JSON model with tests ✅                                    |
| M1   | Canvas with HTML nodes, drag & drop ✅                                        |
| M2   | Edges ✅ (routing). Manual connecting likely replaced by structure operations |
| M3   | Palette / structure operations, selection, delete                             |
| M4   | Property panel, public API                                                    |
| M5   | Pan / zoom (centralize coordinate transforms early)                           |
| M6   | Tree layout, org chart demo                                                   |
| M7   | Skill map, re-parent subtrees                                                 |
| M8   | WebJar packaging, Jakarta Faces integration                                   |
