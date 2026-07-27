// Author: Preston Lee

import {
  EditorView,
  Decoration,
  DecorationSet,
  WidgetType,
  keymap
} from '@codemirror/view';
import { Extension, StateEffect, StateField } from '@codemirror/state';
import { CqlDefinitionIndex, CqlReferenceMatch } from './elm-locator.lib';

export interface GoToDefinitionHandlers {
  findReferenceAt: (line: number, column: number) => CqlReferenceMatch | null;
  isResolvableSync: (match: CqlReferenceMatch) => boolean;
  goToDefinitionAt: (line: number, column: number) => void | Promise<void>;
}

export const setDefinitionIndexEffect = StateEffect.define<CqlDefinitionIndex | null>();

const setLinkDecorationsEffect = StateEffect.define<DecorationSet>();

interface GoToDefinitionState {
  index: CqlDefinitionIndex | null;
  linkDecorations: DecorationSet;
}

const goToDefinitionField = StateField.define<GoToDefinitionState>({
  create(): GoToDefinitionState {
    return {
      index: null,
      linkDecorations: Decoration.none
    };
  },
  update(value, tr): GoToDefinitionState {
    let { index, linkDecorations } = value;

    for (const effect of tr.effects) {
      if (effect.is(setDefinitionIndexEffect)) {
        index = effect.value;
        linkDecorations = Decoration.none;
      }
      if (effect.is(setLinkDecorationsEffect)) {
        linkDecorations = effect.value;
      }
    }

    if (tr.docChanged) {
      linkDecorations = Decoration.none;
    }

    return { index, linkDecorations };
  },
  provide(field): Extension {
    return EditorView.decorations.from(field, state => state.linkDecorations);
  }
});

class ContextMenuWidget extends WidgetType {
  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly onGo: () => void,
    private readonly onDismiss: () => void
  ) {
    super();
  }

  override eq(other: ContextMenuWidget): boolean {
    return this.x === other.x && this.y === other.y;
  }

  toDOM(): HTMLElement {
    const menu = document.createElement('div');
    menu.id = 'cql-go-to-definition-menu';
    menu.className = 'dropdown-menu show position-fixed shadow';
    menu.style.left = `${this.x}px`;
    menu.style.top = `${this.y}px`;
    menu.style.zIndex = '1050';

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-item';
    item.id = 'cql-go-to-definition-menu-item';
    item.textContent = 'Go to Definition';
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onGo();
    });
    menu.appendChild(item);

    const dismiss = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && menu.contains(target)) {
        return;
      }
      document.removeEventListener('mousedown', dismiss, true);
      this.onDismiss();
    };
    requestAnimationFrame(() => document.addEventListener('mousedown', dismiss, true));

    return menu;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function isModifierPressed(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function posToLineColumn(view: EditorView, pos: number): { line: number; column: number } {
  const lineInfo = view.state.doc.lineAt(pos);
  return {
    line: lineInfo.number,
    column: pos - lineInfo.from
  };
}

function buildLinkDecoration(view: EditorView, match: CqlReferenceMatch): DecorationSet {
  const { span } = match.reference;
  try {
    const startLine = view.state.doc.line(span.startLine);
    const endLine = view.state.doc.line(span.endLine);
    const from = startLine.from + Math.max(0, span.startColumn - 1);
    // ELM endColumn is 1-based inclusive; CodeMirror ranges use an exclusive end offset.
    const to = endLine.from + span.endColumn;
    if (from >= to) {
      return Decoration.none;
    }
    return Decoration.set([
      Decoration.mark({ class: 'cm-cql-definition-link' }).range(from, to)
    ]);
  } catch {
    return Decoration.none;
  }
}

export function createGoToDefinitionExtension(
  handlers: GoToDefinitionHandlers
): Extension[] {
  return [
    goToDefinitionField,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        const current = view.state.field(goToDefinitionField).linkDecorations;

        if (!isModifierPressed(event)) {
          if (current.size > 0) {
            view.dispatch({ effects: setLinkDecorationsEffect.of(Decoration.none) });
          }
          return false;
        }

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          if (current.size > 0) {
            view.dispatch({ effects: setLinkDecorationsEffect.of(Decoration.none) });
          }
          return false;
        }

        const { line, column } = posToLineColumn(view, pos);
        const match = handlers.findReferenceAt(line, column);
        const resolvable = match ? handlers.isResolvableSync(match) : false;
        const linkDecorations = resolvable && match
          ? buildLinkDecoration(view, match)
          : Decoration.none;

        view.dispatch({ effects: setLinkDecorationsEffect.of(linkDecorations) });

        return false;
      },
      mouseleave(_event, view) {
        if (view.state.field(goToDefinitionField).linkDecorations.size > 0) {
          view.dispatch({ effects: setLinkDecorationsEffect.of(Decoration.none) });
        }
        return false;
      },
      mousedown(event, view) {
        if (!isModifierPressed(event) || event.button !== 0) {
          return false;
        }

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          return false;
        }

        const { line, column } = posToLineColumn(view, pos);
        const match = handlers.findReferenceAt(line, column);
        if (!match || !handlers.isResolvableSync(match)) {
          return false;
        }

        event.preventDefault();
        void handlers.goToDefinitionAt(line, column);
        return true;
      },
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          return false;
        }

        const { line, column } = posToLineColumn(view, pos);
        const match = handlers.findReferenceAt(line, column);
        if (!match || !handlers.isResolvableSync(match)) {
          return false;
        }

        event.preventDefault();

        document.getElementById('cql-go-to-definition-menu')?.remove();

        const widget = new ContextMenuWidget(
          event.clientX,
          event.clientY,
          () => {
            document.getElementById('cql-go-to-definition-menu')?.remove();
            void handlers.goToDefinitionAt(line, column);
          },
          () => {
            document.getElementById('cql-go-to-definition-menu')?.remove();
          }
        );

        document.body.appendChild(widget.toDOM());
        return true;
      }
    }),
    EditorView.theme({
      '.cm-cql-definition-link': {
        textDecoration: 'underline',
        cursor: 'pointer'
      }
    }),
    keymap.of([
      {
        key: 'F12',
        run(view) {
          const pos = view.state.selection.main.head;
          const { line, column } = posToLineColumn(view, pos);
          const match = handlers.findReferenceAt(line, column);
          if (!match || !handlers.isResolvableSync(match)) {
            return false;
          }
          void handlers.goToDefinitionAt(line, column);
          return true;
        }
      }
    ])
  ];
}

export function reconfigureDefinitionIndex(
  view: EditorView,
  index: CqlDefinitionIndex | null
): void {
  view.dispatch({
    effects: setDefinitionIndexEffect.of(index)
  });
}

export function goToDefinitionFieldExtension(): Extension {
  return goToDefinitionField;
}
