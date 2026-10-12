import { hydrateMarmotSession } from './marmotSessionHydration';
import { perfLog } from '../utils/perfLog';
jest.mock('../utils/perfLog', () => ({ perfLog: jest.fn() }));

it('restores watermarks, loads/wires groups, and replays history sequentially', async () => {
  const steps: string[] = [];
  await hydrateMarmotSession(
    async () => {
      steps.push('watermarks');
    },
    async () => {
      steps.push('load');
      return ['a', 'b'];
    },
    (g) => {
      steps.push(`wire ${g}`);
    },
    async (g) => {
      steps.push(`replay ${g}`);
    },
  );
  expect(steps).toEqual(['watermarks', 'load', 'wire a', 'wire b', 'replay a', 'replay b']);
});

it('closes the bracket and preserves storage failure propagation', async () => {
  jest.mocked(perfLog).mockClear();
  const failure = new Error('storage unavailable');
  await expect(
    hydrateMarmotSession(
      async () => {
        throw failure;
      },
      async () => [],
      () => {},
      async () => {},
    ),
  ).rejects.toBe(failure);
  expect(jest.mocked(perfLog).mock.calls).toEqual([
    ['MLS/Marmot session hydration start'],
    ['MLS/Marmot session hydration end'],
  ]);
});
