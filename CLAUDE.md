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
- **The model is the single source of truth.** All user actions change the model; views re-render from it on the `change` event. Views keep no state of their own. Exception: viewport (pan / zoom) is pure view state and is not stored in the model.
- **Layout is fully automatic.** A layout algorithm computes all node positions; users cannot drag nodes to a position. Computed `x`/`y` are still written to the model and persisted. Drag on a node is reserved for structural gestures (e.g. re-parenting); drag on the empty canvas pans.
- **Edges are routed automatically.** Orthogonal (Manhattan) routing with rounded corners. Users never edit route points; the model stores only `source` and `target`.
- **Property panel** is always visible below the canvas (about one third of the height), white to set it apart from the dark canvas. It shows the properties of the clicked node or edge, or of the diagram itself if nothing is selected. Every element and the diagram have at least `name` and `documentation` (as in BPMN). Fields per element kind are configured in `FIELDS` in `src/properties.js`.
- **JSON stays the model format.** A BPMN 2.0 export for the meta model (readable in Open-BPMN) may be added later as a separate adapter; not planned now.
- **Later delivery:** packaged as a WebJar-style Maven artifact (`META-INF/resources/imixs-diagram/`), so Faces apps only need a dependency.

## Conventions

- Code comments and JSDoc in **English**.
- Public functions and classes get a short JSDoc comment.
- Small, focused modules; pure logic (model, router, layout) is kept DOM-free so it can be tested with Node.
- Every behavior change in pure logic comes with a test in `test/`.
- The user communicates in **German**. For error analysis, go step by step: one step per answer, not several solution steps at once.

## Structure

```
src/model.js          JSON model, structure operations, change events, toJSON()
src/layout.js         computeLayout(): automatic layered layout, pure function
src/nodes.js          NodeLayer: HTML nodes, getBounds()
src/edges.js          EdgeLayer: SVG edges with arrow marker and click area, uses router
src/router.js         computeRoute(), computeArcRoute(), toRoundedPath(), pure functions
src/editor.js         Editor: selection (view state) and action bar for structure operations
src/viewport.js       pan / zoom math: toScreen(), toDiagram(), zoomAt(), fitToView(), pure functions
src/panzoom.js        PanZoom: drag on empty space pans, mouse wheel zooms, zoom toolbar
src/properties.js     PropertyPanel: form for the selected element or the diagram
src/index.js          public API: createDiagram(element, data) -> { getModel, onChange }
src/imixs-diagram.css styling
demo/index.html       playground page
test/*.test.js        node:test tests
```

## Commands

```bash
python3 -m http.server 8080   # then open http://localhost:8080/demo/
node --test                   # run all tests (package.json sets "type": "module")
```

ES modules need a web server; `file://` does not work.

## Router logic (src/router.js)

1. Nodes share a height (or width) range → straight edge. Rectangles keep `CORNER_MARGIN` to their corners; circles attach on the circle border, preferring the circle center.
2. Enough horizontal gap (`MIN_GAP`) and mainly side by side → Z-shape horizontal-vertical-horizontal, bend at half distance.
3. Enough vertical gap → Z-shape vertical-horizontal-vertical.
4. Otherwise → L-shape (leave horizontally, enter vertically).
5. Arc edges (loops and edges skipping nodes in the same row, decided by the layout) → `computeArcRoute()`: leave vertically, run above both nodes (below if the source is lower), enter vertically.

Gateways are diamonds: straight edges attach only at their corners.

## Layout logic (src/layout.js)

Left to right. DFS from the start node finds back edges (ignored for ranking). Column = longest path from start. The first successor keeps the row of its predecessor, every further branch opens a new row below, so each row is a single chain and nodes never overlap. Each structural change triggers a new layout; positions are written to the model with `applyLayout()` (change reason `layout`).

Corners are rounded with `CORNER_RADIUS`, shrinking on short segments. Known limitation: edges do not avoid other nodes.

## Model format

```json
{
  "type": "metamodel",
  "properties": { "name": "Invoice", "documentation": "" },
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

- Model with structure operations: `insertOnEdge`, `appendNode`, `addBranch`, `connect`, `deleteNode`, `deleteEdge`, `setProperty`
- Automatic layout, node dragging removed
- HTML nodes (start, task, gateway, end)
- SVG edges with automatic orthogonal routing, rounded corners, arcs for loops
- Editor: click selects node or edge, action bar shows allowed operations, Del deletes
- Demo page with live JSON output; tests for model, layout and router

- Pan / zoom: drag on empty space pans, mouse wheel zooms at the mouse (as in Open-BPMN), toolbar (−, %, +, Fit), auto fit on load if too large. The action bar lives outside the zoomed content.
- Dark theme (DYNAMIXS.AI style), all colors as `--imixs-*` CSS variables

- Property panel below the canvas: name and documentation for nodes, edges and the diagram; edits go to the model while typing (change reason `properties`, no new layout). Double click focuses the name field.

Next: open points of M4 (public API).

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

1. ~~**Layout**~~ decided: fully automatic (see Decisions).
2. ~~**Gateways**~~ decided: open branches. An "add branch" action on the gateway creates a new successor (default: task with its own end).
3. ~~**Merging branches**~~ decided: no closing gateway; a branch merges via "connect to…".
4. ~~**Loops / back edges**~~ decided: "connect to…" action with a selection list of target elements (also used for merging). The layout must handle merges and back edges.
5. ~~**Deleting**~~ decided:
   - Meta model: element with 1 in / 1 out is bridged (A→X→B becomes A→B). A gateway with several branches cannot be deleted directly; a "delete branch" action removes all elements reachable only via that branch. A gateway with one branch left can be deleted (bridged). Edges pointing to deleted elements are removed.
   - Trees (org chart, skill map): default moves children up to the parent. A separate "delete subtree" action asks for confirmation and shows the number of affected elements. The root cannot be deleted.
6. ~~**Element types**~~ decided for the meta model: `start` (exactly one, cannot be deleted), `task`, `gateway` (exclusive only, no parallel gateway), `end`. No palette: new elements are created by actions on existing elements. Imixs-specific elements are planned later.

Current focus: the meta model (process editor). Org chart and skill map are postponed.

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
