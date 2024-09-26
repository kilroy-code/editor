export { DOMTools } from "./domTools.mjs";
export { Highlights } from "./highlights.mjs";
export { MultiSelection } from "./multiSelection.mjs";
export { TextEditor } from "./textEditor.mjs";

/*
function onFocus(event) { // fixme: remove
  console.log('focus', event);
}
editor.onfocus = onFocus;
*/
export function importData(data) {
  console.log('importData:', data);
  data.types.forEach(type => console.log(type, data.getData(type)));
  if (!data.types.length) console.log('no types!!! using text', data.getData('text'));
}
export function onPaste(event) {
  importData(event.clipboardData || window.clipboardData);
}
export function allowDrop(event) {
  //console.log('allowDrop', event);
  //event.target.style.color = 'blue';
  event.preventDefault();
}
export function onDrop(event) {
  console.log('onDrop', event);
  importData(event.dataTransfer);
}

