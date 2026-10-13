import { receiveFriendProtocol } from './receiveFriendProtocol';
import { preferredDmProtocol } from '../services/preferredDmProtocol';

jest.mock('../services/preferredDmProtocol', () => ({ preferredDmProtocol: jest.fn() }));

beforeEach(() => jest.mocked(preferredDmProtocol).mockReset().mockResolvedValue('marmot'));

test('invoice and address sharing use the recipient preference', async () => {
  expect(await receiveFriendProtocol('viewer', 'peer')).toBe('marmot');
  expect(preferredDmProtocol).toHaveBeenCalledWith('viewer', 'peer', undefined);
});

test('Receive in an open NIP-17 conversation preserves its protocol', async () => {
  jest.mocked(preferredDmProtocol).mockResolvedValue('nip17');
  expect(await receiveFriendProtocol('viewer', 'PEER', 'peer', 'nip17')).toBe('nip17');
  expect(preferredDmProtocol).toHaveBeenCalledWith('viewer', 'PEER', 'nip17');
});

test('picking someone else does not inherit the preset thread protocol', async () => {
  expect(await receiveFriendProtocol('viewer', 'other', 'peer', 'nip17')).toBe('marmot');
  expect(preferredDmProtocol).toHaveBeenCalledWith('viewer', 'other', undefined);
});
