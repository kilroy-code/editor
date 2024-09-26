# Editor

The ki1r0y editor is a generic set of tools that allows a tree-structure to be operated on simultaneously by mutiple users who have access to the same structure. As in Croquet, the operations are reliably ordered such that each user sees the same set of operations at the same "time" (which might, e.g., be any monotonically increasing stamp on an operation).

We use the same concepts of Selection and Range as in a browser's DOM, but slightly refined:
- There is a Selection for each user.
- The nodes need not have focus or be contenteditable.
- We regularize behaviors that are are not implemented or vary in implementation in some browsers. For example, multiple non-continuous ranges are supported, so that we can represent, say, the selection of a column of cells in a spreadsheet.
- We do not assume that the nodes of the structure are DOM nodes, nor that the structure nodes are displayed directly, nor even that there is a one-to-one correspondence between the structure nodes and display nodes. For example, a DOM display of DIV containing UL containing LI elements might have an editable structure that does not use UL.

The concept of Element node and Text node is generalized to Assembly nodes, and Terminal nodes. For example, the same keystrokes could edit text or, say, a nested set of group nodes, in which the the innermost/terminating node contains users instead of characters. We do not require all structures to support editing within terminal nodes - e.g., in the way that one can remove characters 4-7 within a DOM Text node, but the only internally-editable Terminal nodes that we have implemented are for Text.

We currently assume that no user's selection overlaps another, and that the document order (when going forward or backward one terminal element) is the same for each user.


## Editing Structure

editor operates on tree structure
by default, directly on dom structure, but can also operate on a model for which changes are immediately reflected to the display dom

however...
browser dom has rules about ignoring and canonicalizing whitespace
when operating directly on browser dom, extra whitespace will be ignored in the browser's display
contrast with, e.g., Google Docs, which renders the internal structure to a canvas, giving no visible HTML structure

rule about the last applied formatting being towards the leaves, and implications thereof


## Text Editing

When the following character are inserted, the selection's end terminal node is examined:
These all look back over the node's preceding wholeText to see if there is a match (with neither preceded by a single \).
  If found, the matching characters are removed and the text in between is surrounded by the specified formatting.
  * => bold
  _ => italic
  ~ => strike
  ` => code
  (This is inspired by markdown, but isn't, quite.)
space => If node is not within formatting, and the part of the wholeText before the space is:
    > => blockquote
    * or - or + => bullet
    digit. or digit) (or #. which is specific to ki1r0y) => numeric
    # => header, of level equal to the number of consecutive #
CR:
  If the node is not within formatting, and the preceding wholeText is three or more:
    = => h1 of the preceding non-empty terminal if any, else divider if three or more
    - => h2 of the preceding non-empty terminal if any, else divider if three or more
    ` => if there is previous sibling whose wholeText matches, enclose the nodes between in PRE, and loose the ``` nodes.
  If the preceding wholeText ends in two spaces => insert a break.
  If the preceding wholeText ends in two CR => replace all three CR with the start of a new paragraph.
  Create a new assembly of the same kind.

Toggles selection formatting (creating empty terminal if collapsed and not currently active):
MetaB => bold
MetaI => italic
MetaU => underline (technically, "unarticulated annotation")
MetaS => strike
MetaK => link (causes mini-editor popup for url)
MetaH => header
MetaL => bullet
MetaN => numeric

MetaC, EscW => copy
MetaX, CtrW => cut
MetaV, CtrY => paste
MetaY, EscY => cycle through kill ring
MetaA => select all
CtrlF, right arrow => move forward (to the next offset within the ending terminal node, or next terminal node if necessary).
CtrlB, left arrow => move backward [NB: consider reversed and CtlSpace situations. Is behavior different for arrow vs f/b? Consider shift arrow as reverse.]
CtrlE, CtrlJ => move forward block
CtrlA, CtrlK => move backward block
CtrlSpace => set start of selection
EscF => move forward word
EscB => move backward word
EscE => move forward sentence
EscA => move backward sentence

In browser, not editor (but nonetheless, important bindings)
MetaF => find
MetaG => find next
MetaE => use selection for find
MetaD => duplicate selection
MetaJ => jump/scroll to selection
MetaZ => undo




---
Each user has a selection in the editable text or not, which (if in the editor):
  accepts text for this user only (e.g., displaying keyboard on mobile, not replicated),
  and shows everyone where they are and will act, using a (replicated) distinct cursor/hightlighting for each user.
Created by the browser on click, double click, touch hold, cmd/ctrl-a, or drag (when the drag starts without a selection).
A change in selection start will save any unsaved text changes.
A range selection (i.e., not collapsed/caret) also shows a hovering formatting menu (ala Medium).
A selection can be copied, with HTML and markdown formatting retained (for use in other such pages, or in entiredly separate tools).
A drag (with a selection) starts a drag action, continues the highlight as a dragging pseudo-selection, and creates a (simulated?) collapsed selection under the mouse during the drag. (Replicated.)
Text and HTML can be dragged or copy/pasted from other sources (including other editor pages with HTML formatting). 
[[How do you cancel a drag?]]

Delete character removes selection range, if any, otherwise what is BEFORE the caret.
Some (cmd/ctrl and markup) characters do formatting:
  Enclose or remove a formatting span around selection.
  Create or close a formatting span at cursor.
Otherwise replaces any selection, and regardless adds the character or selection.
Unsaved text changes are saved after N seconds (1?) of inactivity.

Opening/closing formatting or characterData (including removal of nodes) causes canonicalization:
First, any unsaved text changes are saved, so that the formatting result will be pure formatting.
Removes any empty formatting/characterData before the selection start.
Combines with any adjacent formatting/characterData before the selection start.
Doing this may result in different nesting of nodes. As it does so, formatting shall be repeated within a div rather than enclosing spans.
Each formatting change is saved.

Each change is replicated in realtime, but only some of those are save points in the history.
In full ki1r0y, a long-term, trimmed history is available. The availability in this demo is TBD.
Undo/redo can be used through the available change history.
A save records
  The fulls state at that point in time.
  Information about the action since the last change so that change markup can be produced.
  There is no forking of the history: a change extends the history at the current point, abandoning any previous history that had been undone. (Really? Shouldn't it insert a new version at the end whose antecedent is not the previous version?)
(Redo)Undo is done by (shift-)cmd/ctl-z and by browser history (forward/) back button.
Moving along the history (undo/redo, or extending the history with a save) adopts that state (replicated) for the main display and the display of change markup.

Change markup:
Described for full ki1r0y. How much of this is available in this demo is TBD.
The last exit time is recorded for each user. If none, the start of their first session is used.
A user's display shows a non-replicated change markup for changes since their last exit (thus including the current session).
The color (or a color badge) matches the user that made it, and the text translucency/lightness matches the age.
By construction, each save as one "mutation", not unlike a browser MutationRecord:
  It is one of add, remove, replace, or format, used in the change description.
  It occurs at one specific node, giving us a position (e.g., in the margin) to display the markup, as well as text to display.
  It may have a removed node-or-text of which we display the text.
Each markup display has an undo button. Adds to the history with a reverse action, 
  rather than undoing to that point in the history (because zipping back the history would undo other changes that are temporilly inline, 
  but not likely spatially related, thus confusing everyone).
Each markup display has a dismiss button, that doesn't do anything other than stop showing that particular markup item for the rest of the session.
  E.g., an item can be dismissed, become irrelevant because the containing node was removed, and then become relevant again if the containing element is brought back. But the dismissed markup isn't shown again.
  (In the next session, that change will be older than the last exit time. The full ki1r0y provides multiple ways to go back to any available history point.)
Markup may be moot, because the node at which it happens has gone. 
  Moot markup is not displayed, but actions may bring it back. This is one reason that nodes must be identified by content hash, so that recreating the same content can make markup relevant again.
  Any non-moot action is reversible. (This means that internally, the action must keep the original node info, even if a simpler description is given in the markup text.)

Closing the tab saves any unsaved text. (E.g. closing within one second of the last character entry.)
When offline, the a "save" records changes locally, and those that still apply are replayed upon coming online.
Since markup is shown, they can easily be undone if no longer desired.
If the user closes the tab when offline with recorded pending changes, they are notified that they should revisit the page to save their changes.
