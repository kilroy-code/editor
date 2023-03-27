// FIXME: respect ignorable. See https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace
function isText(node) { // True if node is a text node.
  return node.nodeType === Node.TEXT_NODE;
}
  
function isForward(selection) { // True if selection anchor is earlier than selection focus in document order.
  let {anchorNode, focusNode} = selection;
  if (anchorNode === focusNode) return selection.anchorOffset <= selection.focusOffset;
  let compare = anchorNode.compareDocumentPosition(focusNode);
  if (compare & Node.DOCUMENT_POSITION_PRECEDING) return false;
  if (compare & Node.DOCUMENT_POSITION_FOLLOWING) return true;
  // While it shouldn't happen in our usage, one node could contain the other.
  // FIXME
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
  modifiedKey(event) { // Answer, e.g., "ControlAltMetaShiftX" as appropriate, else "x".
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return event.key; // But not shift!
    function mod(accessor, label) { return event[accessor] ? label : ''; }
    return `${mod('ctrlKey', 'Control')}${mod('altKey', 'Alt')}${mod('metaKey', 'Meta')}${mod('shiftKey', 'Shift')}${event.key.toUpperCase()}`;
  }
  onKey(event) { // Call the method named for the event.key.
    // FIXME: use part-whole inheritance.
    let key = this.modifiedKey(event),
	handler = this[key];
    console.log(event.type, key, handler?.name);
    if (!handler && (key !== event.key)) return; // Ignore modified keys that have no explicit handler. (Do not preventDefault.)
    if (!handler) handler = this.replaceWithText;
    handler.call(this, key, event);
    event.preventDefault(); // Todo: Be careful to check whether we're shadowing browser behavior, by commenting this out and trying all our hotkeys to see what the browser does.
  }
  // No-ops
  Shift() {}
  Control() {}
  Alt() {}
  Meta() {}
  Tab() {}
  Enter() {}
  ArrowUp() {}
  ArrowDown() {}
  CapsLock() {}
  // Ordinary text.
  replaceWithText(inserted) { // remove selection, insert what is specified, and update the selection.
    // This should work fine for leaves that are anything that slice works on. But we'll need to change the reference to textContent
    let {selection} = this,
	{focusNode} = selection; // Where the inserted text will be added. Grab now, because deletion may change it.
    this.assert(isText(focusNode), `Focus ${focusNode} is not a text node.`);

    selection.deleteFromDocument();

    let offset, {textContent} = focusNode; // Of original focusNode!
    if (focusNode === selection.focusNode) { // Normal case. No change to focus node, which completely contains selection.
      offset = selection.focusOffset;
      textContent = textContent.slice(0, offset) + inserted + textContent.slice(offset);
    } else { // If deletion has left us at beginning of text, browsers re-focus to the parent.
      // Here we use the original focusNode from before the deletion, but we need
      // to figure out whether inserted text goes before or after the original focusNode's remaining text.
      let range = selection.getRangeAt(0),
	  compareBeginning = range.comparePoint(focusNode, 0),
	  hasBeginning = compareBeginning === -1;
      if (hasBeginning) {
	offset = textContent.length;
	textContent = textContent + inserted;
      } else {
	offset = 0;
	textContent = inserted + textContent;
      }
    }
    focusNode.textContent = textContent;
    offset += inserted.length;
    selection.setPosition(focusNode, offset);
  }
  Backspace() {
    let {selection} = this;
    if (selection.isCollapsed) {
      selection.modify('extend', 'backward', 'character'); // Cannot merely subtract, as we might be at the beginning of a textNode.
    }
    this.replaceWithText('');
  }
  ArrowLeft() {
    let {selection} = this;
    // Standard behavior everywhere, even if not pedantically logical.
    if (!selection.isCollapsed) return selection.collapseToStart(); // Regardless of selected direction.
    //this.replaceWithText('');
    selection.modify('move', 'backward', 'character');
  }
  ArrowRight() {
    let {selection} = this;
    if (!selection.isCollapsed) return selection.collapseToEnd();
    selection.modify('move', 'forward', 'character');
  }
  // Inline formatting
  addFormat(tag, range, node) { // Put a tag around that part of node that is in range.
    // If node is an element, recurse through childNodes.
    // The tag is added at the lowest level, just above the text.
    // Answers the start and end nodes of range, which after modification might be newly created or split text nodes.
    // FIXME: skip if already enclosed.
    if (isText(node)) {
      // Surround just the part of node that is within range.
      let added = document.createElement(tag),
	  parent = node.parentNode;
      //            +---------------------------------+
      //            |                    range        |
      // +----------------------+ +-------------+ +-------------------+
      // | node straddles start | | node inside | | node staddles end |
      // +----------------------+ +-------------+ +-------------------+
      //     +----------------------------------------------+
      //     |           node straddles range               |
      //     +----------------------------------------------+
      // ------+                                          +-----------+
      // before|                                          | node after|
      // ------+                                          +-----------+
      let compareStart = range.comparePoint(node, 0),
	  compareEnd = range.comparePoint(node, node.textContent.length);
      
      //let {startContainer, startOffset, endContainer, endOffset} = range;
      //console.log({tag, parent, node, startContainer, startOffset, compareStart, endContainer, endOffset, compareEnd});

      if (compareStart < 0 && compareEnd === 0) {          // node straddles start
	node = node.splitText(range.startOffset);
      } else if (compareStart === 0 && compareEnd > 0) {   // node straddles end
	node = node.splitText(range.endOffset);
	node = node.previousSibling; // Subtle: split returns the newly created node, preserving order. But it might not be second of parent!
      } else if (compareStart === 0 && compareEnd === 0) { // node entirely inside
	// no need to split
      } else if (compareStart < 0 && compareEnd > 0) {     // node straddles range
	node = node.splitText(range.startOffset);
	node = node.splitText(range.endOffset);
	node = node.previousSibling;
      } else { // node is enitrely before or entirely after
	return [];
      }
      //console.log(node, parent.childNodes);
      parent.replaceChild(added, node);
      added.appendChild(node);
      return [node, node];
    }
    let start, end, childNodes = [...node.childNodes]; // A copy!
    for (let index = 0; index < childNodes.length; index++) {
      let [first, last] = this.addFormat(tag, range, childNodes[index]);
      if (!start && first) start = first;
      if (last) end = last;
      //console.log({first, last, start, end});
    }
    return [start, end];
  }
  toggle(tag) { // Toggle tag off or on for range, retaining selection.
    let {selection} = this,
	{rangeCount} = selection,
	backwards = !isForward(selection),
	start, end;
    for (let index = 0; index < rangeCount; index++) {
      let range = selection.getRangeAt(index),
	  [first, last] = this.addFormat(tag, range, range.commonAncestorContainer);
      if (!start && first) start = first;
      if (last) end = last;
      //console.log({first, last, start, end});
    }
    // Reset selection, maintaining direction. Text nodes may have been split.
    let startOffset = 0, endOffset = end.textContent.length;
    if (backwards) [start, startOffset, end, endOffset] = [end, endOffset, start, startOffset];
    selection.setBaseAndExtent(start, startOffset, end, endOffset);
  }
  MetaB() { // "bold".
    this.toggle('B');
  }
  MetaI() { // "italic".
    this.toggle('I');
  }
  MetaU() { // "unarticulated annotation", which everything thinks of as "underline".
    this.toggle('U');
  }
  MetaS() { // "strikethrough".
    this.toggle('S');
  }
  MetaK() { // "linK"
    this.toggle('A');
  }
  MetaC() { // "code" (monospace)
    this.toggle('CODE');
  }
}

var textEditor = new TextEditor({selection: document.getSelection(), content: editor});
window.hrs = textEditor;
