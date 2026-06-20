// Verify the prod-detection helper keys off the applicationId / bundle
// identifier (com.lightningpiggy.app) and treats dev / preview / unknown
// as NON-production (so test content keeps showing there).

// Mutable mock for expo-application: the helper reads
// `Application.applicationId` at call time, so we flip this between cases.
// The getter closes over `mockApplicationId` (declared below the import per
// `import/first`); it's only invoked at test time, after the module loads.
jest.mock('expo-application', () => ({
  get applicationId() {
    return mockApplicationId;
  },
}));

import { isProductionBuild, PRODUCTION_APPLICATION_ID } from './appEnvironment';

let mockApplicationId: string | null = null;

describe('isProductionBuild', () => {
  afterEach(() => {
    mockApplicationId = null;
  });

  it('is true for the bare production applicationId', () => {
    mockApplicationId = PRODUCTION_APPLICATION_ID; // com.lightningpiggy.app
    expect(isProductionBuild()).toBe(true);
  });

  it('is false for the .dev (development) variant', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(isProductionBuild()).toBe(false);
  });

  it('is false for the .preview variant', () => {
    mockApplicationId = 'com.lightningpiggy.app.preview';
    expect(isProductionBuild()).toBe(false);
  });

  it('is false when the native module yields null (jest / web)', () => {
    mockApplicationId = null;
    expect(isProductionBuild()).toBe(false);
  });

  it('is false for an unrelated applicationId', () => {
    mockApplicationId = 'com.someoneelse.app';
    expect(isProductionBuild()).toBe(false);
  });
});
