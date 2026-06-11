// Author: Preston Lee

import {
  Component,
  input,
  AfterViewInit,
  OnDestroy,
  effect,
  viewChild,
  ElementRef
} from '@angular/core';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { CqlGrammarManager } from '../../../services/cql-grammar-manager.service';
import { createCqlEditorBaseExtensions } from '../../../services/cql-codemirror-extensions.lib';

/**
 * Read-only CodeMirror view with the same CQL grammar and highlighting as {@link CqlEditorComponent}.
 */
@Component({
  selector: 'app-cql-readonly-preview',
  templateUrl: './cql-readonly-preview.component.html',

  styleUrl: './cql-readonly-preview.component.scss'
})
export class CqlReadonlyPreviewComponent implements AfterViewInit, OnDestroy {
  /** CQL text to display. */
  content = input<string>('');
  /** Minimum height of the editor (e.g. CSS length). */
  minHeight = input<string>('12rem');

  private readonly editorContainer = viewChild<ElementRef<HTMLDivElement>>('editorContainer');
  private readonly grammarManager = new CqlGrammarManager();
  private editor?: EditorView;

  constructor() {
    effect(() => {
      const text = this.content() ?? '';
      const ed = this.editor;
      if (!ed) {
        return;
      }
      const cur = ed.state.doc.toString();
      if (cur !== text) {
        ed.dispatch({
          changes: { from: 0, to: ed.state.doc.length, insert: text }
        });
      }
    });
  }

  ngAfterViewInit(): void {
    this.initializeEditor();
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = undefined;
  }

  private initializeEditor(): void {
    const container = this.editorContainer()?.nativeElement;
    if (!container || this.editor) {
      return;
    }

    const initial = this.content() ?? '';
    const state = EditorState.create({
      doc: initial,
      extensions: [
        EditorState.readOnly.of(true),
        ...createCqlEditorBaseExtensions(),
        ...this.grammarManager.createExtensions()
      ]
    });

    this.editor = new EditorView({
      state,
      parent: container
    });
  }
}
