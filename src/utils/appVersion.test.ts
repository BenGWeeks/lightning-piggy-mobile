// Verifies the version-label composition rules. The label is the only
// surface where users see which build they're actually running, so the
// build-number-present vs build-number-absent branches both matter.
//
// jest-expo auto-mocks `expo-application` to {}, so `nativeBuildVersion`
// is `undefined` at module load. We override per-test with `jest.doMock`
// + `jest.isolateModules` so each branch runs against its own freshly-
// evaluated copy of the module.

describe('appVersionLabel', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-application');
  });

  it('includes the build number when expo-application reports one', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-application', () => ({ nativeBuildVersion: '13' }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./appVersion');
      expect(mod.appBuildNumber).toBe('13');
      expect(mod.appVersionLabel).toBe(`${mod.appVersion} (build 13)`);
    });
  });

  it('falls back to the bare semver when the build number is null (web / test env)', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-application', () => ({ nativeBuildVersion: null }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./appVersion');
      expect(mod.appBuildNumber).toBeNull();
      expect(mod.appVersionLabel).toBe(mod.appVersion);
    });
  });

  it('still exposes the bare semver from package.json', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-application', () => ({ nativeBuildVersion: '13' }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./appVersion');
      expect(mod.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
