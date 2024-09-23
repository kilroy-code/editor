// FIXME: respect ignorable. See https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace

import { Window } from '#window'; // Either browser window, or a jsdom parsed window.
export const document = Window.document;
export const Node = Window.Node;
let Selector = document.getSelection().constructor;
if (!Selector.prototype.modify) { // Not present in jsdom. Define our own just-good-enough version.
  // Just enough for our unit tests -- which are testing other things, not this. 
  Selector.prototype.modify = function modify(alteration, direction, granularity) {
    // Complain about things we don't try to handle.
    if (granularity !== 'character') throw Error(`Polyfill Selector.modify does not support granularity '${granularity}'.`);
    if (['backward', 'left', 'right'].includes(direction)) throw Error(`Polyfill Selector.modify does not support granularity '${granularity}'.`);

    // See https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace
    function is_all_ws(string) {
      return !/[^\t\n\r ]/.test(string);
    }
    function is_ignorable(node) {
      return node.nodeType === Node.COMMENT_NODE || (isText(node) && is_all_ws(node.textContent))
    }
    function node_after(sib) {
      while ((sib = sib.nextSibling)) {
        if (!is_ignorable(sib)) return sib;
      }
      return null;
    }
    let isCollapsed = this.isCollapsed,
        advance1 = () => {
          let {focusNode, focusOffset} = this;
          // If there's room to set the focus one spot over, do so -- and repeat IF we're skipping over ignorable whitespace.
          if (!isText(focusNode)) {
            if (focusOffset < focusNode.childNodes.length) {
              this.setBaseAndExtent(this.anchorNode, this.anchorOffset, focusNode, focusOffset + 1);
              if (is_ignorable(focusNode.childNodes[focusOffset])) advance1();
              return;
            }
          } else if (!is_ignorable(focusNode)) {
            let string = focusNode.textContent;
            if (focusOffset < string.length) {
              this.setBaseAndExtent(this.anchorNode, this.anchorOffset, focusNode, focusOffset + 1);
              if (is_all_ws(string[focusOffset]) && focusOffset && is_all_ws(string[focusOffset - 1])) advance1();
              return;
            }
          }
          let nextSibling = node_after(focusNode);
          if (nextSibling) {
            //console.log('advance next sibling');
            this.setBaseAndExtent(this.anchorNode, this.anchorOffset, nextSibling, 0);
            return;
          }
          //console.log('advance up');
          this.setBaseAndExtent(this.anchorNode, this.anchorOffset, focusNode.parentNode, Array.from(focusNode.parentNode.childNodes).length);
          return advance1();
        };
    advance1();
    if (isCollapsed) this.collapseToEnd();
  };
}

// Utilities


export function normalizeSelectionFocus(selection) {
  // Make sure node is in a text node, creating one if necessary.
  let node = selection.focusNode;
  //console.log('normalize', node.nodeName, node.outerHTML || node.textContent, selection.focusOffset);
  if (isText(node)) return;
  let nodes = node.childNodes;
  if (nodes.length) { // E.g., in span or div of <div><span>text</span></div>
    //console.log('normalize is choosing', selection.focusOffset, 'of', nodes.length);
    selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, nodes[selection.focusOffset], 0);
    return normalizeSelectionFocus(selection);
  }
  // E.g., in <span></span>
  //console.log('normalizeSelectionFocus is creating empty node!');
  let text = createTextNode('');
  node.appendChild(text);
  selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, text, 0);
  // No need to recurse.
}
  

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

function findAncestorWithTag(node, tag) { // Answer first ancestor with the specified tag, or falsy.
  if (!node) return node;
  if (node.tagName === tag) return node;
  return findAncestorWithTag(node.parentElement, tag);
}

function nodeString(node) { // Answer a string that helps us identify what node is while debugging, or node if it isn't a Node
  switch (node?.nodeType) {
  case undefined: return node;
  case Node.TEXT_NODE: return `'${node.textContent}'`;
  default: return node.outerHTML;
  }
}

function nodeParts(node) { // childNodes or textContent
  return isText(node) ? node.textContent : node.childNodes;
}

export class TextEditor {
  constructor({selection, content}) {
    Object.assign(this, {selection, content});
    content.onkeydown = this.onKey.bind(this); // onkeydown will auto-repeat.
    // selectionchange fires on the document as a whole. This adds a listener for each TextEditor instance.
    if (selection) document.addEventListener('selectionchange', event => this.onSelectionChange(event));
  }
  assert(ok, message, ...rest) { // If !ok, log the message and ...rest.
    if (ok) return;
    console.error(message, ...rest);
    throw new Error([message, ...rest].join(', '));
  }
  debug(...rest) {
    console.log(...(rest.map(nodeString)));
  }
  onSelectionChange(event) { // Fires when the selection changes anywhere in the document (not just our editor).
    // The default here just confirms that the document.getSelection() always returns the same instance
    // even as the anchor and focus change.
    this.assert(this.selection === document.getSelection(),
		"Selection has changed! this:", this.selection, "doc:", document.getSelection());
  }

  // Returns a unique canonicalized name string for a key event, recognizable as a Javascript identifier.
  // e.g., "a", "A", or "ControlAltMetaShiftA".
  // The names are suitable as method names or object properties.
  //
  // Modifier keys get canonicalized into Control, Alt, or Meta.
  // Mac:
  //   control modifier reports as Control
  //   option modifier reports as Alt
  //   command modifier reports as Meta
  //   shift modifier reports as Shift
  // If none of these are used, modifiedKey(event) just return the name of the key. This is usually
  // just the single character that the user typed, in the correct case, e.g., "a" or "A".
  // Some keys have canonicalized names such as "Tab", "Enter", "ArrowUp", "CapsLock".
  //
  // However, if a modified key was held down, the return string includes all the applicable modifier names in order,
  // followed by Shift if applicable, and then the key in upper case, e.g., "ControlAltMetaShiftA".
  //
  // Browser also emit key events for the modifier keys as they are pressed, and these work the same way.
  // E.g., if control is held down when you press alt, the alt press would canonicalize as ControlAltALT.
  // Note that the control key by itself will canonicalize as "ControlCONTROL", which is not === to event.key,
  // but the shift key by itself, which is not one of Control, Alt, or Meta, will canonicalize as "Shift", which is === to event.key.
  //
  // Browsers do not distinguish between left and right modifier keys.
  
  modifiedKey(event) {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return event.key; // But not shift!
    function mod(accessor, label) { return event[accessor] ? label : ''; }
    return `${mod('ctrlKey', 'Control')}${mod('altKey', 'Alt')}${mod('metaKey', 'Meta')}${mod('shiftKey', 'Shift')}${event.key.toUpperCase()}`;
  }
  onKey(event) { // Call the method named for the event.key.
    // FIXME: use part-whole inheritance.
    let key = this.modifiedKey(event),
	handler = this[key];
    this.debug(event.type, key, event.key, handler?.name);
    if (!handler && (key !== event.key)) return this.debug('no-op', key); // Ignore modified keys that have no explicit handler. (Do not preventDefault.)
    if (!handler) handler = this.replaceWithText; // The default behavior.
    handler.call(this, key, event);
    event.preventDefault(); // Todo: Be careful to check whether we're shadowing browser behavior, by commenting this out and trying all our hotkeys to see what the browser does.
  }

  // Ordinary text.
  replaceWithText(inserted) { // remove selection, insert what is specified, and update the selection.
    // This should work fine for leaves that are anything that slice works on. But we'll need to change the reference to textContent
    let {selection} = this,
	{focusNode} = selection; // Where the inserted text will be added. Grab now, because deletion may change it.
    this.assert(isText(focusNode), 'Focus is not a text node:', focusNode);

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
  // Inline formatting
  wrap(node, tag, logIndent = '') { // Wrap entire node in a tag element, retaining position in parent, and answering the wrapping element.
    this.debug(logIndent, 'wrap:', node, tag);
    let added = document.createElement(tag);
    node.parentElement.replaceChild(added, node);
    added.appendChild(node);
    return added;
  }
  unwrap(node, logIndent = '') { // Replace node with it's children
    this.debug(logIndent, 'unwrap', node);
    node.replaceWith(...node.childNodes);
  }
  // Nodes are processed for formatting based on the nodes relation to the range:
  //
  //            +---------------------------------+
  //            |                    range        |
  // +----------------------+                  +-------------------+
  // | node straddles start |                  | node staddles end |
  // +----------------------+                  +-------------------+
  //     +----------------------------------------------+
  //     |           node straddles range               |
  //     +----------------------------------------------+
  // ------+                  +-------------+         +-----------+
  // before|                  | node inside |         | node after|
  // ------+                  +-------------+         +-----------+
  splitTextNode(node, startOffset, endOffset, compareStart, compareEnd) {
    // Splits the text node at the startOffset and endOffset if necessary, based on range compareStart and compareEnd.
    // Returns [before, inRange, after], with each being text nodes made from node, or falsey if not applicable.

    // Break up node into two or three parts.
    if (compareStart < 0 && compareEnd === 0) { // node straddles start
      node = node.splitText(startOffset);
      return [node.previousSibling, node, null];
    }
    if (compareStart === 0 && compareEnd > 0) { // node straddles end
      node = node.splitText(endOffset);
      return [null, node.previousSibling, node];
    }
    if (compareStart < 0 && compareEnd > 0) {     // node straddles range
      node = node.splitText(startOffset);
      node = node.splitText(endOffset - startOffset);
      node = node.previousSibling;
      return [node.previousSibling, node, node.nextSibling];
    }

    // No need to break up text:
    if (compareStart === 0 && compareEnd === 0) { // Node is entirely within range.
      return [null, node, null];
    }
    if (compareEnd < 0 || compareStart > 0) { // Node is entirely before or entirely after range.
      return [];
    }
    this.assert(false, 'Impossible comparison', node, compareStart, compareEnd, startContainer, endContainer);
  }
  format({tag, startContainer, startOffset, endContainer, endOffset/*, range*/, node, inRangeOn, outOfRangeOn, logIndent = ''}) {
    // Operate on descendants of node that are within range.
    // Elements matching tag have the tag removed (leaving their contents included), as they may be added back just above leaf text.
    // Text nodes are split up as needed (e.g., if a text node crosses the range).
    //   The text nodes within the range are surrounded with tag only if inRangeOn is true.
    //   The text nodes outside the range are surrounded with tag only if outofRangeOn is true.
    // Answers the [start, end], where
    //   start, end are text node descendants of node that are within range (if any), which after modification might be newly created or split.
    //let {startContainer, startOffset, endContainer, endOffset} = range;
    let internalIndent = '  '+logIndent;
    this.debug(logIndent, 'format:', node, 'tag/in/out:', tag, inRangeOn, outOfRangeOn, 'selection:', startContainer, startOffset, endContainer, endOffset);
    if (isText(node)) {
      let range = new (this.selection.getRangeAt(0).constructor)(); range.setStart(startContainer, startOffset); range.setEnd(endContainer, Math.min(endOffset, endContainer.textContent.length));
      let compareStart = range.comparePoint(node, 0),
          compareEnd = range.comparePoint(node, nodeParts(node).length);
      let [before, inside, after] = this.splitTextNode(node, startOffset, endOffset, compareStart, compareEnd);;
      let insideText = inside;
      if (before && outOfRangeOn) before = this.wrap(before, tag, internalIndent);
      if (inside && inRangeOn) inside = this.wrap(inside, tag, internalIndent);
      if (after && outOfRangeOn) after = this.wrap(after, tag, internalIndent);
      this.debug(logIndent, 'format text', startOffset, endOffset, compareStart, compareEnd, '=>', before, inside, after, insideText);
      return [insideText, insideText];
    }
    // Node is an element: recursively format each child, keeping track of the first start we see, and the last end.
    let start, end,
	removeNode = (node.tagName === tag),
	childNodes = [...node.childNodes]; // A copy!
    let childOutOfRangeOn = outOfRangeOn || removeNode;
    for (let index = 0; index < childNodes.length; index++) {
      let child = childNodes[index];
      this.debug(logIndent, 'child', child);
      let [first, last] = this.format({tag, startContainer, startOffset, endContainer, endOffset/*, range*/, node:child, inRangeOn, outOfRangeOn:childOutOfRangeOn, logIndent:internalIndent});
      start ||= first;
      end = last || end;
    }
    if (removeNode) this.unwrap(node, internalIndent); // After iteration, as this can mess up range.
    this.debug(logIndent, 'formatted element from', start, 'to', end);
    return [start, end];
  }
  toggle(tag) { // Toggle tag off or on for range, retaining selection.  Requires tag to be upper case.
    // Determine overall whether/how we are within an existing tag element, format each range accordingly, and then reset selection.
    let {selection} = this;
    for (let index = 0; index < selection.rangeCount; index++) {
      let range = selection.getRangeAt(index),
          {startContainer, startOffset, endContainer, endOffset} = range,
          existing = findAncestorWithTag(startContainer, tag), // If the startNode is within an element with the specified tag, we will be removing the tag.
          ancestor = range.commonAncestorContainer,
	  fromExisting = existing?.contains(ancestor),
	  node = fromExisting ? existing : ancestor,
          [first, last] = this.format({tag, startContainer, startOffset, endContainer, endOffset/*, range*/, node, inRangeOn:!existing, outOfRangeOn:fromExisting});
      // Adjust for any text split. first and last are always text nodes entirely within selection.
      // Is it possible that selection is not updated accordingly? Either at all, or as to anchor=>focus pointing backwards?
      range.setStart(first, 0);
      range.setEnd(last, last.textContent.length);
    }
  }
  collapsedForward(amount = 'character') {
    let {selection} = this;
    // Standard behavior everywhere, even if not pedantically logical.
    if (!selection.isCollapsed) return selection.collapseToEnd(); // Regardless of selected direction.
    selection.modify('move', 'forward', amount);
  }
  collapsedBackward(amount = 'character') {
    let {selection} = this;
    // Standard behavior everywhere, even if not pedantically logical.
    if (!selection.isCollapsed) return selection.collapseToStart(); // Regardless of selected direction.
    selection.modify('move', 'backward', amount);
  }

  // Apple command key is Meta
  // No-ops
  Shift() {}
  Tab() {}
  Enter() {}
  ArrowUp() {}
  ArrowDown() {}
  CapsLock() {}
  // Navigation
  Backspace() {
    let {selection} = this;
    if (selection.isCollapsed) {
      selection.modify('extend', 'backward', 'character'); // Cannot merely subtract, as we might be at the beginning of a textNode.
    }
    this.replaceWithText('');
  }
  ArrowLeft() {
      this.collapsedBackward('character');
  }
  ArrowRight() {
    this.collapsedForward('character');
  }
  MetaArrowLeft() {
    this.collapsedBackward('word');
  }
  MetaArrowRight() {
    this.collapsedForward('word');
  }
  // Inline text formatting.
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
  MetaM() { // "code" (monospace)
    this.toggle('CODE');
  }
}


