const {JSDOM} = await import('jsdom');
export const jsdom = new JSDOM('');
export const Window = jsdom.window;
