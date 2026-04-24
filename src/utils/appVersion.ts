// Single source for the app version string shown in the About screen
// and the drawer footer. Reads from package.json at bundle time.
export const appVersion: string = require('../../package.json').version;
