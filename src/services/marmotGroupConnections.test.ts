import { createMarmotGroupConnections } from './marmotGroupConnections';

it('replaces the complete group connection on recovery and stays inert before start/after stop', () => {
  const unsubscribe = jest.fn();
  const connect = jest.fn(() => ({ unsubscribe }));
  const connections = createMarmotGroupConnections(connect);
  connections.reconnect();
  expect(connect).not.toHaveBeenCalled();
  connections.start();
  connections.start();
  expect(connect).toHaveBeenCalledTimes(1);
  connections.reconnect();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(2);
  connections.unsubscribe();
  connections.reconnect();
  connections.start();
  connections.unsubscribe();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenCalledTimes(2);
});
