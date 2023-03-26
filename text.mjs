// FIXME: respect ignorable. See https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace
function isText(node) {
  return node.nodeType === Node.TEXT_NODE;
}
function firstTextNode(node) { // Get the first non-ignorable text node, or null.
  if (!node) return node;
  if (isText(node)) return node;
  return firstTextNode(node.firstChild);
}

export class TextEditor {
  constructor({selection, content}) {
    Object.assign(this, {selection, content});
    content.onkeydown = this.onKey.bind(this); // repeats
    // selectionchange fires on the document as a whole. This adds a listener for each TextEditor instance.
    if (selection) document.addEventListener('selectionchange', event => this.onSelectionChange(event));
  }
  assert(ok, message, ...rest) { // If !ok, log the message and ...rest.
    if (ok) return;
    console.error(message, ...rest);
    throw new Error([message, ...rest].join(', '));
  }
  onSelectionChange(event) {
    this.assert(this.selection === document.getSelection(),
		"Selection has changed! this:", this.selection, "doc:", document.getSelection());
  }
  onKey(event) { // Call the method named for the event.key.
    // FIXME: use part-whole inheritance.
    let key = event.key,
	handler = this[key];
    if (!handler) handler = this.defaultKeyHandler;
    console.log('key', event.type, key, handler.name);
    handler.call(this, key, event);
    event.preventDefault(); // Todo: Be careful to check whether we're shadowing browser behavior, by commenting this out and trying all our hotkeys to see what the browser does.
  }
  // Adding and removing text.
  defaultKeyHandler(inserted) { // remove selection, insert what is specified, and update the selection.
    let {selection} = this;
    // This should work fine for leaves that are anything that slice works on. But we'll need to change the two occurences of wholeText.

    let node = selection.focusNode; // Where the inserted text will be added. Grab now, because deletion may change it.
    selection.deleteFromDocument();
    let offset, string = node.textContent; // Original focusNode!
    if (node === selection.focusNode) { // Normal case. No change to focus node, which completely contains selection.
      offset = selection.focusOffset;
      string = string.slice(0, offset) + inserted + string.slice(offset);
    } else { // If deletion has left us at beginning of text, browsers re-focus to the parent.
      // Here we use the original focusNode from before the deletion, but we need
      // to figure out whether inserted text goes before or after that node's remaining text.
      let range = selection.getRangeAt(0),
	  compareBeginning = range.comparePoint(node, 0),
	  hasBeginning = compareBeginning === -1;
      if (hasBeginning) {
	offset = string.length;
	string = string + inserted;
      } else {
	offset = 0;
	string = inserted + string;
      }
    }
    node.textContent = string;
    offset += inserted.length;
    selection.setPosition(node, offset);
  }
  Shift() {}
  Control() {}
  Alt() {}
  Meta() {}
  Tab() {}
  Enter() {}
  ArrowUp() {}
  ArrowDown() {}
  CapsLock() {}
  Backspace() {
    let {selection} = this;
    if (selection.isCollapsed) {
      selection.modify('extend', 'backward', 'character'); // Cannot merely subtract, as we might be at the beginning of a textNode.
    }
    this.defaultKeyHandler('');
  }
  ArrowLeft() {
    this.defaultKeyHandler('');
    this.selection.modify('move', 'backward', 'character');
  }
  ArrowRight() {
    this.defaultKeyHandler('');
    this.selection.modify('move', 'forward', 'character');
  }
}

var textEditor = new TextEditor({selection: document.getSelection(), content: editor});
window.hrs = textEditor;
