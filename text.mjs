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
  // +----------------------+ +-------------+ +-------------------+
  // | node straddles start | | node inside | | node staddles end |
  // +----------------------+ +-------------+ +-------------------+
  //     +----------------------------------------------+
  //     |           node straddles range               |
  //     +----------------------------------------------+
  // ------+                                          +-----------+
  // before|                                          | node after|
  // ------+                                          +-----------+
  splitTextNode(tag, range, node, inRangeOn, outOfRangeOn, logIndent = '', compareStart, compareEnd) {
    // Surround just the part of node that is within range, splitting as needed.
    let {startOffset, endOffset} = range;

    // No need to break up text:
    if (!outOfRangeOn && (compareEnd < 0 || compareStart > 0)) { // Node is entirely before or entirely after range.
      this.debug(logIndent, 'format skipped for !outOfRangeOn, compareStart/End', compareStart, compareEnd);
      return [];
    }
    if (!inRangeOn && compareStart === 0 && compareEnd === 0) { // Node is entirely within range.
      this.debug(logIndent, 'format skipped for !inRangeOn, compareStart/End', compareStart, compareEnd);
      return [node, node, node];
    }

    // Break up node into two or three parts, after which node is the part in-range.
    // The part of text within range will be left in the variable 'node'.
    if (compareStart < 0 && compareEnd === 0) {          // node straddles start
      node = node.splitText(range.startOffset);
      if (outOfRangeOn) this.wrap(node.previousSibling, tag, logIndent);
    } else if (compareStart === 0 && compareEnd > 0) {   // node straddles end
      node = node.splitText(range.endOffset);
      node = node.previousSibling; // Subtle: split returns the newly created node, preserving order. But it might not be second of parent!
      if (outOfRangeOn) this.wrap(node.nextSibling, tag, logIndent);
    } else if (compareStart === 0 && compareEnd === 0) { // node entirely inside
      // no need to split
    } else if (compareStart < 0 && compareEnd > 0) {     // node straddles range
      let {startOffset, endOffset} = range;
      node = node.splitText(startOffset);
      node = node.splitText(endOffset - startOffset);
      node = node.previousSibling;
      if (outOfRangeOn) {
        this.wrap(node.previousSibling, tag, logIndent);
        this.wrap(node.nextSibling, tag, logIndent);
      }
    }
    let wrapped = inRangeOn ? this.wrap(node, tag, logIndent) : node; //fixme
    this.debug(logIndent, 'formatted text in', node, wrapped);
    return [node, node, wrapped];
  }
  format({tag, range, node, inRangeOn, outOfRangeOn, logIndent = ''}) {
    // Operate on descendants of node that are within range.
    // Elements matching tag have the tag removed (leaving their contents included), as they may be added back immediately around leaf text.
    // Text nodes are split up as needed (e.g., if a text node crosses the range).
    //   The text nodes within the range are surrounded with tag only if inRangeOn is true.
    //   The text nodes outside the range are surrounded with tag only if outofRangeOn is true.
    // Answers the [start, end, possiblyReplacedNode], where
    //   start, end are text node descendants of node that are within range (if any), which after modification might be newly created or split.
    //   possiblyReplacedNode is node or a wrapper around it.
    let {startContainer, startOffset, endContainer, endOffset} = range;
    let compareStart = range.comparePoint(node, 0),
        compareEnd = range.comparePoint(node, nodeParts(node).length);
    this.debug(logIndent, 'format:', tag, startContainer, startOffset, endContainer, endOffset, 'node/in/out:', node, inRangeOn, outOfRangeOn);
    if (isText(node)) return this.splitTextNode(tag, range, node, inRangeOn, outOfRangeOn, logIndent, compareStart, compareEnd);
    // Node is an element: recursively format each child.
    let start, end,
	removeNode = (node.tagName === tag),
	childNodes = [...node.childNodes], // A copy!
        internalIndent = '   '+logIndent;
    let childOutOfRangeOn = outOfRangeOn || removeNode;
    ///*
    if (removeNode) {
      this.debug(internalIndent, 'before', range.startContainer, range.startOffset, range.endContainer, range.endOffset);
      this.unwrap(node, internalIndent); // In some browsers, this mucks with the range that had pointed within node. Reset it.
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);
      this.debug(internalIndent, 'after', range.startContainer, range.startOffset, range.endContainer, range.endOffset);
    }
    //*/
    for (let index = 0; index < childNodes.length; index++) {
      let child = childNodes[index];
      this.debug(internalIndent, 'child', child);
      //let fixme = child;
      //if (first && inRangeOn && isText(child)) fixme = this.wrap(first, tag, internalIndent);
      let [first, last, modifiedChild] = this.format({tag, range, node:child, inRangeOn, outOfRangeOn:childOutOfRangeOn, logIndent:internalIndent});
      /*
      if (removeNode) { // If node is to be removed, each child is pulled up one level, at node's position.
         node.parentElement.insertBefore(modifiedChild, node); // After recursing, as this mucks with range.
       }
      */
      start ||= first;
      end = last || end;
    }
    if (compareEnd < 0) start = null; // do we need these?
    if (compareStart > 0) end = null;
    this.debug(internalIndent, 'format processed node:', node, 'removeNode:', removeNode, /*'emptyNode:', emptyNode, */'childOutofRangeOn:', childOutOfRangeOn, 'start/end:', start, end);
    /*
    let emptyNode = !node.childNodes.length;
    if (emptyNode) {
      node.remove();
      node = null; // do we need this?
    }
    */
    this.debug(logIndent, 'formatted element from', start, 'to', end, node);    
    return [start, end, node];
  }
  toggle(tag) { // Toggle tag off or on for range, retaining selection.  Requires tag to be upper case.
    // Determine overall whether/how we are within an existing tag element, format each range accordingly, and then reset selection.
    let {selection} = this,
	forwards = isForward(selection),
        // If the startNode is within an element with the specified tag, we will be removing the tag.
        startNode = forwards ? selection.anchorNode : selection.focusNode,
	existing = findAncestorWithTag(startNode, tag), // Todo: Should we first drill down to text, and then up?
	{rangeCount} = selection,
	start, end;
    this.debug('toggle:', tag, 'ancestor with tag:', existing);
    for (let index = 0; index < rangeCount; index++) {
      let range = selection.getRangeAt(index),
	  ancestor = range.commonAncestorContainer,
	  fromExisting = existing?.contains(ancestor),
	  node = fromExisting ? existing : ancestor;
      let [first, last] = this.format({tag, range, node, inRangeOn:!existing, outOfRangeOn:fromExisting});
      start ||= first;
      end = last || end;
    }
    // Reset selection, maintaining direction.
    // Text nodes may have been split, but regardless, it will always range over the full start/end text nodes given by format.
    let startOffset = 0, endOffset = end.textContent.length;
    this.debug('toggle start/end:', start, startOffset, end, endOffset, forwards ? 'forwards' : 'backwards');
    if (!forwards) [start, startOffset, end, endOffset] = [end, endOffset, start, startOffset]; // Reverse anchor/focus.  // FIXME: express this as two different setBaseAndExtent calls.
    // FIXME: this is not right! If there are multiple ranges, they might not be contiguous. Must set range start/end. But... how then is anchor/focus maintained relative to document order?
    selection.setBaseAndExtent(start, startOffset, end, endOffset);
  }
  collapsedForward(amount = 'character') {
    let {selection} = this;
    // Standard behavior everywhere, even if not pedantically logical.
    if (!selection.isCollapsed) return selection.collapseToEnd(); // Regardless of selected direction.
    //this.replaceWithText('');
    selection.modify('move', 'forward', amount);
  }
  collapsedBackward(amount = 'character') {
    let {selection} = this;
    // Standard behavior everywhere, even if not pedantically logical.
    if (!selection.isCollapsed) return selection.collapseToStart(); // Regardless of selected direction.
    //this.replaceWithText('');
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


