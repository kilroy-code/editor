import { TextEditor, document, Node, normalizeSelectionFocus } from '../text.mjs';

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
  //afterAll(function () { content.remove(); }); // fixme restore

  // Confirm some corner-case behavior that we depend on.
  describe('browser', function () {
    describe('Node.compareDocumentPosition', function () { // Just a smoke test that the method exists and does something.
      it('recognizes proceeding node.', function () {
        content.innerHTML = '<div><span id="preceding"></div> <span id="following">x</span>';
        const preceding = document.getElementById('preceding'),
              following = document.getElementById('following');
        expect(following.compareDocumentPosition(preceding)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
      });
      it('recognizes following node.', function () {
        content.innerHTML = '<span id="preceding">x</span> <div><span id="following">y</span></div>';
        const preceding = document.getElementById('preceding'),
              following = document.getElementById('following');
        expect(preceding.compareDocumentPosition(following)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      });
    });
    describe('Selection.modify', function () {
      let selection, inner, outer, textNode;
      beforeAll(function () {
        content.innerHTML = 'xx<div id="outer"> <span id="predecessor">p</span><div id="inner">12</div>  </div>xx';
        selection = document.getSelection();
        inner = document.getElementById('inner');
	outer = document.getElementById('outer');
	textNode = inner.firstChild;
        expect(content.lastChild.textContent).toBe('xx'); // we will be moving over witespace to the beginning of this.
      });
      it('extends within text.', function () {
        selection.setBaseAndExtent(textNode, 0, textNode, 0);
        selection.modify('extend', 'forward', 'character');
        expect(selection.focusNode).toBe(textNode);
        expect(selection.focusOffset).toBe(1);
      });
      it('extends to next sibling.', function () {
        let predecessor = document.getElementById('predecessor').firstChild;
        selection.setBaseAndExtent(predecessor, 0, predecessor, 1);
        selection.modify('extend', 'forward', 'character');
        normalizeSelectionFocus(selection); // Chrome and JSDOM do not do this for us.
        expect(selection.focusNode).toBe(textNode);
        expect(selection.focusOffset).toBe(0);
      });
      it('moves over whitespace.', function () {
        selection.setBaseAndExtent(textNode, 0, textNode, 2); // Surround the 12.
        selection.collapseToEnd(); // 'move' of an uncollapsed range is not defined. (Chrome and Safari do nothing.)
        selection.modify('move', 'forward', 'character');
        let focus = selection.focusNode
        expect(selection.isCollapsed).toBeTruthy();
        expect(selection.focusNode).toBe(content.lastChild);
        expect(selection.focusOffset).toBe(0);
      });
      it('extends over whitespace.', function () {
        selection.setBaseAndExtent(textNode, 0, textNode, 2);        
        selection.modify('extend', 'forward', 'character');
        expect(selection.focusNode).toBe(content.lastChild);
        expect(selection.focusOffset).toBe(0);
        // Even though there are two space characters after 'inner', they are processed as a single \n.
        // Alas, JSDOM does not get this right.
        // let string = selection.toString();
        // expect(string.length).toBe(3);
        // expect(string[2]).toBe("\n");
      });
    });
    describe('Selection at offset 0', function () {
      it('sticks when there is selectable text preceding it.', function () {
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
  });

  describe('editor', function () {
    let editor = new TextEditor({selection: document.getSelection(), content});
    if (typeof(window) !== 'undefined') {
      window.editor = editor; window.content = content;// fixme remove
    }
    describe('replaceWithText', function () { // Exercise editor.replaceWithText in lots of selection configurations.
      let beforeOffset = null,
	  selectStart,
	  selectLength,
	  reversed = false,
	  nodeText,
	  inserted, node,
          // We start each test with this structure.
	  startTemplate = `
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

    describe('toggled inline-formatting', function () {
      describe('wrapping', function () {
        // In Medium and Google Docs, the selection is turned on if ANY portion of the selection is off. It is only turned off if the entire selection is on.
        // In Pages, the selected text is toggled to the opposite condition of the START of the selection (in document order, regardless of anchor/focus).
        //
        // In a collapsed selection with word characters to the left and right of the caret (with formatting changes not counting as a boundary):
        //   The the entire word is toggled in Pages to the opposite of the character to the left of the caret, with the caret left within the new formatting so that future characters match.
        // If the collapased caret is at the start of a word, Pages still looks to the left of the caret, but the opposite formatting applies to new text inserted between caret and the word start.
        describe('around the text of a non-empty selection', function () {
          it('works for plain text.', function () {
            content.innerHTML = 'foo bar baz'; 
            editor.selection.setBaseAndExtent(content.firstChild, 4, content.firstChild, 7);
            editor.toggle('X');
            expect(content.innerHTML).toBe('foo <x>bar</x> baz');
            expect(editor.selection.isCollapsed).toBeFalsy();
            expect(editor.selection.anchorNode).toBe(editor.selection.focusNode)
            expect(editor.selection.anchorNode.textContent).toBe('bar');
            expect(editor.selection.anchorNode.parentNode.outerHTML).toBe('<x>bar</x>');
            expect(editor.selection.anchorOffset).toBe(0);          
            expect(editor.selection.focusOffset).toBe(3);
          });
          it('wraps immediately around each text-node of a mixed format selection.', function () {
            // This is our choice, compared to, e.g., wrapping a single element around the whole selection.
            // The result is more uniform when anchor and focus have mixed formatting.
            content.innerHTML = 'foo bar <a>something</a> quux baz'; 
            editor.selection.setBaseAndExtent(content.firstChild, 4, content.lastChild, 5);
            editor.toggle('X');
            expect(content.innerHTML).toBe('foo <x>bar </x><a><x>something</x></a><x> quux</x> baz');
            expect(editor.selection.isCollapsed).toBeFalsy();
            expect(editor.selection.anchorNode.textContent).toBe('bar ')
            expect(editor.selection.anchorOffset).toBe(0);
            expect(editor.selection.focusNode.textContent).toBe(' quux')
            expect(editor.selection.focusOffset).toBe(5);
          });
          it('operates on all of mixed formatting based on the formatting of the start of the selection.', function () {
            // I can't think of a persuasive reason to consider end, anchor, or focus to be a better choice.
            // So let us be familiar to users of Pages, which is at least consistent.
            content.innerHTML = 'foo <x>bar</x> baz';
            editor.selection.setBaseAndExtent(content.firstChild, 1, content.firstElementChild.firstChild, 1);
            editor.toggle('X');
            expect(content.innerHTML).toBe('f<x>oo </x><x>b</x><x>ar</x> baz');
            expect(editor.selection.anchorNode.parentNode.outerHTML).toBe('<x>oo </x>');
            expect(editor.selection.anchorOffset).toBe(0);
            expect(editor.selection.focusNode.parentNode.outerHTML).toBe('<x>b</x>');
            expect(editor.selection.focusOffset).toBe(1);
          });
        });
        describe('in collapsed selections', function () {
          describe('wraps the text of the containing word if the caret is not at the start of the word and the character to the left is not formatted this way', function () {
            xit('in the text.', function () {
              content.innerHTML = 'foo b<x>ar</x> baz';
              editor.selection.setBaseAndExtent(content.firstChild, 5, content.firstChild, 5);
              editor.toggle('X');
              expect(content.innerHTML).toBe('foo <x>bar</x>  baz');
              expect(editor.selection.isCollapsed).toBeFalsy();
              expect(editor.selection.anchorNode.textContent).toBe('bar')
              expect(editor.selection.anchorOffset).toBe(1);
              expect(editor.selection.focusNode.textContent).toBe('bar')
              expect(editor.selection.focusOffset).toBe(1);
            });
          });
        });
        describe('collapsed leaves caret immediately in new element', function () {
          it('is positioned at start.', function () {
            content.innerHTML = 'foo bar baz';
            editor.selection.setBaseAndExtent(content.firstChild, 0, content.firstChild, 0);
            editor.toggle('X');
            expect(content.innerHTML).toBe('<x></x>foo bar baz');
            expect(editor.selection.isCollapsed).toBeTruthy();
            expect(editor.selection.focusNode.parentNode.outerHTML).toBe('<x></x>')
            expect(editor.selection.focusOffset).toBe(0);
          });
          it('is positioned in middle.', function () {
            content.innerHTML = 'foo bar baz';
            editor.selection.setBaseAndExtent(content.firstChild, 3, content.firstChild, 3);
            editor.toggle('X');
            expect(content.innerHTML).toBe('foo<x></x> bar baz');
            expect(editor.selection.isCollapsed).toBeTruthy();
            expect(editor.selection.focusNode.parentNode.outerHTML).toBe('<x></x>')
            expect(editor.selection.focusOffset).toBe(0);
          });
          it('is positioned at end.', function () {
            content.innerHTML = 'foo bar baz';
            editor.selection.setBaseAndExtent(content.firstChild, 11, content.firstChild, 11);
            editor.toggle('X');
            expect(content.innerHTML).toBe('foo bar baz<x></x>');
            expect(editor.selection.isCollapsed).toBeTruthy();
            expect(editor.selection.focusNode.parentNode.outerHTML).toBe('<x></x>')
            expect(editor.selection.focusOffset).toBe(0);
          });
        });
      });
    });
    describe('unwrapping', function () {
      describe('non-empty selection', function () {
        it('removes simple full range.', function () {
          content.innerHTML = '<x>foo</x>';
          editor.selection.setBaseAndExtent(content.firstElementChild.firstChild, 0, content.firstElementChild.firstChild, 3);
          editor.toggle('X');
          expect(content.innerHTML).toBe('foo');
          expect(editor.selection.focusNode.textContent).toBe('foo');
          expect(editor.selection.focusNode).toBe(editor.selection.anchorNode);
          expect(editor.selection.anchorOffset).toBe(0);
          expect(editor.selection.focusOffset).toBe(3); 
        });
        it('removes from inner full range.', function () {
          content.innerHTML = '<y><x>foo</x></y>';
          editor.selection.setBaseAndExtent(content.firstElementChild.firstElementChild.firstChild, 0, content.firstElementChild.firstElementChild.firstChild, 3);
          editor.toggle('X');
          expect(content.innerHTML).toBe('<y>foo</y>');
          expect(editor.selection.focusNode.textContent).toBe('foo');          
          expect(editor.selection.focusNode).toBe(editor.selection.anchorNode);          
          expect(editor.selection.anchorOffset).toBe(0);
          expect(editor.selection.focusOffset).toBe(3); 
        });
        it('removes from outer full range.', function () {
          content.innerHTML = '<x><y>foo</y></x>';
          editor.selection.setBaseAndExtent(content.firstElementChild.firstElementChild.firstChild, 0, content.firstElementChild.firstElementChild.firstChild, 3);
          editor.toggle('X');
          expect(content.innerHTML).toBe('<y>foo</y>');
          expect(editor.selection.focusNode.textContent).toBe('foo');          
          expect(editor.selection.focusNode).toBe(editor.selection.anchorNode);          
          expect(editor.selection.anchorOffset).toBe(0);
          expect(editor.selection.focusOffset).toBe(3); 
        });
        it('removes from middle full range.', function () {
          content.innerHTML = '<z><x><y>foo</y></x></z>';
          editor.selection.setBaseAndExtent(content.firstElementChild.firstElementChild.firstElementChild.firstChild, 0, content.firstElementChild.firstElementChild.firstElementChild.firstChild, 3);
          editor.toggle('X');
          expect(content.innerHTML).toBe('<z><y>foo</y></z>');
          expect(editor.selection.focusNode.textContent).toBe('foo');          
          expect(editor.selection.focusNode).toBe(editor.selection.anchorNode);          
          expect(editor.selection.anchorOffset).toBe(0);
          expect(editor.selection.focusOffset).toBe(3); 
        });
        it('removes from multiple levels and nodes.', function () {
          content.innerHTML = 'foo <x>bar </x><y><x><z>something</z></x></y> <x>quux</x> baz';
          editor.selection.setBaseAndExtent(content.firstElementChild.firstChild, 0, content.lastElementChild.firstChild, 4);
          editor.toggle('X');
          expect(content.innerHTML).toBe('foo bar <y><z>something</z></y> quux baz');
          expect(editor.selection.anchorNode.textContent).toBe('bar ')
          expect(editor.selection.anchorOffset).toBe(0);
          expect(editor.selection.focusNode.textContent).toBe('quux')
          expect(editor.selection.focusOffset).toBe(4);
        });
        it('operates on all of mixed formatting based on the formatting of the start of the selection.', function () {
          // See test with same label above for the "on" case.
          content.innerHTML = 'foo <x>bar</x> baz';
          editor.selection.setBaseAndExtent(content.firstElementChild.firstChild, 1, content.lastChild, 2);
          editor.toggle('X');
          expect(content.innerHTML).toBe('foo <x>b</x>ar baz');
          expect(editor.selection.anchorNode.textContent).toBe('ar');
          expect(editor.selection.anchorOffset).toBe(0);
          expect(editor.selection.focusNode.textContent).toBe(' b');
          expect(editor.selection.focusOffset).toBe(2);
        });
      });
      describe('collapsed selections', function () {
        xit('works in empty.....', function () {
        });
      });
    });
  });    
});
