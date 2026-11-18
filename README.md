# Imixs-Diagram

A lightweight, dependency-free diagram editor written in plain JavaScript.

Imixs-Diagram lets you place, move and connect a small number of elements on a canvas. It is built for simple, focused models such as:

- **Meta models**: BPMN-like process models with a handful of element types (e.g. start, task, gateway, end)
- **Org charts**: hierarchical tree views of an organization
- **Skill maps**: hierarchical structures of skills and competencies

The editor is meant to be embedded in web applications, in particular Jakarta EE Faces applications such as [Imixs-Office-Workflow](https://doc.office-workflow.com/). The resulting model is plain JSON and is meant for the backend to store, not for interchange with other tools.

> **Status:** Early playground. The project is built step by step; APIs may change at any time.

## Why another diagram editor?

Existing diagram frameworks (Sprotty/GLSP, React Flow, JointJS, X6, …) are powerful, but they bring framework dependencies, build tooling or client-server architecture that are oversized for models with fewer than ten elements. Imixs-Diagram takes the opposite approach:

- **No dependencies**: plain ES modules, no UI framework
- **No build step**: the sources run directly in the browser
- **Small and readable**: a codebase that one developer can understand completely
- **One core, several views**: free-form canvas and tree layouts share the same model and rendering

Advanced BPMN semantics, collaborative editing and server-side diagram logic are explicitly out of scope.

## Architecture

```
            ┌──────────────────────────────────────────────┐
 Host app   │  init(element, model) · getModel() · events  │   index.js (public API)
            └──────────────────────┬───────────────────────┘
                                   │
            ┌──────────────────────▼───────────────────────┐
            │                  Model (JSON)                │   model.js
            │   single source of truth: nodes + edges      │
            └───────┬──────────────┬───────────────┬───────┘
                    │ change events│               │
         ┌──────────▼───┐   ┌──────▼──────┐   ┌────▼─────────┐
         │ Nodes        │   │ Edges       │   │ Properties   │
         │ HTML/CSS     │   │ SVG layer   │   │ HTML form    │
         └──────────┬───┘   └──────┬──────┘   └──────────────┘
                    └──────┬───────┘
                    ┌──────▼──────┐      ┌───────────────┐
                    │ Canvas      │◄─────│ Palette       │
                    │ pan / zoom  │      │ toolbar       │
                    └──────▲──────┘      └───────────────┘
                           │ positions
                    ┌──────┴──────┐
                    │ Layout      │  manual (free-form) or tree
                    └─────────────┘
```

**Principles**

1. **The model is the single source of truth.** All user actions change the model, and the view re-renders from it. The UI never holds state of its own that the model does not have.
2. **Nodes are HTML, edges are SVG.** Nodes are absolutely positioned HTML elements styled with CSS. Edges are drawn in an SVG layer on top of the same coordinate system.
3. **The layout is pluggable.** In a free-form diagram the user sets positions. In a tree view (org chart, skill map) a layout algorithm computes them. Everything else stays the same.
4. **The host app integrates through a small API.** The host passes in a model, reads the current model and listens for change events, for example to fill a hidden input field in a Faces form.

### Model format

```json
{
  "type": "metamodel",
  "nodes": [
    {
      "id": "n1",
      "type": "start",
      "x": 80,
      "y": 120,
      "properties": { "name": "Start" }
    },
    {
      "id": "n2",
      "type": "task",
      "x": 240,
      "y": 100,
      "properties": { "name": "Review" }
    }
  ],
  "edges": [{ "id": "e1", "source": "n1", "target": "n2", "properties": {} }]
}
```

### Planned module structure

| Module               | Responsibility                                      |
| -------------------- | --------------------------------------------------- |
| `src/model.js`       | JSON model, add / update / remove, change events    |
| `src/canvas.js`      | Canvas container, pan / zoom, coordinate transforms |
| `src/nodes.js`       | Node rendering (HTML/CSS) and dragging              |
| `src/edges.js`       | Edge rendering (SVG) and connect tool               |
| `src/palette.js`     | Toolbar to add new elements                         |
| `src/properties.js`  | Property panel bound to the selected element        |
| `src/layout-tree.js` | Tree layout for org charts and skill maps           |
| `src/index.js`       | Public API                                          |

## Repository layout

```
src/     ES modules of the editor
demo/    playground pages, one per milestone or use case
test/    unit tests for model and serialization (node:test)
docs/    setup and extension guide
```

## Getting started

No build is required. Serve the repository with any static web server and open the demo page:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080/demo/` in your browser.

## Roadmap

| Step | Scope                                              |
| ---- | -------------------------------------------------- |
| M0   | Project skeleton, JSON model with tests            |
| M1   | Canvas with HTML nodes, drag & drop                |
| M2   | SVG edges, connect by dragging                     |
| M3   | Palette, selection, delete (incl. connected edges) |
| M4   | Property panel, public API                         |
| M5   | Pan / zoom                                         |
| M6   | Tree layout, org chart demo                        |
| M7   | Skill map, re-parent subtrees by drag & drop       |
| M8   | WebJar packaging, Jakarta Faces integration        |

## Browser support

Current versions of Chrome, Firefox, Safari and Edge.

## License

See [LICENSE](LICENSE).
