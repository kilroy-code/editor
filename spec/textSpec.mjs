import { TextEditor } from '../text.mjs';

// FIXME: remove after development
///*
var currentSpec; // Capture currentSpec for logging.
jasmine.getEnv().addReporter({specStarted(spec) { currentSpec = spec; }});
jasmine.getEnv().configure({random: false});
//*/

/* TODO:
   start within beforeContainer
   end within afterContainer
   test for deleting all the text of a node before inserting
   selections that are between non-terminal nodes that don't have meaningful text, where text must be created. e.g., focus between <nodeA/><nodeB/>. Does it insert whithn A or within B?
   highlights
   Test in all browsers!
   decide: either create hooks to forward structural changes to model, or forward events to a re-implmented selection.
*/

describe('Editing', function () {
  let content = document.createElement('div');
  // Include text content in the DOM only during the tests.
  beforeAll(function () { document.body.append(content); });
  afterAll(function () { content.remove(); });

  // Confirm some corner-case behavior that we depend on.
  describe('browser', function () {
    it('Selection extends over whitespace.', function () {
      content.innerHTML = 'xx<div id="outer"> <div id="inner">12</div>  </div>xx';
      let selection = document.getSelection(),
	  inner = document.getElementById('inner'),
	  outer = document.getElementById('outer'),
	  textNode = inner.firstChild;
      selection.setBaseAndExtent(textNode, 0, textNode, 2);
      selection.modify('extend', 'forward', 'character');
      expect(selection.focusOffset).toBe(0);
      expect(selection.focusNode).toBe(content.lastChild);
      // Even though there are two space characters after 'inner', they are processed as a single \n.
      let string = selection.toString();
      expect(string.length).toBe(3);
      expect(string[2]).toBe("\n");
    });
    it('Selection at offset 0 sticks when there is selectable text preceding it.', function () {
      // Fails in Safari before 16.4. 
      content.innerHTML = `<b>xx</b><i id="focus">aabbcc</i>`;
      let selection = document.getSelection(),
	  textNode = document.getElementById('focus').firstChild
      selection.setBaseAndExtent(textNode, 0, textNode, 0);
      if (selection.focusNode === document.getElementById('focus').previousSibling.firstChild) {
	throw new Error("This browser puts the focus at the end of the previous node, which is the wrong style! This is not fixable by applications!");
      }
      expect(selection.anchorOffset).toBe(0);
      expect(selection.focusOffset).toBe(0);
      expect(selection.anchorNode).toBe(textNode);
      expect(selection.focusNode).toBe(textNode);      
    });
  });

  describe('Text', function () {
    let editor = new TextEditor({selection: document.getSelection(), content}),
	beforeOffset = null,
	selectStart,
	selectLength,
	reversed = false,
	nodeText,
	inserted, node,
	startTemplate = /* We start each test with this structure. */ `
<div id="outerContainer">
   <b id="beforeContainer">xx</b>
   <i id="innerTextContainer">aabbcc</i> <!-- The focus or anchor (or both) will be within this. -->
   <a id="afterContainer">zz</a>
</div>`;

    function hasCrossing() { return beforeOffset !== null; }
    function confirmSelectionObjectDoesNotChange(event) { // Confirm an assumption made by our implmentation.
      expect(document.getSelection()).toBe(editor.selection);
    }
    beforeAll(function () { document.addEventListener('selectionchange', confirmSelectionObjectDoesNotChange);});
    afterAll(function () { document.removeEventListener('selectionchange', confirmSelectionObjectDoesNotChange); });

    // Set the selection based on the parameters, and invoke the handler.
    beforeEach(function () {
      content.innerHTML = startTemplate;
      node = document.getElementById('innerTextContainer').firstChild;
      nodeText = node.wholeText;
      let base = hasCrossing() ? document.getElementById('beforeContainer').firstChild : node,
	  baseOffset = hasCrossing() ? beforeOffset : selectStart,
	  extent = node,
	  extentOffset = selectStart + selectLength;
      if (reversed) editor.selection.setBaseAndExtent(extent, extentOffset, base, baseOffset);
      else editor.selection.setBaseAndExtent(base, baseOffset, extent, extentOffset);
      editor.replaceWithText(inserted);
    });
    function checkResults() { // The actual tests, confirming what must be true for all results.
      it('contains all and only expected.', function () {
	let selectEnd = selectStart + selectLength,
	    pre = nodeText.slice(0, selectStart),
	    post = nodeText.slice(selectEnd),
	    mainInserted = (reversed && hasCrossing()) ? '' : inserted,
	    string = pre + mainInserted + post;
	//console.log(currentSpec.fullName, selectStart, selectLength, reversed, beforeOffset, string);
	// We're not prescribing whether text is normalized. Hence the use of wholeText rather than textContent.
	expect(node.wholeText).toBe(string);
      });
      it('leaves collapsed selection after inserted text.', function () {
	expect(editor.selection.isCollapsed).toBeTruthy();
	let inBefore = reversed && hasCrossing(),
	    start = inBefore ? beforeOffset : selectStart;
	expect(editor.selection.focusNode).toBe(inBefore ? document.getElementById('beforeContainer').firstChild : node);
	expect(editor.selection.focusOffset).toBe(start + inserted.length);
      });
      it('is contained within expected parent.', function () {
	let focusNode = editor.selection.focusNode,
	    outer = document.getElementById('outerContainer'),
	    inner = document.getElementById('innerTextContainer'),
	    before = document.getElementById('beforeContainer'),
	    after = document.getElementById('afterContainer');
	expect(outer.contains(before)).toBeTruthy();	
	expect(outer.contains(inner)).toBeTruthy();
	expect(outer.contains(focusNode)).toBeTruthy();
	expect(outer.contains(after)).toBeTruthy();
	if (reversed && hasCrossing()) {
	  expect(before.contains(focusNode)).toBeTruthy();
	} else {
	  expect(inner.contains(focusNode)).toBeTruthy();
	}
	expect(after.contains(focusNode)).not.toBeTruthy();
      });
    }
    function allInsertTypes() { // Define tests in a suites for each size of inserted text.
      describe('with empty string', function () {
	beforeAll(function () { inserted = ""; });
	checkResults();
      });
      describe("with single character", function () {
	beforeAll(function () { inserted = "1"; });
	checkResults();
      });
      describe("with multiple character string", function () {
	beforeAll(function () { inserted = "12"; });
	checkResults();
      });
    }
    function allStartPositions() { // Define suites that select text at start, middle, or end of container.
      describe('replaced at start', function () { // Fails in Safari before 16.4
	beforeAll(function () { selectStart = 0; });
	allInsertTypes();
	describe('crossing previous node', function () {
	  afterAll(function () { beforeOffset = null; });
	  describe('front', function () {
	    beforeAll(function () { beforeOffset = 0; });
	    allInsertTypes();
	  });
	  describe('middle', function () {
	    beforeAll(function () { beforeOffset = 1; });
	    allInsertTypes();
	  });
	  describe('end', function () {
	    beforeAll(function () { beforeOffset = 2; });
	    allInsertTypes();
	  });
	});
      });
      describe('replaced in middle', function () {
	beforeAll(function () { selectStart = 2; });
	allInsertTypes();
      });
      describe('replaced at end', function () {
	beforeAll(function () { selectStart = 4; });
	allInsertTypes();
      });
    }
    describe('of non-zero length selection', function () { // Suites that actually remove text, selected in either direction.
      beforeAll(function () { selectLength = 2; } );
      allStartPositions();
      describe('reversed', function () {
	beforeAll(function () { reversed = true; });
	afterAll(function () { reversed = false; });
	allStartPositions();
      });
    });
    describe('of zero length selection', function () { // Collapsed selections, plus a collapsed selection at the very end of the container.
      beforeAll(function () { selectLength = 0; } );
      allStartPositions();
      describe('at absolute end', function () {
	beforeAll(function () { selectStart = 6; });
	allInsertTypes();
      });
    });
  });
  
});
